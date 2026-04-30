"""
backend/routes/charts.py
Serves chart data for:
  - Crypto price history (CoinGecko)
  - Stock price history (yfinance)
  - Stock watchlist / portfolio
  - Spending over time (checkbook + credit)
  - Trade P&L over time
  - Gambling P&L over time
  - Net worth over time
"""
from flask import Blueprint, request, jsonify
from backend.models.database import get_db
from backend.services.charts import get_crypto_chart, get_stock_chart, get_stock_quote

charts_bp = Blueprint('charts', __name__)

VALID_RANGES = {'6h', '1d', '1w', '1m', '3m', '6m', '1y', 'all'}


def _range_param():
    r = request.args.get('range', '1m')
    return r if r in VALID_RANGES else '1m'


# ─────────────────────────────────────────
#  CRYPTO PRICE CHART
# ─────────────────────────────────────────

@charts_bp.route('/crypto/<coin_id>', methods=['GET'])
def crypto_chart(coin_id):
    data, err = get_crypto_chart(coin_id, _range_param())
    if err and not data:
        return jsonify({'error': err}), 503
    return jsonify({**data, 'warning': err})


# ─────────────────────────────────────────
#  STOCK PRICE CHART + QUOTE
# ─────────────────────────────────────────

@charts_bp.route('/stock/<ticker>', methods=['GET'])
def stock_chart(ticker):
    data, err = get_stock_chart(ticker.upper(), _range_param())
    if err and not data:
        return jsonify({'error': err}), 503
    return jsonify({**data, 'warning': err})


@charts_bp.route('/stock/<ticker>/quote', methods=['GET'])
def stock_quote(ticker):
    data, err = get_stock_quote(ticker.upper())
    if err and not data:
        return jsonify({'error': err}), 503
    return jsonify({**data, 'warning': err})


# ─────────────────────────────────────────
#  STOCK WATCHLIST  (stored in DB)
# ─────────────────────────────────────────

@charts_bp.route('/stocks/watchlist', methods=['GET'])
def get_stock_watchlist():
    db = get_db()
    rows = db.execute('SELECT * FROM stock_watchlist ORDER BY sort_order ASC, added_at ASC').fetchall()
    db.close()
    items = [dict(r) for r in rows]

    results = []
    for item in items:
        quote, err = get_stock_quote(item['ticker'])
        results.append({**item, 'quote': quote, 'quote_error': err})
    return jsonify(results)


@charts_bp.route('/stocks/watchlist', methods=['POST'])
def add_stock_watchlist():
    data = request.get_json()
    ticker = (data.get('ticker') or '').upper().strip()
    if not ticker:
        return jsonify({'error': 'ticker required'}), 400

    # Validate ticker exists
    quote, err = get_stock_quote(ticker)
    if err or not quote:
        return jsonify({'error': f'Could not find ticker {ticker}: {err}'}), 404

    db = get_db()
    existing = db.execute('SELECT id FROM stock_watchlist WHERE ticker = ?', (ticker,)).fetchone()
    if existing:
        db.close()
        return jsonify({'error': 'Already in watchlist'}), 409

    max_order = db.execute('SELECT MAX(sort_order) as m FROM stock_watchlist').fetchone()['m'] or 0
    db.execute(
        'INSERT INTO stock_watchlist (ticker, name, sort_order) VALUES (?, ?, ?)',
        (ticker, data.get('name', ticker), max_order + 1)
    )
    db.commit()
    db.close()
    return jsonify({'added': ticker, 'quote': quote}), 201


@charts_bp.route('/stocks/watchlist/<ticker>', methods=['DELETE'])
def remove_stock_watchlist(ticker):
    db = get_db()
    db.execute('DELETE FROM stock_watchlist WHERE ticker = ?', (ticker.upper(),))
    db.commit()
    db.close()
    return jsonify({'removed': ticker.upper()})


