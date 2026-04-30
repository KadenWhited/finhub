"""
backend/services/backtester.py
Loads OHLCV data via ccxt and simulates entry/exit rules.
Outputs: win rate, max drawdown, total return, Sharpe ratio, trade log.
"""
import time
import math
from datetime import datetime, timedelta

# Cache raw OHLCV so we don't hammer the exchange
_ohlcv_cache = {}
CACHE_TTL = 300  # 5 minutes


def _cache_key(exchange_id, symbol, timeframe, since_days):
    return f"{exchange_id}_{symbol}_{timeframe}_{since_days}"


# Exchange priority list for US users — tried in order
US_FRIENDLY_EXCHANGES = ['kraken', 'bybit', 'kucoin', 'okx', 'mexc']

# Symbol translation per exchange
# Kraken uses XBT/USD, others use BTC/USDT
EXCHANGE_SYMBOL_MAP = {
    'kraken': {
        'BTC/USDT':   'BTC/USD',
        'ETH/USDT':   'ETH/USD',
        'SOL/USDT':   'SOL/USD',
        'ADA/USDT':   'ADA/USD',
        'XRP/USDT':   'XRP/USD',
        'DOT/USDT':   'DOT/USD',
        'LINK/USDT':  'LINK/USD',
        'AVAX/USDT':  'AVAX/USD',
        'DOGE/USDT':  'DOGE/USD',
        'MATIC/USDT': 'MATIC/USD',
        'BNB/USDT':   'BNB/USD',
        'INJ/USDT':   'INJ/USD',
    }
}


def fetch_ohlcv(symbol: str, timeframe: str = '1d', since_days: int = 180,
                exchange_id: str = None):
    """
    Fetch OHLCV candles. Tries US-friendly exchanges automatically.
    Returns (candles, error_string).
    """
    # Build exchange priority — user-specified first, then US-friendly list
    if exchange_id and exchange_id != 'binance':
        priority = [exchange_id] + [e for e in US_FRIENDLY_EXCHANGES if e != exchange_id]
    else:
        priority = US_FRIENDLY_EXCHANGES

    last_error = None

    for ex_id in priority:
        # Translate symbol for this exchange
        ex_symbol = EXCHANGE_SYMBOL_MAP.get(ex_id, {}).get(symbol, symbol)
        key = _cache_key(ex_id, ex_symbol, timeframe, since_days)
        now = time.time()

        if key in _ohlcv_cache:
            data, ts = _ohlcv_cache[key]
            if now - ts < CACHE_TTL:
                return data, None

        try:
            import ccxt
            exchange_class = getattr(ccxt, ex_id)
            exchange = exchange_class({
                'enableRateLimit': True,
                'timeout': 20000,
            })

            since_ms = int(
                (datetime.utcnow() - timedelta(days=since_days)).timestamp() * 1000
            )
            raw = exchange.fetch_ohlcv(ex_symbol, timeframe, since=since_ms, limit=500)

            if not raw:
                last_error = f'{ex_id}: empty response'
                continue

            candles = [
                {'t': r[0], 'o': r[1], 'h': r[2], 'l': r[3], 'c': r[4], 'v': r[5]}
                for r in raw
            ]
            _ohlcv_cache[key] = (candles, now)
            return candles, None

        except ImportError:
            return None, 'ccxt not installed. Run: pip install ccxt'
        except Exception as e:
            last_error = f'{ex_id}: {str(e)[:120]}'
            continue  # Try next exchange

    return None, f'All exchanges failed. Last error: {last_error}'


# ─────────────────────────────────────────
#  STRATEGY DEFINITIONS
#  Each strategy is a function that takes a list of candles
#  and returns list of {'entry_i', 'exit_i', 'direction'} index pairs.
# ─────────────────────────────────────────

def _sma(candles, period):
    """Simple moving average over close prices."""
    closes = [c['c'] for c in candles]
    result = [None] * len(closes)
    for i in range(period - 1, len(closes)):
        result[i] = sum(closes[i - period + 1:i + 1]) / period
    return result


def _ema(candles, period):
    """Exponential moving average."""
    closes = [c['c'] for c in candles]
    result = [None] * len(closes)
    k = 2 / (period + 1)
    for i in range(len(closes)):
        if i < period - 1:
            continue
        if result[i - 1] is None:
            result[i] = sum(closes[:period]) / period
        else:
            result[i] = closes[i] * k + result[i - 1] * (1 - k)
    return result


def _rsi(candles, period=14):
    """RSI indicator."""
    closes = [c['c'] for c in candles]
    result = [None] * len(closes)
    if len(closes) < period + 1:
        return result

    gains, losses = [], []
    for i in range(1, period + 1):
        diff = closes[i] - closes[i - 1]
        gains.append(max(diff, 0))
        losses.append(max(-diff, 0))

    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period

    for i in range(period, len(closes)):
        diff = closes[i] - closes[i - 1]
        gain = max(diff, 0)
        loss = max(-diff, 0)
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
        rs = avg_gain / avg_loss if avg_loss != 0 else 100
        result[i] = round(100 - (100 / (1 + rs)), 2)

    return result


