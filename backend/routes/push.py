"""
backend/routes/push.py
Web Push notification management.
Stores push subscriptions and sends notifications via pywebpush.

Install: pip install pywebpush
"""
import json
import os
from flask import Blueprint, request, jsonify
from backend.models.database import get_db

push_bp = Blueprint('push', __name__)


def _get_vapid_keys():
    private = os.environ.get('VAPID_PRIVATE_KEY')
    public  = os.environ.get('VAPID_PUBLIC_KEY')
    email   = os.environ.get('VAPID_EMAIL', 'mailto:admin@finhub.local')
    return private, public, email


@push_bp.route('/subscribe', methods=['POST'])
def subscribe():
    data = request.get_json()
    if not data or 'endpoint' not in data:
        return jsonify({'error': 'Invalid subscription'}), 400

    db = get_db()
    # Store as JSON in settings table keyed by endpoint hash
    key = f"push_sub_{abs(hash(data['endpoint'])) % 999999}"
    db.execute(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
        (key, json.dumps(data))
    )
    db.commit()
    db.close()
    return jsonify({'ok': True, 'message': 'Subscription stored'})


@push_bp.route('/unsubscribe', methods=['POST'])
def unsubscribe():
    data = request.get_json()
    if not data or 'endpoint' not in data:
        return jsonify({'error': 'Invalid request'}), 400

    db = get_db()
    key = f"push_sub_{abs(hash(data['endpoint'])) % 999999}"
    db.execute('DELETE FROM settings WHERE key = ?', (key,))
    db.commit()
    db.close()
    return jsonify({'ok': True})


@push_bp.route('/status', methods=['GET'])
def status():
    private, public, _ = _get_vapid_keys()
    db = get_db()
    subs = db.execute(
        "SELECT COUNT(*) as c FROM settings WHERE key LIKE 'push_sub_%'"
    ).fetchone()['c']
    db.close()
    return jsonify({
        'vapid_configured': bool(private and public),
        'public_key':       public or '',
        'subscriptions':    subs,
    })


@push_bp.route('/test', methods=['POST'])
def send_test():
    """Send a test push notification to all subscribed devices."""
    private, public, email = _get_vapid_keys()
    if not private or not public:
        return jsonify({
            'error': 'VAPID keys not configured. See DEPLOYMENT.md for setup instructions.'
        }), 503

    db = get_db()
    rows = db.execute(
        "SELECT value FROM settings WHERE key LIKE 'push_sub_%'"
    ).fetchall()
    db.close()

    if not rows:
        return jsonify({'error': 'No subscriptions found'}), 404

    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        return jsonify({'error': 'pywebpush not installed. Run: pip install pywebpush'}), 503

    payload = json.dumps({
        'title': 'FinHub Test',
        'body':  'Push notifications are working ✓',
        'url':   '/'
    })

    sent = 0
    errors = []
    for row in rows:
        try:
            sub = json.loads(row['value'])
            webpush(
                subscription_info=sub,
                data=payload,
                vapid_private_key=private,
                vapid_claims={'sub': email},
            )
            sent += 1
        except WebPushException as e:
            errors.append(str(e)[:100])

    return jsonify({'sent': sent, 'errors': errors})


def send_push_notification(title: str, body: str, url: str = '/'):
    private, public, email = _get_vapid_keys()
    if not private or not public:
        return 0, ['VAPID keys not configured']

    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        return 0, ['pywebpush not installed']

    db = get_db()
    rows = db.execute(
        "SELECT key, value FROM settings WHERE key LIKE 'push_sub_%'"
    ).fetchall()
    db.close()

    payload = json.dumps({'title': title, 'body': body, 'url': url})
    sent, errors = 0, []

    for row in rows:
        sub = None  # always initialize before try block
        try:
            sub = json.loads(row['value'])
            webpush(
                subscription_info=sub,
                data=payload,
                vapid_private_key=private,
                vapid_claims={'sub': email},
            )
            sent += 1
        except Exception as e:
            err_str = str(e)
            errors.append(err_str[:80])
            # Remove expired/invalid subscriptions (410 Gone, 404 Not Found)
            if sub is not None and ('410' in err_str or '404' in err_str):
                db2 = get_db()
                db2.execute('DELETE FROM settings WHERE key = ?', (row['key'],))
                db2.commit()
                db2.close()

    return sent, errors