from flask import Blueprint, request, jsonify
from backend.models.database import get_db

trades_bp = Blueprint('trades', __name__)

def calculate_pnl(entry, exit_p, size, direction='long'):
    if direction == 'long':
        return (exit_p - entry) * size
    else:
        return (entry - exit_p) * size

def calculate_pnl_pct(entry, exit_p, direction='long'):
    if direction == 'long':
        return ((exit_p - entry) / entry) * 100
    else:
        return ((entry - exit_p) / entry) * 100

def row_to_dict(row):
    d = dict(row)
    if d.get('exit_price') and d.get('entry_price'):
        d['pnl'] = round(calculate_pnl(d['entry_price'], d['exit_price'], d['position_size'], d.get('direction','long')), 4)
        d['pnl_pct'] = round(calculate_pnl_pct(d['entry_price'], d['exit_price'], d.get('direction','long')), 2)
    else:
        d['pnl'] = None
        d['pnl_pct'] = None
    return d

@trades_bp.route('/', methods=['GET'])
def get_trades():
    db = get_db()
    trades = db.execute('SELECT * FROM trades ORDER BY entry_date DESC').fetchall()
    db.close()
    return jsonify([row_to_dict(t) for t in trades])

@trades_bp.route('/<int:trade_id>', methods=['GET'])
def get_trade(trade_id):
    db = get_db()
    trade = db.execute('SELECT * FROM trades WHERE id = ?', (trade_id,)).fetchone()
    db.close()
    if not trade:
        return jsonify({'error': 'Trade not found'}), 404
    return jsonify(row_to_dict(trade))

@trades_bp.route('/', methods=['POST'])
def create_trade():
    data = request.get_json()
    required = ['coin', 'entry_price', 'position_size', 'entry_date']
    for field in required:
        if field not in data:
            return jsonify({'error': f'Missing field: {field}'}), 400

    db = get_db()
    c = db.cursor()
    c.execute('''
        INSERT INTO trades (coin, direction, entry_price, exit_price, position_size, entry_date, exit_date, reason, notes, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        data['coin'].upper(),
        data.get('direction', 'long'),
        float(data['entry_price']),
        float(data['exit_price']) if data.get('exit_price') else None,
        float(data['position_size']),
        data['entry_date'],
        data.get('exit_date'),
        data.get('reason', ''),
        data.get('notes', ''),
        'closed' if data.get('exit_price') else 'open'
    ))
    new_id = c.lastrowid
    db.commit()
    trade = db.execute('SELECT * FROM trades WHERE id = ?', (new_id,)).fetchone()
    db.close()
    return jsonify(row_to_dict(trade)), 201

@trades_bp.route('/<int:trade_id>', methods=['PUT'])
def update_trade(trade_id):
    data = request.get_json()
    db = get_db()
    existing = db.execute('SELECT * FROM trades WHERE id = ?', (trade_id,)).fetchone()
    if not existing:
        db.close()
        return jsonify({'error': 'Trade not found'}), 404

    fields = ['coin', 'direction', 'entry_price', 'exit_price', 'position_size',
              'entry_date', 'exit_date', 'reason', 'notes', 'status']
    updates = {}
    for f in fields:
        if f in data:
            updates[f] = data[f]
    if 'exit_price' in updates and updates['exit_price']:
        updates['status'] = 'closed'

    set_clause = ', '.join(f'{k} = ?' for k in updates)
    values = list(updates.values()) + [trade_id]
    db.execute(f'UPDATE trades SET {set_clause} WHERE id = ?', values)
    db.commit()
    trade = db.execute('SELECT * FROM trades WHERE id = ?', (trade_id,)).fetchone()
    db.close()
    return jsonify(row_to_dict(trade))

@trades_bp.route('/<int:trade_id>', methods=['DELETE'])
def delete_trade(trade_id):
    db = get_db()
    db.execute('DELETE FROM trades WHERE id = ?', (trade_id,))
    db.commit()
    db.close()
    return jsonify({'deleted': trade_id})

@trades_bp.route('/stats', methods=['GET'])
def get_stats():
    db = get_db()
    trades = db.execute('SELECT * FROM trades WHERE status = "closed"').fetchall()
    open_trades = db.execute('SELECT * FROM trades WHERE status = "open"').fetchall()
    db.close()

    closed = [row_to_dict(t) for t in trades]
    pnls = [t['pnl'] for t in closed if t['pnl'] is not None]

    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p <= 0]

    total_pnl = sum(pnls)
    win_rate = (len(wins) / len(pnls) * 100) if pnls else 0
    avg_win = sum(wins) / len(wins) if wins else 0
    avg_loss = sum(losses) / len(losses) if losses else 0
    profit_factor = (sum(wins) / abs(sum(losses))) if losses and sum(losses) != 0 else None

    # Revenge trading detection: last 3 closed trades
    revenge_flag = False
    if len(closed) >= 3:
        last3 = sorted(closed, key=lambda x: x.get('exit_date') or '', reverse=True)[:3]
        if all(t['pnl'] is not None and t['pnl'] < 0 for t in last3):
            revenge_flag = True

    return jsonify({
        'total_trades': len(closed),
        'open_trades': len(open_trades),
        'total_pnl': round(total_pnl, 4),
        'win_rate': round(win_rate, 1),
        'avg_win': round(avg_win, 4),
        'avg_loss': round(avg_loss, 4),
        'profit_factor': round(profit_factor, 2) if profit_factor else None,
        'total_wins': len(wins),
        'total_losses': len(losses),
        'revenge_trading_alert': revenge_flag
    })
