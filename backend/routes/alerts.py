"""
backend/routes/alerts.py — Stage 4 Enhanced
"""
from flask import Blueprint, request, jsonify
from backend.models.database import get_db
from backend.services.notifications import (
    get_alert_status, send_test_notification,
    _last_alerts, get_default_settings,
    PRIORITY, PRIORITY_LABEL
)

alerts_bp = Blueprint('alerts', __name__)


@alerts_bp.route('/status', methods=['GET'])
def status():
    db       = get_db()
    rows     = db.execute('SELECT * FROM settings').fetchall()
    settings = {r['key']: r['value'] for r in rows}
    db.close()

    base = get_alert_status()
    base['settings'] = {
        k: v for k, v in settings.items()
        if k.startswith('alert_')
    }
    return jsonify(base)


@alerts_bp.route('/test', methods=['POST'])
def test_alert():
    data     = request.get_json() or {}
    channels = data.get('channels', 'all')   # 'all' | 'desktop' | 'telegram' | 'ntfy' | 'push'
    priority = data.get('priority', 'medium') # 'low' | 'medium' | 'high'

    results = send_test_notification(channels=channels, priority=priority)
    any_sent = any(results.values())

    return jsonify({
        'sent':     any_sent,
        'results':  results,
        'priority': priority,
        'channels': channels,
        'message':  'Check results below' if any_sent else 'All channels failed — check configuration'
    })


@alerts_bp.route('/clear', methods=['POST'])
def clear_cooldowns():
    _last_alerts.clear()
    return jsonify({'ok': True, 'message': 'Alert cooldowns cleared'})


@alerts_bp.route('/settings', methods=['GET'])
def get_settings():
    """Return all alert settings with defaults filled in."""
    db       = get_db()
    rows     = db.execute('SELECT * FROM settings').fetchall()
    db.close()

    defaults = get_default_settings()
    settings = {**defaults}
    settings.update({r['key']: r['value'] for r in rows if r['key'].startswith('alert_')})

    return jsonify(settings)


@alerts_bp.route('/settings', methods=['PUT'])
def update_settings():
    """Bulk update alert settings."""
    data = request.get_json() or {}
    db   = get_db()

    # Only allow keys that start with 'alert_'
    allowed = {k: v for k, v in data.items() if k.startswith('alert_')}
    for key, value in allowed.items():
        db.execute(
            'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
            (key, str(value))
        )

    db.commit()
    db.close()
    return jsonify({'ok': True, 'updated': len(allowed)})
