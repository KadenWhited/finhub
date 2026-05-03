import csv, os, io, json
from datetime import datetime
from flask import Blueprint, request, jsonify, Response, session
from backend.models.database import get_db

export_bp = Blueprint('export', __name__)

def get_all_data(db):
    trades = [dict(r) for r in db.execute('SELECT * FROM trades ORDER BY entry_date DESC').fetchall()]
    checkbook = [dict(r) for r in db.execute('SELECT * FROM checkbook ORDER BY date DESC').fetchall()]
    gambling = [dict(r) for r in db.execute('SELECT * FROM gambling_sessions ORDER BY date DESC').fetchall()]
    credit_accounts = [dict(r) for r in db.execute('SELECT * FROM credit_accounts').fetchall()]
    credit_txns = [dict(r) for r in db.execute('SELECT * FROM credit_transactions ORDER BY date DESC').fetchall()]
    settings = {r['key']: r['value'] for r in db.execute('SELECT * FROM settings').fetchall()}
    return {
        'trades': trades,
        'checkbook': checkbook,
        'gambling_sessions': gambling,
        'credit_accounts': credit_accounts,
        'credit_transactions': credit_txns,
        'settings': settings,
        'exported_at': datetime.now().isoformat()
    }

@export_bp.route('/json', methods=['GET'])
def export_json():
    if os.environ.get('APP_PASSWORD') and not session.get('authenticated'):
        return jsonify({'error': 'Unauthorized'}), 401
    db = get_db()
    data = get_all_data(db)
    db.close()
    response = Response(
        json.dumps(data, indent=2),
        mimetype='application/json',
        headers={'Content-Disposition': f'attachment; filename=finance_hub_export_{datetime.now().strftime("%Y%m%d")}.json'}
    )
    return response

@export_bp.route('/csv/<table>', methods=['GET'])
def export_csv(table):
    allowed = {
        'trades': 'SELECT * FROM trades ORDER BY entry_date DESC',
        'checkbook': 'SELECT * FROM checkbook ORDER BY date DESC',
        'gambling': 'SELECT * FROM gambling_sessions ORDER BY date DESC',
        'credit': 'SELECT ct.*, ca.name as account_name FROM credit_transactions ct JOIN credit_accounts ca ON ct.account_id = ca.id ORDER BY ct.date DESC',
    }
    if table not in allowed:
        return jsonify({'error': f'Unknown table. Choose from: {", ".join(allowed)}'}), 400

    db = get_db()
    rows = db.execute(allowed[table]).fetchall()
    db.close()

    if not rows:
        return jsonify({'error': 'No data to export'}), 404

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=rows[0].keys())
    writer.writeheader()
    writer.writerows([dict(r) for r in rows])

    return Response(
        output.getvalue(),
        mimetype='text/csv',
        headers={'Content-Disposition': f'attachment; filename=finhub_{table}_{datetime.now().strftime("%Y%m%d")}.csv'}
    )

@export_bp.route('/import', methods=['POST'])
def import_json():
    """Restore from a full JSON export. Merges — does not wipe existing data."""
    data = request.get_json()
    if not data or not isinstance(data, dict):
        return jsonify({'error': 'Invalid JSON'}), 400
    
    allowed_keys = {'trades','checkbook','gambling_sessions','credit_accounts','credit_transactions','settings','exported_at'}
    unexpected = set(data.keys()) - allowed_keys

    if unexpected:
        return jsonify({'error': f'Unexpected keys: {unexpected}'}), 400

    db = get_db()
    imported = {'trades': 0, 'checkbook': 0, 'gambling': 0, 'credit_accounts': 0, 'credit_transactions': 0}

    try:
        for t in data.get('trades', []):
            db.execute('''INSERT OR IGNORE INTO trades
                (id,coin,direction,entry_price,exit_price,position_size,entry_date,exit_date,reason,notes,status,created_at)
                VALUES (:id,:coin,:direction,:entry_price,:exit_price,:position_size,:entry_date,:exit_date,:reason,:notes,:status,:created_at)''', t)
            imported['trades'] += 1

        for e in data.get('checkbook', []):
            db.execute('INSERT OR IGNORE INTO checkbook (id,type,amount,category,description,date,created_at) VALUES (:id,:type,:amount,:category,:description,:date,:created_at)', e)
            imported['checkbook'] += 1

        for g in data.get('gambling_sessions', []):
            db.execute('INSERT OR IGNORE INTO gambling_sessions (id,game_type,venue,buy_in,cash_out,date,duration_minutes,notes,created_at) VALUES (:id,:game_type,:venue,:buy_in,:cash_out,:date,:duration_minutes,:notes,:created_at)', g)
            imported['gambling'] += 1

        for a in data.get('credit_accounts', []):
            db.execute('INSERT OR IGNORE INTO credit_accounts (id,name,last_four,credit_limit,balance,created_at) VALUES (:id,:name,:last_four,:credit_limit,:balance,:created_at)', a)
            imported['credit_accounts'] += 1

        for t in data.get('credit_transactions', []):
            db.execute('INSERT OR IGNORE INTO credit_transactions (id,account_id,type,amount,category,description,date,created_at) VALUES (:id,:account_id,:type,:amount,:category,:description,:date,:created_at)', t)
            imported['credit_transactions'] += 1

        db.commit()
    except Exception as e:
        db.rollback()
        db.close()
        return jsonify({'error': str(e)}), 500

    db.close()
    return jsonify({'imported': imported})