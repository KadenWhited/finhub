from flask import Blueprint, request, jsonify
from backend.models.database import get_db
from backend.services.news import fetch_news, get_sentiment_summary, build_user_profile

news_bp = Blueprint('news', __name__)


@news_bp.route('/', methods=['GET'])
def get_news():
    coin        = request.args.get('coin')
    limit       = min(int(request.args.get('limit', 60)), 100)
    source_types= request.args.get('types', '').split(',') if request.args.get('types') else None

    # Build personalization profile from user's actual data
    db = get_db()
    profile = build_user_profile(db)
    db.close()

    articles, warning = fetch_news(
        coin_filter=coin,
        limit=limit,
        profile=profile,
        source_types=source_types
    )

    summary = get_sentiment_summary(articles)

    return jsonify({
        'articles':   articles,
        'sentiment':  summary,
        'profile':    {
            'trade_style':   profile.get('trade_style'),
            'prefer_level':  profile.get('prefer_level'),
            'capital':       profile.get('capital'),
            'risk_level':    profile.get('risk_level'),
            'watched_coins': profile.get('watched_coins', []),
            'traded_coins':  profile.get('traded_coins', []),
        },
        'coin_filter': coin,
        'warning':     warning
    })


@news_bp.route('/summary', methods=['GET'])
def get_summary():
    coin = request.args.get('coin')
    db = get_db()
    profile = build_user_profile(db)
    db.close()
    articles, warning = fetch_news(coin_filter=coin, limit=50, profile=profile)
    summary = get_sentiment_summary(articles)
    return jsonify({**summary, 'warning': warning, 'coin_filter': coin})


@news_bp.route('/profile', methods=['GET'])
def get_profile():
    """Return the user's personalization profile — useful for debug and display."""
    db = get_db()
    profile = build_user_profile(db)
    db.close()
    return jsonify(profile)