# ─────────────────────────────────────────
#  PORTFOLIO  (stock positions)
# ─────────────────────────────────────────

@charts_bp.route('/stocks/positions', methods=['GET'])
def get_positions():
    db = get_db()
    rows = db.execute('SELECT * FROM stock_positions ORDER BY purchase_date DESC').fetchall()
    db.close()
    positions = [dict(r) for r in rows]

    total_cost = 0
    total_value = 0
    results = []

    for p in positions:
        quote, err = get_stock_quote(p['ticker'])
        cost_basis = p['shares'] * p['avg_cost']
        current_value = (quote['price'] * p['shares']) if quote and quote.get('price') else None
        pnl = round(current_value - cost_basis, 2) if current_value is not None else None
        pnl_pct = round((pnl / cost_basis) * 100, 2) if pnl is not None and cost_basis else None

        total_cost += cost_basis
        if current_value:
            total_value += current_value

        results.append({
            **p,
            'cost_basis': round(cost_basis, 2),
            'current_value': round(current_value, 2) if current_value else None,
            'pnl': pnl,
            'pnl_pct': pnl_pct,
            'current_price': quote.get('price') if quote else None,
            'quote_error': err
        })

    return jsonify({
        'positions': results,
        'total_cost': round(total_cost, 2),
        'total_value': round(total_value, 2),
        'total_pnl': round(total_value - total_cost, 2),
        'total_pnl_pct': round(((total_value - total_cost) / total_cost) * 100, 2) if total_cost else 0
    })


@charts_bp.route('/stocks/positions', methods=['POST'])
def add_position():
    data = request.get_json()
    required = ['ticker', 'shares', 'avg_cost', 'purchase_date']
    for f in required:
        if f not in data:
            return jsonify({'error': f'Missing: {f}'}), 400

    ticker = data['ticker'].upper()
    db = get_db()
    c = db.cursor()
    c.execute(
        'INSERT INTO stock_positions (ticker, name, shares, avg_cost, purchase_date, notes) VALUES (?, ?, ?, ?, ?, ?)',
        (ticker, data.get('name', ticker), float(data['shares']),
         float(data['avg_cost']), data['purchase_date'], data.get('notes', ''))
    )
    new_id = c.lastrowid
    db.commit()
    row = db.execute('SELECT * FROM stock_positions WHERE id = ?', (new_id,)).fetchone()
    db.close()
    return jsonify(dict(row)), 201


@charts_bp.route('/stocks/positions/<int:pos_id>', methods=['DELETE'])
def delete_position(pos_id):
    db = get_db()
    db.execute('DELETE FROM stock_positions WHERE id = ?', (pos_id,))
    db.commit()
    db.close()
    return jsonify({'deleted': pos_id})


# ─────────────────────────────────────────
#  SPENDING CHART  (checkbook over time)
# ─────────────────────────────────────────

