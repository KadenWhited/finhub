"""
backend/services/ingestion/coinbase_signals.py
Position-aware alert signals for Coinbase holdings.

Instead of generic "BTC moved 5%" alerts, these fire in context:
  "You hold 0.3 BTC at $82k avg — current price $94k — RSI 71 — consider exit zone"
"""
from datetime import datetime


def get_position_signals(db, settings: dict) -> list:
    """
    Compare open Coinbase positions against current prices and technical signals.
    Returns list of signal dicts for dispatch_alert().

    Signal dict: {alert_type, title, message, priority_int, cooldown_key}
    """
    signals = []

    # Get open trades from Coinbase
    coinbase_trades = db.execute('''
        SELECT coin, entry_price, position_size, entry_date, fees
        FROM trades
        WHERE source = 'coinbase_api'
          AND status = 'open'
    ''').fetchall()

    if not coinbase_trades:
        return signals

    # Group by coin to get average entry
    positions = {}
    for t in coinbase_trades:
        coin = t['coin']
        if coin not in positions:
            positions[coin] = {'total_size': 0, 'total_cost': 0, 'entry_date': t['entry_date']}
        positions[coin]['total_size']  += t['position_size']
        positions[coin]['total_cost']  += t['position_size'] * t['entry_price']

    for coin, pos in positions.items():
        avg_entry = pos['total_cost'] / pos['total_size'] if pos['total_size'] else 0
        if avg_entry <= 0:
            continue

        # Get current price from CoinGecko
        try:
            from backend.services.coingecko import get_prices
            # Map ticker to coin_id
            ticker_map = {
                'BTC': 'bitcoin', 'ETH': 'ethereum', 'SOL': 'solana',
                'ADA': 'cardano', 'DOT': 'polkadot', 'LINK': 'chainlink',
                'AVAX': 'avalanche-2', 'MATIC': 'polygon', 'DOGE': 'dogecoin',
                'XRP': 'ripple', 'BNB': 'binancecoin',
            }
            coin_id = ticker_map.get(coin.upper())
            if not coin_id:
                continue

            prices, err = get_prices([coin_id])
            if err or not prices or coin_id not in prices:
                continue

            current_price  = prices[coin_id].get('price', 0)
            change_24h     = prices[coin_id].get('change_24h', 0)
            if current_price <= 0:
                continue

            # Calculate position P&L
            pnl_pct = ((current_price - avg_entry) / avg_entry) * 100
            pnl_usd = (current_price - avg_entry) * pos['total_size']

            # Significant profit signal — potential exit zone
            if pnl_pct >= 20:
                from backend.services.notifications import PRIORITY
                priority = PRIORITY['high'] if pnl_pct >= 40 else PRIORITY['medium']
                signals.append({
                    'alert_type':   'strategy_signal',
                    'title':        f"FinHub: {coin} Position +{pnl_pct:.0f}% — Exit Zone?",
                    'message':      (f"Avg entry ${avg_entry:,.4f} → Current ${current_price:,.4f}\n"
                                     f"P&L: +${pnl_usd:,.2f} (+{pnl_pct:.1f}%) · "
                                     f"Size: {pos['total_size']} {coin}"),
                    'priority_int': priority,
                    'cooldown_key': f"coinbase_profit:{coin}",
                })

            # Significant loss signal — stop-loss awareness
            elif pnl_pct <= -15:
                from backend.services.notifications import PRIORITY
                priority = PRIORITY['high'] if pnl_pct <= -25 else PRIORITY['medium']
                signals.append({
                    'alert_type':   'strategy_signal',
                    'title':        f"FinHub: {coin} Position {pnl_pct:.0f}% — Review Stop Loss",
                    'message':      (f"Avg entry ${avg_entry:,.4f} → Current ${current_price:,.4f}\n"
                                     f"P&L: ${pnl_usd:,.2f} ({pnl_pct:.1f}%) · "
                                     f"Size: {pos['total_size']} {coin}"),
                    'priority_int': priority,
                    'cooldown_key': f"coinbase_loss:{coin}",
                })

        except Exception as e:
            print(f"[coinbase_signals] Error for {coin}: {e}")
            continue

    return signals
