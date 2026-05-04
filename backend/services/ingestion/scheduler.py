"""
backend/services/ingestion/scheduler.py
Central job scheduler for all background tasks.
Replaces the single alert thread with APScheduler so each job
runs independently — one failure doesn't kill the others.

Jobs registered here:
  - price_alerts        (60s)   existing alert logic
  - coinbase_sync       (5min)  Phase 2
  - kalshi_sync         (5min)  Phase 3
  - email_sync          (15min) Phase 4
  - daily_summary       (1/day) existing daily digest

Install: pip install apscheduler
"""
import os
import logging
from datetime import datetime

# Suppress APScheduler's verbose logging unless debugging
logging.getLogger('apscheduler').setLevel(logging.WARNING)

_scheduler = None


def get_scheduler():
    global _scheduler
    return _scheduler


def init_scheduler(app):
    """
    Initialize and start the APScheduler.
    Call once from app.py after init_db().
    Replaces start_alert_thread().
    """
    global _scheduler

    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        from apscheduler.executors.pool import ThreadPoolExecutor
    except ImportError:
        print("⚠  APScheduler not installed. Run: pip install apscheduler")
        print("   Falling back to legacy alert thread...")
        from backend.services.notifications import start_alert_thread
        start_alert_thread(app)
        return None

    executors = {
        'default': ThreadPoolExecutor(max_workers=4)
    }
    job_defaults = {
        'coalesce':      True,   # Skip missed runs instead of catching up
        'max_instances': 1,      # Never run same job twice simultaneously
        'misfire_grace_time': 30 # Allow 30s late start before skipping
    }

    _scheduler = BackgroundScheduler(
        executors=executors,
        job_defaults=job_defaults,
        timezone='UTC'
    )

    # ── Price alerts (60 seconds) ────────────────────────────────────────────
    _scheduler.add_job(
        func=_run_price_alerts,
        args=[app],
        trigger='interval',
        seconds=60,
        id='price_alerts',
        name='Price Alerts',
        replace_existing=True,
    )

    # ── Coinbase sync (5 minutes) — Phase 2 ─────────────────────────────────
    coinbase_interval = int(os.environ.get('COINBASE_SYNC_INTERVAL_MINUTES', 5))
    _scheduler.add_job(
        func=_run_coinbase_sync,
        args=[app],
        trigger='interval',
        minutes=coinbase_interval,
        id='coinbase_sync',
        name='Coinbase Sync',
        replace_existing=True,
    )

    # ── Kalshi sync (5 minutes) — Phase 3 ───────────────────────────────────
    kalshi_interval = int(os.environ.get('KALSHI_SYNC_INTERVAL_MINUTES', 5))
    _scheduler.add_job(
        func=_run_kalshi_sync,
        args=[app],
        trigger='interval',
        minutes=kalshi_interval,
        id='kalshi_sync',
        name='Kalshi Sync',
        replace_existing=True,
    )

    # ── Email parsing (15 minutes) — Phase 4 ────────────────────────────────
    email_interval = int(os.environ.get('EMAIL_SYNC_INTERVAL_MINUTES', 15))
    _scheduler.add_job(
        func=_run_email_sync,
        args=[app],
        trigger='interval',
        minutes=email_interval,
        id='email_sync',
        name='Gmail Email Sync',
        replace_existing=True,
    )

    # ── Financial alerts (2 minutes) ─────────────────────────────────────────
    _scheduler.add_job(
        func=_run_financial_alerts,
        args=[app],
        trigger='interval',
        minutes=2,
        id='financial_alerts',
        name='Financial Alerts',
        replace_existing=True,
    )

    _scheduler.start()
    print("⏱  Scheduler started with jobs:")
    for job in _scheduler.get_jobs():
        print(f"   • {job.name} ({job.id})")

    return _scheduler


def shutdown_scheduler():
    global _scheduler
    if _scheduler and _scheduler.running:
        _scheduler.shutdown(wait=False)
        print("⏱  Scheduler stopped")


