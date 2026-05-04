"""
backend/services/notifications.py — Stage 4 Enhanced
Priority-tiered notification system with per-channel routing.

Priority levels: HIGH=3, MEDIUM=2, LOW=1, NONE=0
Channels: desktop, telegram, ntfy, push (web push)

Settings keys (stored in DB settings table):
  alert_channel_{tier}_{channel}  = '1' | '0'
  alert_type_{type}_enabled       = '1' | '0'
  alert_type_{type}_min_priority  = 'high' | 'medium' | 'low'
  alert_checkbook_min_balance     = float
  alert_large_tx_threshold        = float
  alert_credit_utilization_pct    = float
  alert_credit_charge_threshold   = float
  alert_daily_summary_time        = 'HH:MM' (24h)
  alert_daily_summary_enabled     = '1' | '0'
"""
import threading
import time
import os
from datetime import datetime, timedelta

_alert_thread   = None
_alert_running  = False
_last_alerts    = {}   # key -> last sent timestamp
_last_daily     = None # date of last daily summary

# ─────────────────────────────────────────
#  PRIORITY LEVELS
# ─────────────────────────────────────────

PRIORITY = {'none': 0, 'low': 1, 'medium': 2, 'high': 3}
PRIORITY_LABEL = {0: 'NONE', 1: 'LOW', 2: 'MEDIUM', 3: 'HIGH'}
PRIORITY_EMOJI = {1: '🔵', 2: '🟡', 3: '🔴'}

# Cooldown in seconds per priority (HIGH fires more often)
COOLDOWN = {'high': 1800, 'medium': 3600, 'low': 7200}

# ─────────────────────────────────────────
#  DEFAULT CHANNEL ROUTING MATRIX
#  alert_channel_{tier}_{channel} = '1'|'0'
# ─────────────────────────────────────────

DEFAULT_ROUTING = {
    'alert_channel_high_desktop':   '1',
    'alert_channel_high_telegram':  '1',
    'alert_channel_high_ntfy':      '1',
    'alert_channel_high_push':      '1',
    'alert_channel_medium_desktop': '1',
    'alert_channel_medium_telegram':'1',
    'alert_channel_medium_ntfy':    '1',
    'alert_channel_medium_push':    '0',
    'alert_channel_low_desktop':    '1',
    'alert_channel_low_telegram':   '0',
    'alert_channel_low_ntfy':       '0',
    'alert_channel_low_push':       '0',
}

# Default per-type settings
DEFAULT_TYPES = {
    'alert_type_price_move_enabled':          '1',
    'alert_type_price_move_min_priority':     'low',
    'alert_type_volume_spike_enabled':        '1',
    'alert_type_volume_spike_min_priority':   'medium',
    'alert_type_rsi_extreme_enabled':         '1',
    'alert_type_rsi_extreme_min_priority':    'medium',
    'alert_type_news_sentiment_enabled':      '1',
    'alert_type_news_sentiment_min_priority': 'low',
    'alert_type_strategy_signal_enabled':     '1',
    'alert_type_strategy_signal_min_priority':'high',
    'alert_type_balance_low_enabled':         '1',
    'alert_type_balance_low_min_priority':    'high',
    'alert_type_large_transaction_enabled':   '1',
    'alert_type_large_transaction_min_priority':'medium',
    'alert_type_credit_utilization_enabled':  '1',
    'alert_type_credit_utilization_min_priority':'medium',
    'alert_type_credit_charge_enabled':       '1',
    'alert_type_credit_charge_min_priority':  'low',
    'alert_type_daily_summary_enabled':       '1',
    'alert_type_daily_summary_min_priority':  'low',
    # Thresholds
    'alert_threshold_pct':           '5',
    'alert_checkbook_min_balance':   '100',
    'alert_large_tx_threshold':      '100',
    'alert_credit_utilization_pct':  '80',
    'alert_credit_charge_threshold': '200',
    'alert_daily_summary_time':      '08:00',
}


# ─────────────────────────────────────────
#  SETTINGS LOADER
# ─────────────────────────────────────────

def _load_settings(db) -> dict:
    rows = db.execute('SELECT key, value FROM settings').fetchall()
    s = {**DEFAULT_ROUTING, **DEFAULT_TYPES}
    s.update({r['key']: r['value'] for r in rows})
    return s