@charts_bp.route('/spending', methods=['GET'])
def spending_chart():
    range_key = _range_param()
    db = get_db()

    cutoff = _range_to_date(range_key)
    cb_q   = 'SELECT * FROM checkbook'
    cr_q   = '''SELECT ct.*, ca.name as account_name
                FROM credit_transactions ct
                JOIN credit_accounts ca ON ct.account_id = ca.id'''
    params = []
    if cutoff:
        cb_q += ' WHERE date >= ?'
        cr_q += ' WHERE ct.date >= ?'
        params = [cutoff]

    cb_rows = [dict(r) for r in db.execute(cb_q + ' ORDER BY date ASC', params).fetchall()]
    cr_rows = [dict(r) for r in db.execute(cr_q + ' ORDER BY ct.date ASC', params).fetchall()]
    db.close()

    from backend.services.recurring import build_monthly_stats
    monthly = build_monthly_stats(cb_rows, cr_rows)

    # Flatten monthly buckets into daily point series for the line charts
    balance_running = 0
    balance_series  = []
    income_series   = []
    expense_series  = []
    by_category     = {}

    # We need daily granularity — rebuild from raw rows
    daily = {}
    for r in cb_rows:
        d = r['date'][:10]
        if d not in daily:
            daily[d] = {'income': 0, 'expense': 0, 'cats': {}}
        if r['type'] == 'income':
            daily[d]['income'] += r['amount']
        else:
            daily[d]['expense'] += r['amount']
            cat = r['category']
            daily[d]['cats'][cat] = daily[d]['cats'].get(cat, 0) + r['amount']

    for r in cr_rows:
        if r.get('type') != 'charge':
            continue
        d = r['date'][:10]
        if d not in daily:
            daily[d] = {'income': 0, 'expense': 0, 'cats': {}}
        daily[d]['expense'] += r['amount']
        cat = r.get('category', 'Other') + ' (Credit)'
        daily[d]['cats'][cat] = daily[d]['cats'].get(cat, 0) + r['amount']

    for d in sorted(daily.keys()):
        balance_running += daily[d]['income'] - daily[d]['expense']
        balance_series.append({'t': d, 'v': round(balance_running, 2)})
        income_series.append({'t': d, 'v': round(daily[d]['income'], 2)})
        expense_series.append({'t': d, 'v': round(daily[d]['expense'], 2)})
        for cat, amt in daily[d]['cats'].items():
            if cat not in by_category:
                by_category[cat] = {}
            by_category[cat][d] = by_category[cat].get(d, 0) + amt

    cat_series = {
        cat: [{'t': d, 'v': round(v, 2)} for d, v in sorted(days.items())]
        for cat, days in by_category.items()
    }

    return jsonify({
        'range': range_key,
        'balance':     balance_series,
        'income':      income_series,
        'expenses':    expense_series,
        'by_category': cat_series,
    })

# ─────────────────────────────────────────
#  TRADE P&L CHART
# ─────────────────────────────────────────

@charts_bp.route('/trades', methods=['GET'])
def trades_chart():
    range_key = _range_param()
    cutoff = _range_to_date(range_key)
    db = get_db()

    query = 'SELECT * FROM trades WHERE status = "closed" AND exit_date IS NOT NULL'
    params = []
    if cutoff:
        query += ' AND exit_date >= ?'
        params.append(cutoff)
    query += ' ORDER BY exit_date ASC'

    rows = [dict(r) for r in db.execute(query, params).fetchall()]
    db.close()

    running = 0
    cumulative = []
    per_trade = []

    for t in rows:
        if t.get('direction', 'long') == 'long':
            pnl = (t['exit_price'] - t['entry_price']) * t['position_size']
        else:
            pnl = (t['entry_price'] - t['exit_price']) * t['position_size']

        pnl = round(pnl, 4)
        running = round(running + pnl, 4)
        d = (t['exit_date'] or '')[:10]

        cumulative.append({'t': d, 'v': running, 'coin': t['coin']})
        per_trade.append({'t': d, 'v': pnl, 'coin': t['coin'], 'dir': t.get('direction', 'long')})

    return jsonify({
        'range': range_key,
        'cumulative_pnl': cumulative,
        'per_trade_pnl': per_trade
    })


# ─────────────────────────────────────────
#  GAMBLING P&L CHART
# ─────────────────────────────────────────

@charts_bp.route('/gambling', methods=['GET'])
def gambling_chart():
    range_key = _range_param()
    cutoff = _range_to_date(range_key)
    db = get_db()

    query = 'SELECT * FROM gambling_sessions'
    params = []
    if cutoff:
        query += ' WHERE date >= ?'
        params.append(cutoff)
    query += ' ORDER BY date ASC'

    rows = [dict(r) for r in db.execute(query, params).fetchall()]
    db.close()

    running = 0
    cumulative = []
    per_session = []

    for s in rows:
        net = round(s['cash_out'] - s['buy_in'], 2)
        running = round(running + net, 2)
        cumulative.append({'t': s['date'][:10], 'v': running, 'game': s['game_type']})
        per_session.append({'t': s['date'][:10], 'v': net, 'game': s['game_type']})

    return jsonify({
        'range': range_key,
        'cumulative_pnl': cumulative,
        'per_session_pnl': per_session
    })


