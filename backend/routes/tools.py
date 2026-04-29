from flask import Blueprint, request, jsonify
from backend.models.database import get_db

tools_bp = Blueprint('tools', __name__)

@tools_bp.route('/position-size', methods=['POST'])
def calc_position_size():
    data = request.get_json()
    db = get_db()

    settings_rows = db.execute('SELECT * FROM settings').fetchall()
    settings = {r['key']: r['value'] for r in settings_rows}
    db.close()

    starting_capital = float(settings.get('starting_capital', 350))
    default_risk_pct = float(settings.get('risk_per_trade_pct', 2))

    account_size = float(data.get('account_size', starting_capital))
    risk_pct = float(data.get('risk_pct', default_risk_pct))
    entry_price = float(data['entry_price'])
    stop_loss_price = float(data['stop_loss_price'])

    risk_amount = account_size * (risk_pct / 100)
    price_diff = abs(entry_price - stop_loss_price)

    if price_diff == 0:
        return jsonify({'error': 'Entry and stop loss cannot be the same price'}), 400

    position_size = risk_amount / price_diff
    position_value = position_size * entry_price
    risk_reward = float(data.get('target_price', 0))

    result = {
        'account_size': account_size,
        'risk_pct': risk_pct,
        'risk_amount': round(risk_amount, 2),
        'entry_price': entry_price,
        'stop_loss_price': stop_loss_price,
        'price_diff': round(price_diff, 6),
        'position_size': round(position_size, 6),
        'position_value': round(position_value, 2),
    }

    if data.get('target_price'):
        target = float(data['target_price'])
        reward = abs(target - entry_price) * position_size
        result['target_price'] = target
        result['potential_reward'] = round(reward, 2)
        result['risk_reward_ratio'] = round(reward / risk_amount, 2) if risk_amount else None

    return jsonify(result)