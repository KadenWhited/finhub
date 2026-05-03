"""
backend/routes/predictions.py
Predictions module — Kalshi positions, history, order placement.
"""
import os
from flask import Blueprint, request, jsonify
from backend.models.database import get_db

predictions_bp = Blueprint('predictions', __name__)


def _is_configured() -> bool:
    return bool(
        os.environ.get('KALSHI_API_KEY_ID') and
        os.environ.get('KALSHI_API_PRIVATE_KEY')
    )


# ─────────────────────────────────────────
#  PREDICTIONS LIST + STATS
# ─────────────────────────────────────────

@predictions_bp.route('/', methods=['GET'])
def get_predictions():
    status = request.args.get('status')  # open|resolved_win|resolved_loss|exited_win|exited_loss
    db     = get_db()
    query  = 'SELECT * FROM predictions'
    args   = []
    if status:
        query += ' WHERE status = ?'
        args.append(status)
    query += ' ORDER BY opened_at DESC'
    rows  = [dict(r) for r in db.execute(query, args).fetchall()]
    db.close()

    # Enrich with dollar values
    for r in rows:
        r['entry_price_dollars'] = round((r.get('entry_price_cents') or 0) / 100, 4)
        r['exit_price_dollars']  = round((r.get('exit_price_cents')  or 0) / 100, 4) \
                                   if r.get('exit_price_cents') else None
        r['payout_dollars']      = round((r.get('resolution_value_cents') or 0) / 100, 4) \
                                   if r.get('resolution_value_cents') else None

        # Calculate P&L
        if r['status'] in ('resolved_win', 'resolved_loss', 'exited_win', 'exited_loss'):
            cost    = (r.get('entry_price_cents') or 0) * (r.get('contracts') or 0)
            payout  = (r.get('resolution_value_cents') or r.get('exit_price_cents') or 0) \
                      * (r.get('contracts') or 0)
            r['pnl_cents']   = payout - cost
            r['pnl_dollars'] = round(r['pnl_cents'] / 100, 2)
        else:
            r['pnl_cents']   = None
            r['pnl_dollars'] = None

    return jsonify(rows)


@predictions_bp.route('/stats', methods=['GET'])
def get_stats():
    db   = get_db()
    rows = [dict(r) for r in db.execute('SELECT * FROM predictions').fetchall()]
    db.close()

    open_pos    = [r for r in rows if r['status'] == 'open']
    resolved_w  = [r for r in rows if r['status'] == 'resolved_win']
    resolved_l  = [r for r in rows if r['status'] == 'resolved_loss']
    exited_w    = [r for r in rows if r['status'] == 'exited_win']
    exited_l    = [r for r in rows if r['status'] == 'exited_loss']

    all_closed  = resolved_w + resolved_l + exited_w + exited_l
    all_wins    = resolved_w + exited_w
    all_losses  = resolved_l + exited_l

    def _pnl(r):
        cost   = (r.get('entry_price_cents') or 0) * (r.get('contracts') or 0)
        payout = (r.get('resolution_value_cents') or r.get('exit_price_cents') or 0) \
                 * (r.get('contracts') or 0)
        return payout - cost

    total_pnl_cents   = sum(_pnl(r) for r in all_closed)
    resolved_pnl      = sum(_pnl(r) for r in resolved_w + resolved_l)
    early_exit_pnl    = sum(_pnl(r) for r in exited_w + exited_l)

    # Win rates split by exit type
    res_total    = len(resolved_w) + len(resolved_l)
    exit_total   = len(exited_w)   + len(exited_l)

    return jsonify({
        'total_predictions':       len(rows),
        'open_positions':          len(set(p['market_ticker'] for p in open_pos)),
        'total_closed':            len(all_closed),
        'total_wins':              len(all_wins),
        'total_losses':            len(all_losses),
        'overall_win_rate':        round(len(all_wins) / len(all_closed) * 100, 1)
                                   if all_closed else 0,
        # Split win rates
        'resolved_wins':           len(resolved_w),
        'resolved_losses':         len(resolved_l),
        'resolved_win_rate':       round(len(resolved_w) / res_total * 100, 1)
                                   if res_total else 0,
        'early_exit_wins':         len(exited_w),
        'early_exit_losses':       len(exited_l),
        'early_exit_win_rate':     round(len(exited_w) / exit_total * 100, 1)
                                   if exit_total else 0,
        # P&L
        'total_pnl_dollars':       round(total_pnl_cents / 100, 2),
        'resolved_pnl_dollars':    round(resolved_pnl / 100, 2),
        'early_exit_pnl_dollars':  round(early_exit_pnl / 100, 2),
    })


