from flask import Blueprint, request, jsonify
from backend.models.database import get_db

checkbook_bp = Blueprint('checkbook', __name__)

@checkbook_bp.route('/', methods=['GET'])
def get_entries():
    db = get_db()
    entries = db.execute('SELECT * FROM checkbook ORDER BY date DESC, id DESC').fetchall()
    db.close()
    return jsonify([dict(e) for e in entries])

@checkbook_bp.route('/', methods=['POST'])
def create_entry():
    data = request.get_json()
    required = ['type', 'amount', 'category', 'date']
    for f in required:
        if f not in data:
            return jsonify({'error': f'Missing: {f}'}), 400
    if data['type'] not in ('income', 'expense'):
        return jsonify({'error': 'type must be income or expense'}), 400

    db = get_db()
    c = db.cursor()
    c.execute('''
        INSERT INTO checkbook (type, amount, category, description, date)
        VALUES (?, ?, ?, ?, ?)
    ''', (data['type'], abs(float(data['amount'])), data['category'],
          data.get('description', ''), data['date']))
    new_id = c.lastrowid
    db.commit()
    entry = db.execute('SELECT * FROM checkbook WHERE id = ?', (new_id,)).fetchone()
    db.close()
    return jsonify(dict(entry)), 201

@checkbook_bp.route('/<int:entry_id>', methods=['PUT'])
def update_entry(entry_id):
    data = request.get_json()
    db = get_db()
    existing = db.execute('SELECT * FROM checkbook WHERE id = ?', (entry_id,)).fetchone()
    if not existing:
        db.close()
        return jsonify({'error': 'Not found'}), 404

    fields = ['type', 'amount', 'category', 'description', 'date']
    updates = {f: data[f] for f in fields if f in data}
    set_clause = ', '.join(f'{k} = ?' for k in updates)
    db.execute(f'UPDATE checkbook SET {set_clause} WHERE id = ?', list(updates.values()) + [entry_id])
    db.commit()
    entry = db.execute('SELECT * FROM checkbook WHERE id = ?', (entry_id,)).fetchone()
    db.close()
    return jsonify(dict(entry))

@checkbook_bp.route('/<int:entry_id>', methods=['DELETE'])
def delete_entry(entry_id):
    db = get_db()
    db.execute('DELETE FROM checkbook WHERE id = ?', (entry_id,))
    db.commit()
    db.close()
    return jsonify({'deleted': entry_id})

@checkbook_bp.route('/stats', methods=['GET'])
def get_stats():
    db = get_db()
    rows = db.execute('SELECT * FROM checkbook ORDER BY date ASC, id ASC').fetchall()
    db.close()
    entries = [dict(r) for r in rows]

    total_income = sum(e['amount'] for e in entries if e['type'] == 'income')
    total_expenses = sum(e['amount'] for e in entries if e['type'] == 'expense')
    balance = total_income - total_expenses

    # Category breakdown
    cats = {}
    for e in entries:
        key = e['category']
        if key not in cats:
            cats[key] = {'income': 0, 'expense': 0}
        cats[key][e['type']] += e['amount']

    return jsonify({
        'total_income': round(total_income, 2),
        'total_expenses': round(total_expenses, 2),
        'balance': round(balance, 2),
        'categories': cats,
        'entry_count': len(entries)
    })