STRATEGIES = {
    'sma_crossover': {
        'label': 'SMA Crossover (20/50)',
        'description': 'Buy when 20-period SMA crosses above 50-period SMA. Sell on cross below.',
        'params': {'fast': 20, 'slow': 50}
    },
    'ema_crossover': {
        'label': 'EMA Crossover (9/21)',
        'description': 'Buy when 9 EMA crosses above 21 EMA. Sell on cross below.',
        'params': {'fast': 9, 'slow': 21}
    },
    'rsi_oversold': {
        'label': 'RSI Oversold Bounce',
        'description': 'Buy when RSI drops below 30 (oversold). Sell when RSI exceeds 70.',
        'params': {'oversold': 30, 'overbought': 70, 'period': 14}
    },
    'breakout': {
        'label': 'Donchian Breakout (20)',
        'description': 'Buy on 20-period high breakout. Exit on 10-period low breakdown.',
        'params': {'entry_period': 20, 'exit_period': 10}
    },
    'mean_reversion': {
        'label': 'Bollinger Band Mean Reversion',
        'description': 'Buy when price touches lower band. Sell at middle band.',
        'params': {'period': 20, 'std_dev': 2.0}
    },
}


def run_backtest(candles, strategy_id, params=None, initial_capital=350.0,
                 risk_pct=2.0, stop_loss_pct=None):
    """
    Run a backtest on the given candles using the named strategy.
    Returns full metrics + trade log + equity curve.
    """
    if not candles or len(candles) < 50:
        return None, 'Not enough candle data (need at least 50 candles)'

    strategy = STRATEGIES.get(strategy_id)
    if not strategy:
        return None, f'Unknown strategy: {strategy_id}'

    p = {**strategy['params'], **(params or {})}

    # Generate signals
    signals = _generate_signals(candles, strategy_id, p)
    if not signals:
        return None, 'No trades generated for this strategy in this period'

    # Simulate trades
    capital = initial_capital
    equity_curve = [{'t': candles[0]['t'], 'v': capital}]
    trade_log = []
    peak_equity = capital
    max_drawdown = 0.0

    for sig in signals:
        entry_c = candles[sig['entry_i']]
        exit_c  = candles[sig['exit_i']]

        entry_price = entry_c['c']
        exit_price  = exit_c['c']

        # Position sizing: risk X% of current capital
        risk_amount = capital * (risk_pct / 100)
        if stop_loss_pct:
            sl_distance = entry_price * (stop_loss_pct / 100)
            size = risk_amount / sl_distance if sl_distance > 0 else risk_amount / entry_price
        else:
            size = risk_amount / entry_price

        if sig['direction'] == 'long':
            pnl = (exit_price - entry_price) * size
        else:
            pnl = (entry_price - exit_price) * size

        capital += pnl
        capital = max(capital, 0.01)  # floor at 1 cent

        # Track drawdown
        if capital > peak_equity:
            peak_equity = capital
        dd = (peak_equity - capital) / peak_equity * 100
        if dd > max_drawdown:
            max_drawdown = dd

        trade_log.append({
            'entry_date': datetime.utcfromtimestamp(entry_c['t'] / 1000).strftime('%Y-%m-%d'),
            'exit_date':  datetime.utcfromtimestamp(exit_c['t']  / 1000).strftime('%Y-%m-%d'),
            'entry_price': round(entry_price, 6),
            'exit_price':  round(exit_price,  6),
            'size':        round(size,         6),
            'pnl':         round(pnl,          4),
            'pnl_pct':     round((pnl / (entry_price * size)) * 100, 2) if entry_price * size else 0,
            'direction':   sig['direction'],
            'capital_after': round(capital, 2),
        })

        equity_curve.append({'t': exit_c['t'], 'v': round(capital, 2)})

    # Metrics
    pnls = [t['pnl'] for t in trade_log]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p <= 0]

    total_return = ((capital - initial_capital) / initial_capital) * 100

    # Sharpe ratio (annualized, assuming daily returns)
    if len(pnls) > 1:
        returns = [t['pnl'] / (t['entry_price'] * t['size'])
                   for t in trade_log if t['entry_price'] * t['size'] > 0]
        if returns:
            mean_r = sum(returns) / len(returns)
            variance = sum((r - mean_r) ** 2 for r in returns) / len(returns)
            std_r = math.sqrt(variance) if variance > 0 else 0
            sharpe = (mean_r / std_r * math.sqrt(252)) if std_r > 0 else 0
        else:
            sharpe = 0
    else:
        sharpe = 0

    profit_factor = (sum(wins) / abs(sum(losses))) if losses and sum(losses) != 0 else None

    metrics = {
        'strategy_id':      strategy_id,
        'strategy_label':   strategy['label'],
        'total_trades':     len(trade_log),
        'winning_trades':   len(wins),
        'losing_trades':    len(losses),
        'win_rate':         round(len(wins) / len(pnls) * 100, 1) if pnls else 0,
        'total_return_pct': round(total_return, 2),
        'total_pnl':        round(capital - initial_capital, 4),
        'final_capital':    round(capital, 2),
        'initial_capital':  initial_capital,
        'max_drawdown_pct': round(max_drawdown, 2),
        'sharpe_ratio':     round(sharpe, 3),
        'profit_factor':    round(profit_factor, 2) if profit_factor else None,
        'avg_win':          round(sum(wins)   / len(wins),   4) if wins   else 0,
        'avg_loss':         round(sum(losses) / len(losses), 4) if losses else 0,
    }

    return {
        'metrics':      metrics,
        'trade_log':    trade_log[-50:],  # last 50 trades
        'equity_curve': equity_curve,
    }, None