def _should_send(alert_type: str, priority_int: int, settings: dict) -> bool:
    """Check if this alert type + priority level should fire at all."""
    if not int(settings.get(f'alert_type_{alert_type}_enabled', '1')):
        return False
    min_p = settings.get(f'alert_type_{alert_type}_min_priority', 'low')
    return priority_int >= PRIORITY.get(min_p, 1)


def _get_channels(priority_int: int, settings: dict) -> list:
    """Return list of channel names that should receive this priority level."""
    tier = PRIORITY_LABEL.get(priority_int, 'LOW').lower()
    channels = []
    for ch in ('desktop', 'telegram', 'ntfy', 'push'):
        key = f'alert_channel_{tier}_{ch}'
        if settings.get(key, '0') == '1':
            channels.append(ch)
    return channels


def _cooldown_key(alert_type: str, coin_or_id: str) -> str:
    return f"{alert_type}:{coin_or_id}"


def _is_cooled_down(key: str, priority_label: str) -> bool:
    last = _last_alerts.get(key, 0)
    cooldown = COOLDOWN.get(priority_label.lower(), 3600)
    return (time.time() - last) < cooldown


def _mark_sent(key: str):
    _last_alerts[key] = time.time()


# ─────────────────────────────────────────
#  PRIORITY SCORING
# ─────────────────────────────────────────

def score_price_move(change_pct: float, settings: dict) -> int:
    base = float(settings.get('alert_threshold_pct', 5))
    abs_change = abs(change_pct)
    if abs_change < base:              return 0
    if abs_change >= base * 2:         return PRIORITY['high']
    if abs_change >= base * 1.4:       return PRIORITY['medium']
    return PRIORITY['low']


def score_rsi(rsi: float) -> int:
    if rsi is None:                    return 0
    if rsi <= 20 or rsi >= 80:         return PRIORITY['high']
    if rsi <= 30 or rsi >= 70:         return PRIORITY['medium']
    if rsi <= 35 or rsi >= 65:         return PRIORITY['low']
    return 0


def score_volume_spike(ratio: float) -> int:
    """ratio = current_volume / avg_volume"""
    if ratio >= 4:                     return PRIORITY['high']
    if ratio >= 2.5:                   return PRIORITY['medium']
    if ratio >= 1.8:                   return PRIORITY['low']
    return 0


def score_sentiment_shift(prev: str, curr: str) -> int:
    """Score a news sentiment flip."""
    if prev == curr:                   return 0
    if (prev == 'positive' and curr == 'negative') or \
       (prev == 'negative' and curr == 'positive'):
        return PRIORITY['high']       # Full reversal
    return PRIORITY['low']


def score_balance(balance: float, min_balance: float) -> int:
    if balance <= 0:                   return PRIORITY['high']
    if balance <= min_balance * 0.5:   return PRIORITY['high']
    if balance <= min_balance:         return PRIORITY['medium']
    if balance <= min_balance * 1.5:   return PRIORITY['low']
    return 0


def score_credit_util(util_pct: float, threshold: float) -> int:
    if util_pct >= 95:                 return PRIORITY['high']
    if util_pct >= threshold:          return PRIORITY['medium']
    if util_pct >= threshold * 0.85:   return PRIORITY['low']
    return 0


def score_transaction(amount: float, threshold: float) -> int:
    if amount >= threshold * 3:        return PRIORITY['high']
    if amount >= threshold * 1.5:      return PRIORITY['medium']
    if amount >= threshold:            return PRIORITY['low']
    return 0


# ─────────────────────────────────────────
#  CHANNEL SENDERS
# ─────────────────────────────────────────

def _send_desktop(title: str, message: str) -> bool:
    try:
        from win10toast import ToastNotifier
        ToastNotifier().show_toast(title, message, duration=8, threaded=True)
        return True
    except ImportError:
        pass
    except Exception as e:
        print(f"win10toast failed: {e}")
    try:
        import plyer
        notif = getattr(plyer, 'notification', None)
        if notif and callable(getattr(notif, 'notify', None)):
            notif.notify(title=title, message=message, app_name='FinHub', timeout=8)
            return True
    except Exception as e:
        print(f"plyer failed: {e}")
    print(f"\n🔔 {title} — {message}\n")
    return False