# ─────────────────────────────────────────
#  NET WORTH  (everything combined)
# ─────────────────────────────────────────

@charts_bp.route('/networth', methods=['GET'])
def networth_chart():
    """
    Approximates net worth over time:
    Cash balance + trade cumulative P&L + stock portfolio value - credit balance
    """
    db = get_db()
    settings_rows = db.execute('SELECT * FROM settings').fetchall()
    settings = {r['key']: r['value'] for r in settings_rows}
    starting = float(settings.get('starting_capital', 350))

    # All checkbook entries
    cb = [dict(r) for r in db.execute('SELECT date, type, amount FROM checkbook ORDER BY date ASC').fetchall()]
    # All closed trades
    trades = [dict(r) for r in db.execute(
        'SELECT exit_date, entry_price, exit_price, position_size, direction FROM trades WHERE status="closed" AND exit_date IS NOT NULL ORDER BY exit_date ASC'
    ).fetchall()]
    # Credit balances (charges - payments per day)
    credit = [dict(r) for r in db.execute(
        'SELECT date, type, amount FROM credit_transactions ORDER BY date ASC'
    ).fetchall()]
    db.close()

    # Merge all dates
    all_dates = sorted(set(
        [r['date'][:10] for r in cb] +
        [(r['exit_date'] or '')[:10] for r in trades if r.get('exit_date')] +
        [r['date'][:10] for r in credit]
    ))

    # Build daily deltas
    daily_cash = {}
    for r in cb:
        d = r['date'][:10]
        delta = r['amount'] if r['type'] == 'income' else -r['amount']
        daily_cash[d] = daily_cash.get(d, 0) + delta

    daily_trade_pnl = {}
    for t in trades:
        d = (t['exit_date'] or '')[:10]
        if t.get('direction', 'long') == 'long':
            pnl = (t['exit_price'] - t['entry_price']) * t['position_size']
        else:
            pnl = (t['entry_price'] - t['exit_price']) * t['position_size']
        daily_trade_pnl[d] = daily_trade_pnl.get(d, 0) + pnl

    daily_credit = {}
    for r in credit:
        d = r['date'][:10]
        delta = r['amount'] if r['type'] == 'charge' else -r['amount']
        daily_credit[d] = daily_credit.get(d, 0) + delta

    # Rolling net worth
    cash = starting
    trade_pnl = 0
    credit_bal = 0
    series = []

    for d in all_dates:
        cash += daily_cash.get(d, 0)
        trade_pnl += daily_trade_pnl.get(d, 0)
        credit_bal += daily_credit.get(d, 0)
        nw = round(cash + trade_pnl - credit_bal, 2)
        series.append({'t': d, 'v': nw})

    return jsonify({'net_worth': series, 'starting_capital': starting})


# ─────────────────────────────────────────
#  HELPER
# ─────────────────────────────────────────

def _range_to_date(range_key: str):
    """Returns ISO date string for the start of the range, or None for 'all'."""
    from datetime import datetime, timedelta
    now = datetime.utcnow()
    mapping = {
        '6h':  now - timedelta(hours=6),
        '1d':  now - timedelta(days=1),
        '1w':  now - timedelta(weeks=1),
        '1m':  now - timedelta(days=30),
        '3m':  now - timedelta(days=90),
        '6m':  now - timedelta(days=180),
        '1y':  now - timedelta(days=365),
        'all': None,
    }
    dt = mapping.get(range_key)
    return dt.strftime('%Y-%m-%d') if dt else None