# ─────────────────────────────────────────
#  JOB WRAPPERS
#  Each wrapper catches all exceptions so one
#  failing job never affects others.
# ─────────────────────────────────────────

def _run_price_alerts(app):
    try:
        with app.app_context():
            from backend.models.database import get_db
            from backend.services.notifications import (
                _load_settings, _check_price_alerts, _check_news_sentiment
            )
            db = get_db()
            settings = _load_settings(db)
            _check_price_alerts(db, settings)
            db.close()
    except Exception as e:
        print(f"[scheduler] price_alerts error: {e}")


def _run_financial_alerts(app):
    try:
        with app.app_context():
            from backend.models.database import get_db
            from backend.services.notifications import (
                _load_settings, _check_financial_alerts,
                _check_news_sentiment, _check_daily_summary
            )
            db = get_db()
            settings = _load_settings(db)
            _check_financial_alerts(db, settings)
            _check_news_sentiment(db, settings)
            _check_daily_summary(db, settings)
            db.close()
    except Exception as e:
        print(f"[scheduler] financial_alerts error: {e}")


def _run_kraken_sync(app):
    if not os.environ.get('KRAKEN_API_KEY'):
        return
    try:
        with app.app_context():
            from backend.services.ingestion.kraken import sync_kraken
            from backend.services.ingestion.coinbase_signals import get_position_signals
            from backend.models.database import get_db
            from backend.services.notifications import dispatch_alert, _load_settings

            sync_kraken()

            db       = get_db()
            settings = _load_settings(db)
            signals  = get_position_signals(db, settings)
            db.close()

            for sig in signals:
                dispatch_alert(**sig, settings=settings)
    except ImportError:
        pass
    except Exception as e:
        print(f"[scheduler] kraken_sync error: {e}")
        _update_connection_status(app, 'kraken', 'error', str(e))


def _run_kalshi_sync(app):
    if not os.environ.get('KALSHI_API_KEY_ID'):
        return
    try:
        with app.app_context():
            from backend.services.ingestion.kalshi import sync_kalshi
            sync_kalshi()
    except ImportError:
        pass
    except Exception as e:
        print(f"[scheduler] kalshi_sync error: {e}")
        _update_connection_status(app, 'kalshi', 'error', str(e))


def _run_email_sync(app):
    if not os.environ.get('GMAIL_APP_PASSWORD'):
        return
    try:
        with app.app_context():
            from backend.services.ingestion.email_parser import sync_emails
            sync_emails()
    except ImportError:
        pass
    except Exception as e:
        print(f"[scheduler] email_sync error: {e}")
        _update_connection_status(app, 'gmail', 'error', str(e))


def _update_connection_status(app, service: str, status: str, error: str | None = None):
    """Update the connections table after a sync attempt."""
    try:
        with app.app_context():
            from backend.models.database import get_db
            db = get_db()
            db.execute('''
                INSERT INTO connections (service, last_sync_at, last_sync_status, error_message, updated_at)
                VALUES (?, ?, ?, ?, datetime('now'))
                ON CONFLICT(service) DO UPDATE SET
                    last_sync_at = excluded.last_sync_at,
                    last_sync_status = excluded.last_sync_status,
                    error_message = excluded.error_message,
                    updated_at = excluded.updated_at
            ''', (service, datetime.utcnow().isoformat(), status, error))
            db.commit()
            db.close()
    except Exception:
        pass


def get_scheduler_status() -> dict:
    """Return current status of all scheduled jobs."""
    global _scheduler
    if not _scheduler:
        return {'running': False, 'jobs': []}

    jobs = []
    for job in _scheduler.get_jobs():
        next_run = job.next_run_time
        jobs.append({
            'id':       job.id,
            'name':     job.name,
            'next_run': next_run.isoformat() if next_run else None,
        })

    return {
        'running': _scheduler.running,
        'jobs':    jobs,
    }