def _send_telegram(title: str, message: str, priority_int: int = 2) -> bool:
    token   = os.environ.get('TELEGRAM_BOT_TOKEN')
    chat_id = os.environ.get('TELEGRAM_CHAT_ID')
    if not token or not chat_id:
        return False
    try:
        import requests
        emoji = PRIORITY_EMOJI.get(priority_int, '🔵')
        text  = f"{emoji} *{title}*\n{message}"
        resp  = requests.post(
            f'https://api.telegram.org/bot{token}/sendMessage',
            json={'chat_id': chat_id, 'text': text, 'parse_mode': 'Markdown'},
            timeout=5
        )
        return resp.status_code == 200
    except Exception as e:
        print(f"Telegram failed: {e}")
        return False


def _send_ntfy(title: str, message: str, priority_int: int = 2) -> bool:
    topic = os.environ.get('NTFY_TOPIC')
    if not topic:
        return False
    ntfy_priority = {1: 'low', 2: 'default', 3: 'urgent'}.get(priority_int, 'default')
    tags = {1: 'bell', 2: 'chart_increasing', 3: 'rotating_light'}.get(priority_int, 'bell')
    try:
        import requests
        requests.post(
            f'https://ntfy.sh/{topic}',
            data=message.encode('utf-8'),
            headers={
                'Content-Type': 'text/plain; charset=utf-8',
                'Title': title.encode('utf-8'),
            },
            timeout=10,
        )
        return True
    except Exception as e:
        print(f"ntfy failed: {e}")
        return False


def _send_push(title: str, message: str) -> bool:
    try:
        from backend.routes.push import send_push_notification
        sent, _ = send_push_notification(title, message, '/#market')
        return sent > 0
    except Exception as e:
        print(f"Web push failed: {e}")
        return False


# ─────────────────────────────────────────
#  UNIFIED DISPATCH
# ─────────────────────────────────────────

def dispatch_alert(alert_type: str, title: str, message: str,
                   priority_int: int, settings: dict,
                   cooldown_key: str | None = None) -> dict:
    """
    Central dispatch. Checks if alert should fire, which channels,
    cooldown, then sends. Returns per-channel results dict.
    """
    if not _should_send(alert_type, priority_int, settings):
        return {}

    ck = cooldown_key or f"{alert_type}:{title}"
    priority_label = PRIORITY_LABEL.get(priority_int, 'LOW')

    if _is_cooled_down(ck, priority_label):
        return {}

    channels = _get_channels(priority_int, settings)
    if not channels:
        return {}

    results = {}
    for ch in channels:
        if ch == 'desktop':
            results['desktop']  = _send_desktop(title, message)
        elif ch == 'telegram':
            results['telegram'] = _send_telegram(title, message, priority_int)
        elif ch == 'ntfy':
            results['ntfy']     = _send_ntfy(title, message, priority_int)
        elif ch == 'push':
            results['push']     = _send_push(title, message)

    if any(results.values()):
        _mark_sent(ck)
        print(f"🔔 [{priority_label}] {title} → {', '.join(c for c,ok in results.items() if ok)}")

    return results


# ─────────────────────────────────────────
#  ALERT CHECKERS
# ─────────────────────────────────────────

def _check_price_alerts(db, settings):
    """Check crypto/stock price moves and RSI."""
    from backend.services.coingecko import get_prices

    watchlist = db.execute('SELECT * FROM watchlist').fetchall()
    if not watchlist:
        return

    coin_ids = [w['coin_id'] for w in watchlist]
    prices, err = get_prices(coin_ids)
    if err or not prices:
        return

    for coin_id, data in prices.items():
        change = data.get('change_24h', 0)
        symbol = data.get('symbol', coin_id.upper())
        price  = data.get('price', 0)
        sign   = '+' if change > 0 else ''
        dir_arrow = '▲' if change > 0 else '▼'

        # Price move alert
        p_score = score_price_move(change, settings)
        if p_score > 0:
            dispatch_alert(
                alert_type='price_move',
                title=f"FinHub: {symbol} {dir_arrow} {sign}{change:.1f}%",
                message=f"${price:,.4f} · 24h change: {sign}{change:.1f}%",
                priority_int=p_score,
                settings=settings,
                cooldown_key=f"price_move:{coin_id}",
            )

        # RSI alert (requires fetching chart data — only if type enabled)
        if settings.get('alert_type_rsi_extreme_enabled', '1') == '1':
            try:
                from backend.services.charts import get_crypto_chart
                chart_data, chart_err = get_crypto_chart(coin_id, '1m')
                
                if chart_err or not chart_data:
                    continue
                pts = chart_data.get('points', [])
                if len(pts) >= 14:
                    closes = [p['v'] for p in pts[-15:]]
                    rsi    = _calc_rsi(closes)
                    r_score= score_rsi(rsi)
                    if r_score > 0:
                        boundary = 'oversold' if rsi < 50 else 'overbought'
                        dispatch_alert(
                            alert_type='rsi_extreme',
                            title=f"FinHub RSI Alert: {symbol} {boundary.upper()}",
                            message=f"RSI = {rsi:.1f} · Current price ${price:,.4f}",
                            priority_int=r_score,
                            settings=settings,
                            cooldown_key=f"rsi:{coin_id}",
                        )
            except Exception:
                pass  # RSI check is best-effort