def _generate_signals(candles, strategy_id, params):
    signals = []
    n = len(candles)

    if strategy_id == 'sma_crossover':
        fast = _sma(candles, params['fast'])
        slow = _sma(candles, params['slow'])
        in_trade = False
        entry_i = None
        for i in range(1, n):
            # Guard: skip if either current OR previous value is None
            if fast[i] is None or slow[i] is None: continue
            if fast[i-1] is None or slow[i-1] is None: continue
            if not in_trade and fast[i] > slow[i] and fast[i-1] <= slow[i-1]:
                in_trade = True; entry_i = i
            elif in_trade and fast[i] < slow[i] and fast[i-1] >= slow[i-1]:
                signals.append({'entry_i': entry_i, 'exit_i': i, 'direction': 'long'})
                in_trade = False
        if in_trade and entry_i is not None:
            signals.append({'entry_i': entry_i, 'exit_i': n-1, 'direction': 'long'})

    elif strategy_id == 'ema_crossover':
        fast = _ema(candles, params['fast'])
        slow = _ema(candles, params['slow'])
        in_trade = False; entry_i = None
        for i in range(1, n):
            if fast[i] is None or slow[i] is None: continue
            if fast[i-1] is None or slow[i-1] is None: continue
            if not in_trade and fast[i] > slow[i] and fast[i-1] <= slow[i-1]:
                in_trade = True; entry_i = i
            elif in_trade and fast[i] < slow[i]:
                signals.append({'entry_i': entry_i, 'exit_i': i, 'direction': 'long'})
                in_trade = False
        if in_trade and entry_i is not None:
            signals.append({'entry_i': entry_i, 'exit_i': n-1, 'direction': 'long'})

    elif strategy_id == 'rsi_oversold':
        rsi = _rsi(candles, params['period'])
        in_trade = False; entry_i = None
        for i in range(1, n):
            if rsi[i] is None: continue
            if rsi[i-1] is None: continue
            if not in_trade and rsi[i] < params['oversold'] and rsi[i-1] >= params['oversold']:
                in_trade = True; entry_i = i
            elif in_trade and rsi[i] > params['overbought']:
                signals.append({'entry_i': entry_i, 'exit_i': i, 'direction': 'long'})
                in_trade = False
        if in_trade and entry_i is not None:
            signals.append({'entry_i': entry_i, 'exit_i': n-1, 'direction': 'long'})

    elif strategy_id == 'breakout':
        ep = params['entry_period']; xp = params['exit_period']
        in_trade = False; entry_i = None
        for i in range(max(ep, xp), n):
            highs = [candles[j]['h'] for j in range(i-ep, i)]
            lows  = [candles[j]['l'] for j in range(i-xp, i)]
            if not in_trade and candles[i]['c'] > max(highs):
                in_trade = True; entry_i = i
            elif in_trade and candles[i]['c'] < min(lows):
                signals.append({'entry_i': entry_i, 'exit_i': i, 'direction': 'long'})
                in_trade = False
        if in_trade and entry_i is not None:
            signals.append({'entry_i': entry_i, 'exit_i': n-1, 'direction': 'long'})

    elif strategy_id == 'mean_reversion':
        period = params['period']; std_mult = params['std_dev']
        in_trade = False; entry_i = None
        for i in range(period, n):
            window = [candles[j]['c'] for j in range(i-period, i)]
            mean = sum(window) / period
            std  = math.sqrt(sum((x - mean)**2 for x in window) / period)
            if std == 0: continue
            lower = mean - std_mult * std
            mid   = mean
            price = candles[i]['c']
            if not in_trade and price <= lower:
                in_trade = True; entry_i = i
            elif in_trade and price >= mid:
                signals.append({'entry_i': entry_i, 'exit_i': i, 'direction': 'long'})
                in_trade = False
        if in_trade and entry_i is not None:
            signals.append({'entry_i': entry_i, 'exit_i': n-1, 'direction': 'long'})

    return signals