from flask import Blueprint, request, jsonify
from backend.models.database import get_db

credit_bp = Blueprint('credit', __name__)

@credit_bp.route('/accounts', methods=['GET'])
def get_accounts():
    db = get_db()
    accounts = db.execute('SELECT * FROM credit_accounts ORDER BY name').fetchall()
    result = []
    for a in accounts:
        a = dict(a)
        txns = db.execute(
            'SELECT type, SUM(amount) as total FROM credit_transactions WHERE account_id = ? GROUP BY type',
            (a['id'],)
        ).fetchall()
        charges = sum(t['total'] for t in txns if t['type'] == 'charge')
        payments = sum(t['total'] for t in txns if t['type'] == 'payment')
        a['computed_balance'] = round(charges - payments, 2)
        a['utilization_pct'] = round((a['computed_balance'] / a['credit_limit'] * 100), 1) if a['credit_limit'] else None
        result.append(a)
    db.close()
    return jsonify(result)

@credit_bp.route('/accounts', methods=['POST'])
def create_account():
    data = request.get_json()
    if not data.get('name'):
        return jsonify({'error': 'name required'}), 400
    db = get_db()
    c = db.cursor()
    c.execute(
        'INSERT INTO credit_accounts (name, last_four, credit_limit) VALUES (?, ?, ?)',
        (data['name'], data.get('last_four', ''), data.get('credit_limit'))
    )
    new_id = c.lastrowid
    db.commit()
    account = db.execute('SELECT * FROM credit_accounts WHERE id = ?', (new_id,)).fetchone()
    db.close()
    return jsonify(dict(account)), 201

@credit_bp.route('/accounts/<int:acct_id>', methods=['DELETE'])
def delete_account(acct_id):
    db = get_db()
    db.execute('DELETE FROM credit_transactions WHERE account_id = ?', (acct_id,))
    db.execute('DELETE FROM credit_accounts WHERE id = ?', (acct_id,))
    db.commit()
    db.close()
    return jsonify({'deleted': acct_id})

@credit_bp.route('/transactions', methods=['GET'])
def get_transactions():
    account_id = request.args.get('account_id')
    db = get_db()
    if account_id:
        rows = db.execute(
            'SELECT ct.*, ca.name as account_name FROM credit_transactions ct JOIN credit_accounts ca ON ct.account_id = ca.id WHERE ct.account_id = ? ORDER BY ct.date DESC, ct.id DESC',
            (account_id,)
        ).fetchall()
    else:
        rows = db.execute(
            'SELECT ct.*, ca.name as account_name FROM credit_transactions ct JOIN credit_accounts ca ON ct.account_id = ca.id ORDER BY ct.date DESC, ct.id DESC'
        ).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])

@credit_bp.route('/transactions', methods=['POST'])
def create_transaction():
    data = request.get_json()
    required = ['account_id', 'type', 'amount', 'category', 'date']
    for f in required:
        if f not in data:
            return jsonify({'error': f'Missing: {f}'}), 400
    if data['type'] not in ('charge', 'payment'):
        return jsonify({'error': 'type must be charge or payment'}), 400
    db = get_db()
    c = db.cursor()
    c.execute(
        'INSERT INTO credit_transactions (account_id, type, amount, category, description, date) VALUES (?, ?, ?, ?, ?, ?)',
        (data['account_id'], data['type'], abs(float(data['amount'])),
         data['category'], data.get('description', ''), data['date'])
    )
    new_id = c.lastrowid
    db.commit()
    row = db.execute(
        'SELECT ct.*, ca.name as account_name FROM credit_transactions ct JOIN credit_accounts ca ON ct.account_id = ca.id WHERE ct.id = ?',
        (new_id,)
    ).fetchone()
    db.close()
    return jsonify(dict(row)), 201

@credit_bp.route('/transactions/<int:txn_id>', methods=['DELETE'])
def delete_transaction(txn_id):
    db = get_db()
    db.execute('DELETE FROM credit_transactions WHERE id = ?', (txn_id,))
    db.commit()
    db.close()
    return jsonify({'deleted': txn_id})

@credit_bp.route('/stats', methods=['GET'])
def get_stats():
    db = get_db()
    accounts = db.execute('SELECT * FROM credit_accounts').fetchall()
    total_balance = 0
    total_limit = 0
    result = []
    for a in accounts:
        a = dict(a)
        txns = db.execute(
            'SELECT type, SUM(amount) as total FROM credit_transactions WHERE account_id = ? GROUP BY type',
            (a['id'],)
        ).fetchall()
        charges = sum(t['total'] for t in txns if t['type'] == 'charge')
        payments = sum(t['total'] for t in txns if t['type'] == 'payment')
        bal = round(charges - payments, 2)
        a['computed_balance'] = bal
        total_balance += bal
        if a['credit_limit']:
            total_limit += a['credit_limit']
        result.append(a)
    db.close()
    return jsonify({
        'total_balance': round(total_balance, 2),
        'total_limit': round(total_limit, 2),
        'overall_utilization': round((total_balance / total_limit * 100), 1) if total_limit else None,
        'accounts': result
    })