# Deploying Finance Hub

## Before pushing to GitHub

1. Make sure `.gitignore` is in place — `data/` and `.env` must never be committed
2. Run `git status` and verify no `.db` or `.env` files are staged
3. The repo should contain no real financial data — it's a template others clone and run locally

## Setting up on a new machine

```bash
git clone https://github.com/yourname/finance-hub
cd finance-hub
cp .env.example .env        # then edit .env with your own values
python -m venv venv
source venv/bin/activate    # Windows: venv\Scripts\activate
pip install -r requirements.txt
python app.py
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SECRET_KEY` | Yes for production | Long random string for session signing |
| `APP_PASSWORD` | Optional | If set, enables the login screen |
| `FLASK_ENV` | Optional | Set to `development` to enable debug mode |

## Exposing to the internet (multi-device access)

The simplest approach for personal use is **Tailscale** — a free VPN that connects
your devices privately without opening any ports. Install it on your server machine
and your phone/laptop, then access the app via your Tailscale IP. No port forwarding,
no public exposure.

For a full VPS deployment, put Nginx in front of Flask and use Let's Encrypt for HTTPS.