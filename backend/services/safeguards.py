"""
backend/services/safeguards.py
Revenge trading detection and cooldown enforcement.
Reads trade history and settings to determine safeguard state.
"""
from datetime import datetime, timedelta


def get_safeguard_state(db):
    """
    Evaluate current revenge trading safeguard state.
    Returns dict with:
      - active: bool — is the cooldown currently active?
      - consecutive_losses: int
      - trigger_threshold: int — losses needed to trigger
      - cooldown_hours: int
      - cooldown_ends: str | None — ISO datetime when cooldown expires
      - can_trade: bool
      - message: str — human readable status
      - recent_trades: list — last N closed trades for display
    """
    settings_rows = db.execute('SELECT * FROM settings').fetchall()
    settings = {r['key']: r['value'] for r in settings_rows}

    threshold    = int(settings.get('revenge_trade_threshold', 3))
    cooldown_hrs = int(settings.get('revenge_cooldown_hours', 24))

    # Get last N+2 closed trades ordered by exit date desc
    recent = db.execute('''
        SELECT id, coin, direction, entry_price, exit_price,
               position_size, exit_date, status
        FROM trades
        WHERE status = "closed" AND exit_date IS NOT NULL
        ORDER BY exit_date DESC
        LIMIT ?
    ''', (threshold + 2,)).fetchall()
    recent = [dict(r) for r in recent]

    # Calculate P&L for each
    for t in recent:
        if t['exit_price'] and t['entry_price']:
            if t.get('direction', 'long') == 'long':
                t['pnl'] = (t['exit_price'] - t['entry_price']) * t['position_size']
            else:
                t['pnl'] = (t['entry_price'] - t['exit_price']) * t['position_size']
        else:
            t['pnl'] = 0

    # Count consecutive losses from most recent
    consecutive = 0
    for t in recent:
        if t['pnl'] < 0:
            consecutive += 1
        else:
            break

    # Check if safeguard was triggered and cooldown is still active
    cooldown_ends  = None
    cooldown_active = False

    if consecutive >= threshold and recent:
        # Find when the Nth consecutive loss occurred
        trigger_trade = recent[threshold - 1]
        exit_str = trigger_trade.get('exit_date', '')
        try:
            exit_dt = datetime.fromisoformat(exit_str[:10])
            cooldown_end_dt = exit_dt + timedelta(hours=cooldown_hrs)
            now = datetime.utcnow()
            if now < cooldown_end_dt:
                cooldown_active = True
                cooldown_ends = cooldown_end_dt.isoformat()
        except Exception:
            pass

    can_trade = not cooldown_active

    if cooldown_active:
        hours_left = max(0, int(
            (datetime.fromisoformat(cooldown_ends) - datetime.utcnow()).total_seconds() / 3600
        ))
        message = (f"⚠ COOLDOWN ACTIVE — {consecutive} consecutive losses detected. "
                   f"Trading blocked for ~{hours_left}h to prevent revenge trading.")
    elif consecutive >= threshold:
        message = (f"⚠ {consecutive} consecutive losses detected. "
                   f"Cooldown period has expired — proceed with extra caution.")
    elif consecutive > 0:
        message = f"Caution: {consecutive} consecutive loss{'es' if consecutive > 1 else ''}. "
    else:
        message = "✓ No safeguard active."

    return {
        'active':               cooldown_active,
        'consecutive_losses':   consecutive,
        'trigger_threshold':    threshold,
        'cooldown_hours':       cooldown_hrs,
        'cooldown_ends':        cooldown_ends,
        'can_trade':            can_trade,
        'message':              message,
        'recent_trades':        recent[:threshold + 1],
    }


def log_safeguard_trigger(db, consecutive_losses):
    """Record a safeguard trigger event to the settings table for audit."""
    now = datetime.utcnow().isoformat()
    db.execute(
        'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
        ('last_safeguard_trigger', f"{now}|{consecutive_losses}")
    )
    db.commit()
