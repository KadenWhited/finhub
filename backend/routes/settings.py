from flask import Blueprint, request, jsonify
from backend.models.database import get_db

settings_bp = Blueprint('settings', __name__)

VALID_KEYS = {
    'starting_capital', 'currency', 'risk_per_trade_pct',
    'max_open_positions', 'max_daily_loss_pct', 'preferred_trade_duration',
    'alert_threshold_pct'
}

@settings_bp.route('/', methods=['GET'])
def get_settings():
    db = get_db()
    rows = db.execute('SELECT * FROM settings').fetchall()
    db.close()
    return jsonify({r['key']: r['value'] for r in rows})

@settings_bp.route('/', methods=['PUT'])
def update_settings():
    data = request.get_json()
    db = get_db()
    for key, value in data.items():
        if key not in VALID_KEYS:
            continue
        db.execute(
            'INSERT INTO settings (key, value) VALUES (?, ?) '
            'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
            (key, str(value))
        )
    db.commit()
    rows = db.execute('SELECT * FROM settings').fetchall()
    db.close()
    return jsonify({r['key']: r['value'] for r in rows})