def _check_financial_alerts(db, settings):
    """Check checkbook balance and credit utilization."""

    # Checkbook balance
    if settings.get('alert_type_balance_low_enabled', '1') == '1':
        try:
            stats = db.execute('''
                SELECT
                    COALESCE(SUM(CASE WHEN type="income"  THEN amount ELSE 0 END), 0) as income,
                    COALESCE(SUM(CASE WHEN type="expense" THEN amount ELSE 0 END), 0) as expenses
                FROM checkbook
            ''').fetchone()
            balance     = (stats['income'] or 0) - (stats['expenses'] or 0)
            min_balance = float(settings.get('alert_checkbook_min_balance', 100))
            b_score     = score_balance(balance, min_balance)
            if b_score > 0:
                dispatch_alert(
                    alert_type='balance_low',
                    title=f"FinHub: Low Cash Balance",
                    message=f"Balance: ${balance:.2f} · Minimum set: ${min_balance:.2f}",
                    priority_int=b_score,
                    settings=settings,
                    cooldown_key='balance_low',
                )
        except Exception as e:
            print(f"Balance check error: {e}")

    # Credit utilization per card
    if settings.get('alert_type_credit_utilization_enabled', '1') == '1':
        try:
            accounts = db.execute('SELECT * FROM credit_accounts').fetchall()
            threshold = float(settings.get('alert_credit_utilization_pct', 80))
            for acc in accounts:
                if not acc['credit_limit']:
                    continue
                bal  = acc['balance'] or 0
                util = (bal / acc['credit_limit']) * 100
                u_score = score_credit_util(util, threshold)
                if u_score > 0:
                    dispatch_alert(
                        alert_type='credit_utilization',
                        title=f"FinHub: High Credit Utilization — {acc['name']}",
                        message=f"{util:.0f}% utilized · ${bal:.2f} of ${acc['credit_limit']:.2f}",
                        priority_int=u_score,
                        settings=settings,
                        cooldown_key=f"credit_util:{acc['id']}",
                    )
        except Exception as e:
            print(f"Credit util check error: {e}")


def _check_news_sentiment(db, settings):
    """Check if market sentiment has flipped since last check."""
    if settings.get('alert_type_news_sentiment_enabled', '1') != '1':
        return
    try:
        from backend.services.news import fetch_news, get_sentiment_summary
        articles, _ = fetch_news(limit=30, profile={})
        summary     = get_sentiment_summary(articles)
        curr_mood   = 'positive' if summary.get('score', 0) > 15 \
                      else 'negative' if summary.get('score', 0) < -15 \
                      else 'neutral'

        prev_mood = settings.get('_last_sentiment_mood', 'neutral')
        s_score   = score_sentiment_shift(prev_mood, curr_mood)

        if s_score > 0:
            dispatch_alert(
                alert_type='news_sentiment',
                title=f"FinHub: Market Sentiment Shifted to {curr_mood.upper()}",
                message=f"Sentiment score: {summary.get('score', 0):+.0f} "
                        f"· {summary.get('positive', 0)} bullish / "
                        f"{summary.get('negative', 0)} bearish headlines",
                priority_int=s_score,
                settings=settings,
                cooldown_key='sentiment_shift',
            )

        # Persist current mood for next comparison
        db.execute(
            'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
            ('_last_sentiment_mood', curr_mood)
        )
        db.commit()
    except Exception as e:
        print(f"Sentiment check error: {e}")

