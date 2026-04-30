"""
backend/routes/gambling.py — Stage 3b
Adds total_winnings (sum of all cash-out sessions that were profitable).
"""
from flask import Blueprint, request, jsonify
from backend.models.database import get_db

gambling_bp = Blueprint('gambling', __name__)


def session_to_dict(row):
    d = dict(row)
    d['net_result'] = round(d['cash_out'] - d['buy_in'], 2)
    d['roi_pct']    = round(((d['cash_out'] - d['buy_in']) / d['buy_in']) * 100, 1) \
                      if d['buy_in'] else 0
    return d


@gambling_bp.route('/', methods=['GET'])
def get_sessions():
    db = get_db()
    sessions = db.execute(
        'SELECT * FROM gambling_sessions ORDER BY date DESC, id DESC'
    ).fetchall()
    db.close()
    return jsonify([session_to_dict(s) for s in sessions])


@gambling_bp.route('/', methods=['POST'])
def create_session():
    data = request.get_json()
    for f in ['game_type', 'buy_in', 'cash_out', 'date']:
        if f not in data:
            return jsonify({'error': f'Missing: {f}'}), 400

    db = get_db()
    c  = db.cursor()
    c.execute('''
        INSERT INTO gambling_sessions
            (game_type, venue, buy_in, cash_out, date, duration_minutes, notes)
        VALUES (?,?,?,?,?,?,?)
    ''', (
        data['game_type'], data.get('venue',''),
        float(data['buy_in']), float(data['cash_out']),
        data['date'], data.get('duration_minutes'), data.get('notes','')
    ))
    new_id = c.lastrowid
    db.commit()
    session = db.execute('SELECT * FROM gambling_sessions WHERE id = ?', (new_id,)).fetchone()
    db.close()
    return jsonify(session_to_dict(session)), 201


@gambling_bp.route('/<int:session_id>', methods=['PUT'])
def update_session(session_id):
    data = request.get_json()
    db   = get_db()
    if not db.execute('SELECT id FROM gambling_sessions WHERE id = ?', (session_id,)).fetchone():
        db.close()
        return jsonify({'error': 'Not found'}), 404
    fields  = ['game_type','venue','buy_in','cash_out','date','duration_minutes','notes']
    updates = {f: data[f] for f in fields if f in data}
    db.execute(
        f"UPDATE gambling_sessions SET {', '.join(f'{k}=?' for k in updates)} WHERE id = ?",
        list(updates.values()) + [session_id]
    )
    db.commit()
    session = db.execute('SELECT * FROM gambling_sessions WHERE id = ?', (session_id,)).fetchone()
    db.close()
    return jsonify(session_to_dict(session))


@gambling_bp.route('/<int:session_id>', methods=['DELETE'])
def delete_session(session_id):
    db = get_db()
    db.execute('DELETE FROM gambling_sessions WHERE id = ?', (session_id,))
    db.commit()
    db.close()
    return jsonify({'deleted': session_id})


@gambling_bp.route('/stats', methods=['GET'])
def get_stats():
    db = get_db()
    rows = db.execute('SELECT * FROM gambling_sessions').fetchall()
    db.close()
    sessions = [session_to_dict(r) for r in rows]

    total_buy_in   = sum(s['buy_in']   for s in sessions)
    total_cash_out = sum(s['cash_out'] for s in sessions)
    net_pnl        = total_cash_out - total_buy_in
    roi            = (net_pnl / total_buy_in * 100) if total_buy_in else 0

    wins   = [s for s in sessions if s['net_result'] > 0]
    losses = [s for s in sessions if s['net_result'] < 0]
    pushes = [s for s in sessions if s['net_result'] == 0]

    avg_win  = sum(s['net_result'] for s in wins)   / len(wins)   if wins   else 0
    avg_loss = sum(s['net_result'] for s in losses) / len(losses) if losses else 0

    # Total gross winnings (sum of all winning session cash-outs, not net)
    total_gross_winnings = sum(s['cash_out'] for s in wins)

    # Best and worst single session
    best_session  = max(sessions, key=lambda s: s['net_result']) if sessions else None
    worst_session = min(sessions, key=lambda s: s['net_result']) if sessions else None

    # Current streak
    streak_count = 0
    streak_type  = None
    for s in sorted(sessions, key=lambda x: x['date'], reverse=True):
        t = 'win' if s['net_result'] > 0 else 'loss' if s['net_result'] < 0 else 'push'
        if t == 'push':
            break
        if streak_type is None:
            streak_type = t
        if t == streak_type:
            streak_count += 1
        else:
            break

    # Per game breakdown
    by_game = {}
    for s in sessions:
        g = s['game_type']
        if g not in by_game:
            by_game[g] = {'sessions': 0, 'wagered': 0, 'net': 0,
                          'wins': 0, 'losses': 0, 'gross_winnings': 0}
        by_game[g]['sessions'] += 1
        by_game[g]['wagered']  += s['buy_in']
        by_game[g]['net']      += s['net_result']
        if s['net_result'] > 0:
            by_game[g]['wins']           += 1
            by_game[g]['gross_winnings'] += s['cash_out']
        elif s['net_result'] < 0:
            by_game[g]['losses'] += 1

    return jsonify({
        'total_sessions':       len(sessions),
        'total_wagered':        round(total_buy_in, 2),
        'total_cash_out':       round(total_cash_out, 2),
        'net_pnl':              round(net_pnl, 2),
        'roi_pct':              round(roi, 1),
        'total_gross_winnings': round(total_gross_winnings, 2),
        'winning_sessions':     len(wins),
        'losing_sessions':      len(losses),
        'push_sessions':        len(pushes),
        'win_rate':             round(len(wins)/len(sessions)*100, 1) if sessions else 0,
        'avg_win':              round(avg_win,  2),
        'avg_loss':             round(avg_loss, 2),
        'best_session':         best_session,
        'worst_session':        worst_session,
        'current_streak':       streak_count,
        'streak_type':          streak_type,
        'by_game':              by_game,
    })
