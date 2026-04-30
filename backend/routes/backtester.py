"""
backend/routes/backtester.py
REST API for the backtester — fetch OHLCV, run simulations, return results.
"""
from flask import Blueprint, request, jsonify
from backend.services.backtester import (
    fetch_ohlcv, run_backtest, STRATEGIES
)

backtester_bp = Blueprint('backtester', __name__)

# Generic symbols — backtester service translates per exchange
SYMBOL_MAP = {
    'bitcoin':            'BTC/USDT',
    'ethereum':           'ETH/USDT',
    'solana':             'SOL/USDT',
    'ripple':             'XRP/USDT',
    'cardano':            'ADA/USDT',
    'avalanche-2':        'AVAX/USDT',
    'chainlink':          'LINK/USDT',
    'polkadot':           'DOT/USDT',
    'dogecoin':           'DOGE/USDT',
    'injective-protocol': 'INJ/USDT',
    'polygon':            'MATIC/USDT',
}

TIMEFRAME_MAP = {
    '1h':  {'label': '1 Hour',  'since_days': 30},
    '4h':  {'label': '4 Hour',  'since_days': 90},
    '1d':  {'label': '1 Day',   'since_days': 365},
    '1w':  {'label': '1 Week',  'since_days': 730},
}


@backtester_bp.route('/strategies', methods=['GET'])
def get_strategies():
    """List all available strategies."""
    return jsonify([
        {'id': sid, **meta}
        for sid, meta in STRATEGIES.items()
    ])


@backtester_bp.route('/symbols', methods=['GET'])
def get_symbols():
    """List supported symbols."""
    return jsonify([
        {'coin_id': cid, 'symbol': sym}
        for cid, sym in SYMBOL_MAP.items()
    ])


@backtester_bp.route('/run', methods=['POST'])
def run():
    data = request.get_json() or {}

    coin_id     = data.get('coin_id', 'bitcoin')
    symbol      = data.get('symbol') or SYMBOL_MAP.get(coin_id, 'BTC/USDT')
    timeframe   = data.get('timeframe', '1d')
    strategy_id = data.get('strategy_id', 'ema_crossover')

    tf_meta     = TIMEFRAME_MAP.get(timeframe, TIMEFRAME_MAP['1d'])
    since_days  = int(data.get('since_days', tf_meta['since_days']))
    initial_cap = float(data.get('initial_capital', 350))
    risk_pct    = float(data.get('risk_pct', 2))
    sl_raw = data.get('stop_loss_pct')
    stop_loss = float(sl_raw) if sl_raw not in (None, '', 'null', 0, '0') else None

    # exchange_id=None triggers auto-selection of US-friendly exchange
    candles, err = fetch_ohlcv(symbol, timeframe, since_days, exchange_id=None)
    if err and not candles:
        return jsonify({'error': err}), 503
    if not candles:
        return jsonify({'error': f'No candle data returned for {symbol}'}), 404

    result, err = run_backtest(
        candles, strategy_id,
        initial_capital=initial_cap,
        risk_pct=risk_pct,
        stop_loss_pct=stop_loss
    )
    if err:
        return jsonify({'error': err}), 400

    result['symbol']      = symbol
    result['timeframe']   = timeframe
    result['since_days']  = since_days
    result['candle_count'] = len(candles)
    result['warning']     = err

    return jsonify(result)


@backtester_bp.route('/compare', methods=['POST'])
def compare_strategies():
    """
    Run all strategies on the same symbol/timeframe and return ranked results.
    Body: { coin_id, timeframe, since_days, initial_capital, risk_pct }
    """
    data = request.get_json() or {}
    coin_id    = data.get('coin_id', 'bitcoin')
    symbol     = data.get('symbol') or SYMBOL_MAP.get(coin_id, 'BTC/USDT')
    timeframe  = data.get('timeframe', '1d')
    tf_meta    = TIMEFRAME_MAP.get(timeframe, TIMEFRAME_MAP['1d'])
    since_days = int(data.get('since_days', tf_meta['since_days']))
    initial_cap= float(data.get('initial_capital', 350))
    risk_pct   = float(data.get('risk_pct', 2))

    candles, err = fetch_ohlcv(symbol, timeframe, since_days)
    if err and not candles:
        return jsonify({'error': err}), 503

    results = []
    for strategy_id in STRATEGIES:
        result, sim_err = run_backtest(candles, strategy_id, initial_capital=initial_cap, risk_pct=risk_pct, stop_loss_pct=None)
        if result:
            results.append(result['metrics'])

    results.sort(key=lambda x: x['total_return_pct'], reverse=True)
    return jsonify({
        'symbol': symbol,
        'timeframe': timeframe,
        'since_days': since_days,
        'results': results,
        'warning': err
    })