def _run_financial_alerts(app):
    try:
        with app.app_context():
            from backend.models.database import get_db
            from backend.services.notifications import (
                _load_settings, _check_financial_alerts,
                _check_news_sentiment, _check_daily_summary,
                _check_fear_greed_alert  # ← add this import
            )
            db = get_db()
            settings = _load_settings(db)
            _check_financial_alerts(db, settings)
            _check_news_sentiment(db, settings)
            _check_daily_summary(db, settings)
            _check_fear_greed_alert(db, settings)  # ← add this call
            db.close()
    except Exception as e:
        print(f"[scheduler] financial_alerts error: {e}")

def _check_daily_summary(db, settings):
    """Send a morning digest if it's time."""
    global _last_daily
    if settings.get('alert_type_daily_summary_enabled', '1') != '1':
        return

    target_time = settings.get('alert_daily_summary_time', '08:00')
    now         = datetime.now()
    today       = now.date()

    if _last_daily == today:
        return  # Already sent today

    try:
        target_h, target_m = map(int, target_time.split(':'))
        target_dt = now.replace(hour=target_h, minute=target_m, second=0)
        # Within 5-minute window of target time
        if abs((now - target_dt).total_seconds()) > 300:
            return
    except Exception:
        return

    try:
        # Build summary
        from backend.services.coingecko import get_prices

        watchlist = db.execute('SELECT * FROM watchlist').fetchall()
        prices_text = ''
        if watchlist:
            coin_ids = [w['coin_id'] for w in watchlist[:5]]
            prices, _ = get_prices(coin_ids)
            if prices:
                lines = []
                for cid, d in list(prices.items())[:5]:
                    c = d.get('change_24h', 0)
                    lines.append(f"{d.get('symbol','?')} {'+' if c>=0 else ''}{c:.1f}%")
                prices_text = ' · '.join(lines)

        stats = db.execute('''
            SELECT
                COALESCE(SUM(CASE WHEN type="income"  THEN amount ELSE 0 END), 0) as income,
                COALESCE(SUM(CASE WHEN type="expense" THEN amount ELSE 0 END), 0) as expenses
            FROM checkbook
        ''').fetchone()
        balance = (stats['income'] or 0) - (stats['expenses'] or 0)

        # Upcoming recurring payments this week
        next_week_dt = now + timedelta(days=7)

        title   = f"FinHub Daily Summary — {now.strftime('%a %b %d')}"
        message = f"Balance: ${balance:.2f}"
        if prices_text:
            message += f"\n{prices_text}"

        dispatch_alert(
            alert_type='daily_summary',
            title=title,
            message=message,
            priority_int=PRIORITY['low'],
            settings=settings,
            cooldown_key='daily_summary',
        )
        _last_daily = today

    except Exception as e:
        print(f"Daily summary error: {e}")


# ─────────────────────────────────────────
#  RSI HELPER
# ─────────────────────────────────────────

def _calc_rsi(closes: list, period: int = 14) -> float:
    if len(closes) < period + 1:
        return 50.0
    gains, losses = [], []
    for i in range(1, period + 1):
        d = closes[i] - closes[i-1]
        gains.append(max(d, 0))
        losses.append(max(-d, 0))
    avg_g = sum(gains) / period
    avg_l = sum(losses) / period
    for i in range(period, len(closes) - 1):
        d = closes[i+1] - closes[i]
        avg_g = (avg_g * (period-1) + max(d, 0))  / period
        avg_l = (avg_l * (period-1) + max(-d, 0)) / period
    if avg_l == 0:
        return 100.0
    return round(100 - (100 / (1 + avg_g / avg_l)), 1)


# ─────────────────────────────────────────
#  MAIN ALERT LOOP
# ─────────────────────────────────────────

def _check_alerts(app):
    global _alert_running
    with app.app_context():
        from backend.models.database import get_db
        iteration = 0

        while _alert_running:
            try:
                db       = get_db()
                settings = _load_settings(db)

                # Every iteration: price + financial checks
                _check_price_alerts(db, settings)
                _check_financial_alerts(db, settings)

                # Every 5 iterations (~5 min): sentiment + daily summary
                if iteration % 5 == 0:
                    _check_news_sentiment(db, settings)
                    _check_daily_summary(db, settings)

                db.close()
            except Exception as e:
                print(f"Alert loop error: {e}")

            iteration += 1
            time.sleep(60)

