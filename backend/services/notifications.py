"""
backend/services/notifications.py
Price alert notifications via plyer (cross-platform desktop toasts).
Runs as a background thread, polls watched coins every 60 seconds.
"""
import threading
import time
import os
from datetime import datetime

_alert_thread   = None
_alert_running  = False
_last_alerts    = {}   # coin_id -> last alert timestamp (prevent spam)
ALERT_COOLDOWN  = 3600  # Don't re-alert same coin within 1 hour


def _send_notification(title: str, message: str):
    """Send a desktop notification. Falls back gracefully if plyer not installed."""
    try:
        from plyer import notification
        notification.notify(
            title=title,
            message=message,
            app_name='FinHub',
            timeout=8,
        )
        return True
    except ImportError:
        # plyer not installed — log to console instead
        print(f"\n🔔 ALERT: {title} — {message}\n")
        return False
    except Exception as e:
        print(f"Notification failed: {e}")
        return False


def _check_alerts(app):
    """Check price alerts for all watchlist coins. Runs in background thread."""
    global _alert_running

    with app.app_context():
        from backend.models.database import get_db
        from backend.services.coingecko import get_prices

        while _alert_running:
            try:
                db = get_db()

                # Get settings
                settings_rows = db.execute('SELECT * FROM settings').fetchall()
                settings = {r['key']: r['value'] for r in settings_rows}
                threshold = float(settings.get('alert_threshold_pct', 5))

                # Get watchlist
                watchlist = db.execute('SELECT * FROM watchlist').fetchall()
                db.close()

                if not watchlist:
                    time.sleep(60)
                    continue

                coin_ids = [w['coin_id'] for w in watchlist]
                prices, err = get_prices(coin_ids)

                if err or not prices:
                    time.sleep(60)
                    continue

                now = time.time()

                for coin_id, data in prices.items():
                    change = data.get('change_24h', 0)
                    symbol = data.get('symbol', coin_id.upper())
                    price  = data.get('price', 0)

                    if abs(change) < threshold:
                        continue

                    # Cooldown check
                    last = _last_alerts.get(coin_id, 0)
                    if now - last < ALERT_COOLDOWN:
                        continue

                    direction = '▲' if change > 0 else '▼'
                    sign      = '+' if change > 0 else ''
                    title     = f"FinHub: {symbol} {direction} {sign}{change:.1f}%"
                    msg       = f"${price:,.4f} · {sign}{change:.1f}% in 24h"

                    sent = _send_notification(title, msg)
                    if sent:
                        _last_alerts[coin_id] = now
                        print(f"🔔 Alert sent: {title}")

            except Exception as e:
                print(f"Alert check error: {e}")

            time.sleep(60)  # Check every 60 seconds


def start_alert_thread(app):
    """Start the background price alert thread. Call once from app.py."""
    global _alert_thread, _alert_running

    if _alert_thread and _alert_thread.is_alive():
        return  # Already running

    _alert_running = True
    _alert_thread  = threading.Thread(
        target=_check_alerts,
        args=(app,),
        daemon=True,  # Dies with main process
        name='price-alerts'
    )
    _alert_thread.start()
    print("🔔 Price alert thread started")


def stop_alert_thread():
    global _alert_running
    _alert_running = False


def send_test_notification():
    return _send_notification(
        "FinHub Test Alert",
        "Price alerts are working correctly ✓"
    )


def get_alert_status():
    global _alert_thread, _alert_running
    return {
        'running':    _alert_running and bool(_alert_thread and _alert_thread.is_alive()),
        'last_alerts': {k: datetime.fromtimestamp(v).isoformat()
                        for k, v in _last_alerts.items()},
        'cooldown_hours': ALERT_COOLDOWN / 3600,
    }