# ─────────────────────────────────────────
#  MANUAL CRUD
# ─────────────────────────────────────────

@predictions_bp.route('/', methods=['POST'])
def create_prediction():
    """Manually log a prediction (for trades not auto-imported)."""
    data = request.get_json() or {}
    db   = get_db()
    cur  = db.cursor()
    cur.execute('''
        INSERT INTO predictions
            (market_ticker, market_title, category, side, action,
             contracts, entry_price_cents, opened_at, status, notes, source)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)
    ''', (
        data.get('market_ticker', ''),
        data.get('market_title', ''),
        data.get('category', 'other'),
        data.get('side', 'yes'),
        data.get('action', 'buy'),
        int(data.get('contracts', 1)),
        int(float(data.get('entry_price', 0)) * 100),
        data.get('opened_at') or __import__('datetime').datetime.utcnow().isoformat(),
        'open',
        data.get('notes', ''),
        'manual',
    ))
    new_id = cur.lastrowid
    db.commit()
    row = dict(db.execute('SELECT * FROM predictions WHERE id = ?', (new_id,)).fetchone())
    db.close()
    return jsonify(row), 201


@predictions_bp.route('/<int:pred_id>/close', methods=['POST'])
def close_prediction(pred_id):
    """
    Close a prediction early (before resolution).
    Body: { exit_price: float, contracts_sold: int }
    """
    data    = request.get_json() or {}
    db      = get_db()
    row     = db.execute('SELECT * FROM predictions WHERE id = ?', (pred_id,)).fetchone()
    if not row:
        db.close()
        return jsonify({'error': 'Prediction not found'}), 404

    exit_cents = int(float(data.get('exit_price', 0)) * 100)
    pnl_cents  = (exit_cents - (row['entry_price_cents'] or 0)) * (row['contracts'] or 1)
    new_status = 'exited_win' if pnl_cents > 0 else 'exited_loss'

    db.execute('''
        UPDATE predictions
        SET status           = ?,
            exit_price_cents = ?,
            closed_at        = datetime('now'),
            exit_type        = 'early_exit'
        WHERE id = ?
    ''', (new_status, exit_cents, pred_id))
    db.commit()
    updated = dict(db.execute('SELECT * FROM predictions WHERE id = ?', (pred_id,)).fetchone())
    db.close()
    return jsonify(updated)


@predictions_bp.route('/<int:pred_id>', methods=['DELETE'])
def delete_prediction(pred_id):
    db = get_db()
    db.execute('DELETE FROM predictions WHERE id = ?', (pred_id,))
    db.commit()
    db.close()
    return jsonify({'deleted': pred_id})


# ─────────────────────────────────────────
#  WATCHLIST
# ─────────────────────────────────────────

@predictions_bp.route('/watchlist', methods=['GET'])
def get_watchlist():
    db   = get_db()
    rows = [dict(r) for r in
            db.execute('SELECT * FROM prediction_watchlist ORDER BY added_at DESC').fetchall()]
    db.close()

    # Enrich with live prices if Kalshi configured
    if _is_configured():
        try:
            from backend.services.ingestion.kalshi import get_market
            for row in rows:
                try:
                    market = get_market(row['market_ticker'])
                    row['yes_price']       = market['yes_price']
                    row['no_price']        = market['no_price']
                    row['yes_price_cents'] = market['yes_price_cents']
                    row['no_price_cents']  = market['no_price_cents']
                    row['volume']          = market['volume']
                    row['status']          = market['status']
                    row['close_time']      = market['close_time']
                except Exception:
                    pass
        except ImportError:
            pass

    return jsonify(rows)


@predictions_bp.route('/watchlist', methods=['POST'])
def add_to_watchlist():
    data   = request.get_json() or {}
    ticker = data.get('market_ticker', '').strip()
    if not ticker:
        return jsonify({'error': 'market_ticker required'}), 400

    # Try to fetch market info
    title    = data.get('market_title', ticker)
    category = data.get('category', 'other')
    if _is_configured():
        try:
            from backend.services.ingestion.kalshi import get_market
            market   = get_market(ticker)
            title    = market.get('title', title)
            category = market.get('category', category)
        except Exception:
            pass

    db = get_db()
    db.execute('''
        INSERT OR IGNORE INTO prediction_watchlist
            (market_ticker, market_title, category, alert_threshold_cents)
        VALUES (?, ?, ?, ?)
    ''', (ticker, title, category, int(data.get('alert_threshold_cents', 10))))
    db.commit()
    db.close()
    return jsonify({'ok': True, 'ticker': ticker})