def _check_fear_greed_alert(db, settings: dict):
    """Fire alert when Fear & Greed hits extreme zones."""
    if settings.get('alert_type_news_sentiment_enabled', '1') != '1':
        return
    try:
        import requests as req
        resp = req.get(
            'https://api.alternative.me/fng/',
            params={'limit': 2},
            timeout=8
        )
        data = resp.json().get('data', [])
        if not data:
            return

        current = int(data[0].get('value', 50))
        prev    = int(data[1].get('value', 50)) if len(data) > 1 else current
        label   = data[0].get('value_classification', '')

        # Only alert on zone transitions, not sustained readings
        def _zone(v):
            if v <= 20: return 'extreme_fear'
            if v <= 44: return 'fear'
            if v <= 55: return 'neutral'
            if v <= 75: return 'greed'
            return 'extreme_greed'

        curr_zone = _zone(current)
        prev_zone = _zone(prev)

        if curr_zone == prev_zone:
            return  # No zone change, no alert

        from backend.services.notifications import PRIORITY, dispatch_alert

        if curr_zone == 'extreme_fear':
            dispatch_alert(
                alert_type   = 'news_sentiment',
                title        = f'$RIGHT: Fear & Greed — EXTREME FEAR ({current})',
                message      = f'Index dropped to {current} ({label}). Historically a strong buying opportunity.',
                priority_int = PRIORITY['high'],
                settings     = settings,
                cooldown_key = 'fng_extreme_fear',
            )
        elif curr_zone == 'extreme_greed':
            dispatch_alert(
                alert_type   = 'news_sentiment',
                title        = f'$RIGHT: Fear & Greed — EXTREME GREED ({current})',
                message      = f'Index reached {current} ({label}). Market may be overheated — consider taking profits.',
                priority_int = PRIORITY['medium'],
                settings     = settings,
                cooldown_key = 'fng_extreme_greed',
            )
        elif prev_zone in ('extreme_fear', 'extreme_greed'):
            # Recovery from extreme zone
            dispatch_alert(
                alert_type   = 'news_sentiment',
                title        = f'$RIGHT: Fear & Greed — Recovering to {label} ({current})',
                message      = f'Sentiment shifted from {prev_zone.replace("_"," ")} to {label}.',
                priority_int = PRIORITY['low'],
                settings     = settings,
                cooldown_key = 'fng_recovery',
            )

    except Exception as e:
        print(f"[fng_alert] Error: {e}")


# ─────────────────────────────────────────
#  PUBLIC API
# ─────────────────────────────────────────

def start_alert_thread(app):
    global _alert_thread, _alert_running
    if _alert_thread and _alert_thread.is_alive():
        return
    _alert_running = True
    _alert_thread  = threading.Thread(
        target=_check_alerts, args=(app,),
        daemon=True, name='price-alerts'
    )
    _alert_thread.start()
    print("🔔 Price alert thread started")


def stop_alert_thread():
    global _alert_running
    _alert_running = False


def send_test_notification(channels='all', priority='medium'):
    """Test one or all channels at a given priority level."""
    title   = "FinHub Test Alert"
    message = "Notification system is working correctly ✓"
    p_int   = PRIORITY.get(priority, 2)
    results = {}

    channel_map = {
        'desktop':  lambda: _send_desktop(title, message),
        'telegram': lambda: _send_telegram(title, message, p_int),
        'ntfy':     lambda: _send_ntfy(title, message, p_int),
        'push':     lambda: _send_push(title, message),
    }

    to_send = list(channel_map.keys()) if channels == 'all' else [channels]
    for ch in to_send:
        if ch in channel_map:
            results[ch] = channel_map[ch]()
            status = '✓' if results[ch] else '✗'
            print(f"  {status} {ch}: {'sent' if results[ch] else 'failed'}")

    return results


def get_alert_status():
    global _alert_thread, _alert_running
    return {
        'running':       _alert_running and bool(_alert_thread and _alert_thread.is_alive()),
        'last_alerts':   {k: datetime.fromtimestamp(v).isoformat()
                          for k, v in _last_alerts.items()},
        'cooldown_config': COOLDOWN,
    }


def get_default_settings() -> dict:
    """Return merged defaults — used for DB migration."""
    return {**DEFAULT_ROUTING, **DEFAULT_TYPES}
