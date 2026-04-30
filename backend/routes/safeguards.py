"""
backend/routes/safeguards.py
Revenge trading safeguard state and configuration.
"""
from flask import Blueprint, request, jsonify
from backend.models.database import get_db
from backend.services.safeguards import get_safeguard_state

safeguards_bp = Blueprint('safeguards', __name__)


@safeguards_bp.route('/state', methods=['GET'])
def get_state():
    db = get_db()
    state = get_safeguard_state(db)
    db.close()
    return jsonify(state)


@safeguards_bp.route('/config', methods=['PUT'])
def update_config():
    """Update safeguard thresholds."""
    data = request.get_json() or {}
    db = get_db()
    for key in ('revenge_trade_threshold', 'revenge_cooldown_hours'):
        if key in data:
            db.execute(
                'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
                (key, str(int(data[key])))
            )
    db.commit()
    state = get_safeguard_state(db)
    db.close()
    return jsonify(state)


@safeguards_bp.route('/override', methods=['POST'])
def override_cooldown():
    """
    Manually override the cooldown (user acknowledges risk).
    Records the override in settings for audit.
    """
    from datetime import datetime
    db = get_db()
    db.execute(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
        ('safeguard_override_at', datetime.utcnow().isoformat())
    )
    db.commit()
    db.close()
    return jsonify({'ok': True, 'message': 'Cooldown override recorded.'})