@predictions_bp.route('/watchlist/<ticker>', methods=['DELETE'])
def remove_from_watchlist(ticker):
    db = get_db()
    db.execute('DELETE FROM prediction_watchlist WHERE market_ticker = ?', (ticker,))
    db.commit()
    db.close()
    return jsonify({'deleted': ticker})


# ─────────────────────────────────────────
#  MARKET SEARCH + LIVE DATA
# ─────────────────────────────────────────

@predictions_bp.route('/markets/search', methods=['GET'])
def search_markets():
    if not _is_configured():
        return jsonify({'error': 'Kalshi not configured'}), 400
    query = request.args.get('q', '')
    limit = min(int(request.args.get('limit', 20)), 50)
    try:
        from backend.services.ingestion.kalshi import search_markets as _search
        return jsonify(_search(query, limit=limit))
    except Exception as e:
        return jsonify({'error': str(e)}), 503


@predictions_bp.route('/markets/<ticker>', methods=['GET'])
def get_market(ticker):
    if not _is_configured():
        return jsonify({'error': 'Kalshi not configured'}), 400
    try:
        from backend.services.ingestion.kalshi import get_market as _get_market
        return jsonify(_get_market(ticker))
    except Exception as e:
        return jsonify({'error': str(e)}), 503


# ─────────────────────────────────────────
#  ORDER PLACEMENT (with server-side confirm)
# ─────────────────────────────────────────

@predictions_bp.route('/orders/preview', methods=['POST'])
def preview_order():
    """
    Return order details for confirm modal without placing.
    Body: { ticker, side, action, contracts, price }
    """
    data = request.get_json() or {}
    ticker    = data.get('ticker', '')
    side      = data.get('side', 'yes')
    action    = data.get('action', 'buy')
    contracts = int(data.get('contracts', 1))
    price     = float(data.get('price', 0))

    total_cost = price * contracts

    return jsonify({
        'ticker':     ticker,
        'side':       side,
        'action':     action,
        'contracts':  contracts,
        'price':      price,
        'total_cost': round(total_cost, 2),
        'demo_mode':  os.environ.get('KALSHI_DEMO_MODE', 'false').lower() == 'true',
        'warning':    'This will place a REAL order on Kalshi' if
                      os.environ.get('KALSHI_DEMO_MODE', 'false').lower() != 'true'
                      else 'Demo mode — no real money',
    })


@predictions_bp.route('/orders', methods=['POST'])
def place_order():
    """
    Place an order. Requires explicit confirm=true in body.
    Body: { ticker, side, action, contracts, price, confirm: true }
    """
    if not _is_configured():
        return jsonify({'error': 'Kalshi not configured'}), 400

    data    = request.get_json() or {}
    if not data.get('confirm'):
        return jsonify({'error': 'confirm: true required to place order'}), 400

    ticker    = data.get('ticker', '')
    side      = data.get('side', 'yes')
    action    = data.get('action', 'buy')
    contracts = int(data.get('contracts', 1))
    price     = float(data.get('price', 0))

    if not ticker or contracts <= 0 or price <= 0:
        return jsonify({'error': 'ticker, contracts, and price are required'}), 400

    try:
        from backend.services.ingestion.kalshi import place_order as _place
        result = _place(ticker, side, action, contracts, price)
        return jsonify({'ok': True, 'order': result})
    except Exception as e:
        return jsonify({'error': str(e)}), 503


@predictions_bp.route('/orders/<order_id>/cancel', methods=['POST'])
def cancel_order(order_id):
    if not _is_configured():
        return jsonify({'error': 'Kalshi not configured'}), 400
    try:
        from backend.services.ingestion.kalshi import cancel_order as _cancel
        result = _cancel(order_id)
        return jsonify({'ok': True, 'result': result})
    except Exception as e:
        return jsonify({'error': str(e)}), 503


# ─────────────────────────────────────────
#  SYNC TRIGGER
# ─────────────────────────────────────────

@predictions_bp.route('/sync', methods=['POST'])
def manual_sync():
    if not _is_configured():
        return jsonify({'error': 'Kalshi not configured'}), 400
    try:
        from backend.services.ingestion.kalshi import sync_kalshi
        result = sync_kalshi()
        return jsonify({'ok': True, **result})
    except Exception as e:
        return jsonify({'error': str(e)}), 503
