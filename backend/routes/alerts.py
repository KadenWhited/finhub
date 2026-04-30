"""
backend/routes/alerts.py
Price alert management and notification status.
"""
from flask import Blueprint, request, jsonify
from backend.services.notifications import (
    get_alert_status, send_test_notification, _last_alerts, ALERT_COOLDOWN
)

alerts_bp = Blueprint('alerts', __name__)


@alerts_bp.route('/status', methods=['GET'])
def status():
    return jsonify(get_alert_status())


@alerts_bp.route('/test', methods=['POST'])
def test_alert():
    result = send_test_notification()
    return jsonify({
        'sent': result,
        'message': 'Notification sent' if result else
                   'plyer not installed — run: pip install plyer'
    })


@alerts_bp.route('/clear', methods=['POST'])
def clear_cooldowns():
    """Reset all alert cooldowns so they can fire again immediately."""
    _last_alerts.clear()
    return jsonify({'ok': True, 'message': 'Alert cooldowns cleared'})
