from flask import Blueprint, jsonify
from backend.models.database import get_db

dashboard_bp = Blueprint('dashboard', __name__)

@dashboard_bp.route('/summary', methods=['GET'])
def get_summary():
    db = get_db()
    settings_rows = db.execute('SELECT * FROM settings').fetchall()
    settings = {r['key']: r['value'] for r in settings_rows}
    starting_capital = float(settings.get('starting_capital', 350))

    # Trade summary
    closed_trades = db.execute('SELECT * FROM trades WHERE status = "closed"').fetchall()
    open_trades = db.execute('SELECT COUNT(*) as cnt FROM trades WHERE status = "open"').fetchone()['cnt']
    trade_pnls = []
    for t in closed_trades:
        t = dict(t)
        if t['exit_price'] and t['entry_price']:
            if t.get('direction', 'long') == 'long':
                pnl = (t['exit_price'] - t['entry_price']) * t['position_size']
            else:
                pnl = (t['entry_price'] - t['exit_price']) * t['position_size']
            trade_pnls.append(pnl)
    wins = [p for p in trade_pnls if p > 0]
    total_trade_pnl = sum(trade_pnls)
    win_rate = (len(wins) / len(trade_pnls) * 100) if trade_pnls else 0
    revenge_alert = len(trade_pnls) >= 3 and all(p < 0 for p in trade_pnls[-3:])

    # Checkbook summary
    cb_rows = db.execute('SELECT type, SUM(amount) as total FROM checkbook GROUP BY type').fetchall()
    income, expenses = 0, 0
    for r in cb_rows:
        if r['type'] == 'income': income = r['total']
        elif r['type'] == 'expense': expenses = r['total']

    # Gambling summary
    g = db.execute('SELECT SUM(buy_in) as wagered, SUM(cash_out) as cashout FROM gambling_sessions').fetchone()
    total_wagered = g['wagered'] or 0
    total_cashout = g['cashout'] or 0

    # Credit summary
    accounts = db.execute('SELECT * FROM credit_accounts').fetchall()
    total_credit_balance = 0
    total_credit_limit = 0
    for a in accounts:
        txns = db.execute(
            'SELECT type, SUM(amount) as total FROM credit_transactions WHERE account_id = ? GROUP BY type',
            (a['id'],)
        ).fetchall()
        charges = sum(t['total'] for t in txns if t['type'] == 'charge')
        payments = sum(t['total'] for t in txns if t['type'] == 'payment')
        total_credit_balance += charges - payments
        if a['credit_limit']:
            total_credit_limit += a['credit_limit']

    db.close()

    return jsonify({
        'trades': {
            'total_closed': len(closed_trades),
            'open_trades': open_trades,
            'total_pnl': round(total_trade_pnl, 4),
            'win_rate': round(win_rate, 1),
            'revenge_alert': revenge_alert
        },
        'checkbook': {
            'balance': round(income - expenses, 2),
            'total_income': round(income, 2),
            'total_expenses': round(expenses, 2)
        },
        'gambling': {
            'net_pnl': round(total_cashout - total_wagered, 2),
            'total_wagered': round(total_wagered, 2),
            'roi_pct': round(((total_cashout - total_wagered) / total_wagered * 100), 1) if total_wagered else 0
        },
        'credit': {
            'total_balance': round(total_credit_balance, 2),
            'total_limit': round(total_credit_limit, 2),
            'utilization_pct': round((total_credit_balance / total_credit_limit * 100), 1) if total_credit_limit else None
        },
        'settings': {
            'starting_capital': starting_capital,
            'current_capital': round(starting_capital + total_trade_pnl, 2),
            'capital_growth_pct': round((total_trade_pnl / starting_capital) * 100, 2) if starting_capital else 0
        }
    })