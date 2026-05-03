from flask import Blueprint, request, jsonify
from backend.models.database import get_db
from backend.services.coingecko import get_prices, get_top_coins, search_coins, clear_cache
import datetime

market_bp = Blueprint('market', __name__)

# ─────────────────────────────────────────
#  WATCHLIST CRUD
# ─────────────────────────────────────────

@market_bp.route('/watchlist', methods=['GET'])
def get_watchlist():
    db = get_db()
    rows = db.execute('SELECT * FROM watchlist ORDER BY sort_order ASC, added_at ASC').fetchall()
    db.close()
    items = [dict(r) for r in rows]

    if not items:
        return jsonify([])

    coin_ids = [i['coin_id'] for i in items]
    prices, err = get_prices(coin_ids)

    for item in items:
        item['market'] = prices.get(item['coin_id'])
        item['price_error'] = err if not prices.get(item['coin_id']) else None

    return jsonify(items)


@market_bp.route('/watchlist', methods=['POST'])
def add_to_watchlist():
    data = request.get_json()
    if not data.get('coin_id'):
        return jsonify({'error': 'coin_id required'}), 400

    db = get_db()
    existing = db.execute('SELECT id FROM watchlist WHERE coin_id = ?', (data['coin_id'],)).fetchone()
    if existing:
        db.close()
        return jsonify({'error': 'Already in watchlist'}), 409

    max_order = db.execute('SELECT MAX(sort_order) as m FROM watchlist').fetchone()['m'] or 0
    db.execute(
        'INSERT INTO watchlist (coin_id, symbol, name, sort_order) VALUES (?, ?, ?, ?)',
        (data['coin_id'], data.get('symbol', '').upper(), data.get('name', ''), max_order + 1)
    )
    db.commit()
    db.close()
    return jsonify({'added': data['coin_id']}), 201


@market_bp.route('/watchlist/<coin_id>', methods=['DELETE'])
def remove_from_watchlist(coin_id):
    db = get_db()
    db.execute('DELETE FROM watchlist WHERE coin_id = ?', (coin_id,))
    db.commit()
    db.close()
    return jsonify({'removed': coin_id})


@market_bp.route('/watchlist/reorder', methods=['PUT'])
def reorder_watchlist():
    """Accepts {'order': ['bitcoin', 'ethereum', ...]} and updates sort_order."""
    data = request.get_json()
    order = data.get('order', [])
    db = get_db()
    for i, coin_id in enumerate(order):
        db.execute('UPDATE watchlist SET sort_order = ? WHERE coin_id = ?', (i, coin_id))
    db.commit()
    db.close()
    return jsonify({'ok': True})


# ─────────────────────────────────────────
#  PRICE ENDPOINTS
# ─────────────────────────────────────────

@market_bp.route('/prices', methods=['GET'])
def get_market_prices():
    """Get prices for specific coin IDs passed as ?ids=bitcoin,ethereum"""
    ids_param = request.args.get('ids', '')
    coin_ids = [c.strip() for c in ids_param.split(',') if c.strip()]

    if not coin_ids:
        return jsonify({'error': 'Pass ?ids=bitcoin,ethereum'}), 400

    prices, err = get_prices(coin_ids)
    if err and not prices:
        return jsonify({'error': err}), 503

    return jsonify({'prices': prices, 'warning': err})


@market_bp.route('/top', methods=['GET'])
def get_top():
    """Top N coins by market cap. Default 50, max 100."""
    try:
        limit = min(int(request.args.get('limit', 50)), 100)
    except ValueError:
        limit = 50

    coins, err = get_top_coins(limit)
    if err and not coins:
        return jsonify({'error': err}), 503

    return jsonify({'coins': coins, 'warning': err})

@market_bp.route('/movers', methods=['GET'])
def get_movers():
    """Returns coins up/down > threshold% in 24h from the top 100."""
    from backend.models.database import get_db
    db = get_db()
    settings_rows = db.execute("SELECT * FROM settings").fetchall()
    db.close()
    settings = {r["key"]: r["value"] for r in settings_rows}
    threshold = float(settings.get("alert_threshold_pct", 5))

    coins, err = get_top_coins(100)
    if err and not coins:
        return jsonify({"error": err}), 503

    gainers = sorted([c for c in coins if c["change_24h"] >= threshold],
                     key=lambda x: x["change_24h"], reverse=True)
    losers  = sorted([c for c in coins if c["change_24h"] <= -threshold],
                     key=lambda x: x["change_24h"])

    # Re-flag alert_24h using dynamic threshold
    for c in coins:
        c["alert_24h"] = abs(c["change_24h"]) >= threshold
        c["alert_direction"] = ("up" if c["change_24h"] >= threshold
                                else "down" if c["change_24h"] <= -threshold
                                else None)

    return jsonify({
        "gainers": gainers,
        "losers": losers,
        "threshold": threshold,
        "warning": err
    })


@market_bp.route('/search', methods=['GET'])
def search():
    query = request.args.get('q', '').strip()
    if len(query) < 2:
        return jsonify({'results': []})

    results, err = search_coins(query)
    if err:
        return jsonify({'error': err}), 503

    return jsonify({'results': results})


@market_bp.route('/cache/clear', methods=['POST'])
def bust_cache():
    clear_cache()
    return jsonify({'ok': True, 'message': 'Price cache cleared'})

_market_calls = {}
def _rate_limit_market():
    ip  = request.remote_addr
    now = datetime.time()
    calls = [t for t in _market_calls.get(ip, []) if now - t < 60]
    if len(calls) >= 30:  # 30 market requests per minute per IP
        return jsonify({'error': 'Rate limited'}), 429
    calls.append(now)
    _market_calls[ip] = calls
    return None