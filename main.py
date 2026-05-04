"""
main.py — Money Right entry point
Replaces app.py as the PyInstaller target.

Handles:
- Frozen vs development path detection
- First-run config detection and setup wizard
- Waitress WSGI server (production-grade, no dev server warnings)
- Auto-open browser on startup
- Clean shutdown on Ctrl+C or window close
"""
import os
import sys
import time
import signal
import socket
import threading
import webbrowser


# ─────────────────────────────────────────
#  PATH RESOLUTION
# ─────────────────────────────────────────

def get_base_dir() -> str:
    """
    Returns the correct base directory whether running:
    - Normally (python main.py): project root
    - As frozen exe (PyInstaller): directory containing the .exe
    """
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))

BASE_DIR = get_base_dir()

# Add project root to path so backend imports work
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

# Also add PyInstaller's _MEIPASS for bundled packages
if hasattr(sys, '_MEIPASS'):
    sys.path.insert(0, sys._MEIPASS)


# ─────────────────────────────────────────
#  CONFIG DETECTION
# ─────────────────────────────────────────

def find_env_file() -> str | None:
    """Find .env file next to the executable or in project root."""
    candidates = [
        os.path.join(BASE_DIR, '.env'),
        os.path.join(os.path.dirname(BASE_DIR), '.env'),
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return None


def is_first_run() -> bool:
    """True if no .env file exists — user hasn't configured yet."""
    return find_env_file() is None


def load_env():
    """Load .env file if it exists."""
    env_path = find_env_file()
    if env_path:
        try:
            from dotenv import load_dotenv
            load_dotenv(env_path, override=False)
            print(f"[startup] Loaded config from {env_path}")
        except ImportError:
            # Parse manually as fallback
            _parse_env_file(env_path)
    else:
        print("[startup] No .env file found — starting setup wizard")


def _parse_env_file(path: str):
    """Minimal .env parser as dotenv fallback."""
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, val = line.partition('=')
            key = key.strip()
            val = val.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = val


# ─────────────────────────────────────────
#  PORT SELECTION
# ─────────────────────────────────────────

def find_free_port(preferred: int = 5000) -> int:
    """Find an available port, starting with the preferred one."""
    for port in range(preferred, preferred + 20):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('127.0.0.1', port))
                return port
        except OSError:
            continue
    # Last resort — let OS assign
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


# ─────────────────────────────────────────
#  FIRST RUN SETUP WIZARD
# ─────────────────────────────────────────

SETUP_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Money Right — Setup</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Courier New', monospace;
      background: #0a0a0f;
      color: #e8e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      max-width: 640px;
      width: 100%;
    }
    .logo {
      font-size: 1.4rem;
      font-weight: 700;
      color: #7c6af7;
      margin-bottom: 6px;
      letter-spacing: 0.1em;
    }
    .subtitle {
      font-size: 0.78rem;
      color: #606080;
      margin-bottom: 32px;
    }
    .card {
      background: #111118;
      border: 1px solid rgba(255,255,255,0.07);
      border-radius: 10px;
      padding: 24px;
      margin-bottom: 16px;
    }
    .card-title {
      font-size: 0.72rem;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: #7c6af7;
      margin-bottom: 16px;
    }
    .form-group { margin-bottom: 14px; }
    label {
      display: block;
      font-size: 0.72rem;
      color: #b0b0c8;
      margin-bottom: 5px;
    }
    .hint {
      font-size: 0.65rem;
      color: #606080;
      margin-top: 3px;
      line-height: 1.4;
    }
    input {
      width: 100%;
      background: #1c1c28;
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 5px;
      padding: 8px 10px;
      color: #e8e8f0;
      font-family: 'Courier New', monospace;
      font-size: 0.82rem;
      outline: none;
    }
    input:focus { border-color: #7c6af7; }
    .optional { color: #606080; font-size: 0.65rem; }
    .btn {
      width: 100%;
      padding: 12px;
      background: #7c6af7;
      border: none;
      border-radius: 6px;
      color: white;
      font-family: 'Courier New', monospace;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      margin-top: 8px;
      letter-spacing: 0.04em;
    }
    .btn:hover { background: #5a4fd4; }
    .btn-secondary {
      background: transparent;
      border: 1px solid rgba(255,255,255,0.1);
      color: #b0b0c8;
      margin-top: 8px;
    }
    .status {
      text-align: center;
      font-size: 0.75rem;
      color: #606080;
      margin-top: 16px;
    }
    .status.success { color: #00e676; }
    .status.error   { color: #ff4757; }
    .section-toggle {
      font-size: 0.68rem;
      color: #7c6af7;
      cursor: pointer;
      margin-bottom: 12px;
      display: inline-block;
    }
    .hidden { display: none; }
  </style>
</head>
<body>
<div class="container">
  <div class="logo">⬡ MONEY RIGHT</div>
  <div class="subtitle">First-time setup — configure your personal finance hub</div>

  <form id="setup-form" onsubmit="saveSetup(event)">

    <!-- REQUIRED -->
    <div class="card">
      <div class="card-title">Required</div>

      <div class="form-group">
        <label>App Password</label>
        <input type="password" name="APP_PASSWORD" placeholder="Set a password to protect your data">
        <div class="hint">Anyone on your network can access this app — set a password.</div>
      </div>

      <div class="form-group">
        <label>CoinGecko API Key <span class="optional">(free — recommended)</span></label>
        <input type="text" name="COINGECKO_API_KEY" placeholder="CG-...">
        <div class="hint">
          Free key at <strong>coingecko.com/en/api/pricing</strong> — click Demo plan.
          Without it, prices may be rate-limited.
        </div>
      </div>
    </div>

    <!-- KRAKEN -->
    <div class="card">
      <div class="card-title">Kraken <span class="optional">(crypto exchange sync)</span></div>
      <div class="form-group">
        <label>API Key</label>
        <input type="text" name="KRAKEN_API_KEY" placeholder="Leave blank to skip">
      </div>
      <div class="form-group">
        <label>API Secret</label>
        <input type="password" name="KRAKEN_API_SECRET" placeholder="Leave blank to skip">
        <div class="hint">Create a read-only key at kraken.com/u/security/api</div>
      </div>
    </div>

    <!-- OPTIONAL SERVICES -->
    <span class="section-toggle" onclick="toggleOptional()">
      ▸ Show optional services (Kalshi, Gmail, Notifications)
    </span>
    <div id="optional-section" class="hidden">

      <!-- KALSHI -->
      <div class="card">
        <div class="card-title">Kalshi <span class="optional">(prediction markets)</span></div>
        <div class="form-group">
          <label>API Key ID</label>
          <input type="text" name="KALSHI_API_KEY_ID" placeholder="UUID from kalshi.com">
        </div>
        <div class="form-group">
          <label>RSA Private Key</label>
          <input type="text" name="KALSHI_API_PRIVATE_KEY" placeholder="-----BEGIN RSA PRIVATE KEY-----">
          <div class="hint">Paste the full PEM key on one line</div>
        </div>
      </div>

      <!-- GMAIL -->
      <div class="card">
        <div class="card-title">Gmail <span class="optional">(bank email parsing)</span></div>
        <div class="form-group">
          <label>Gmail Address</label>
          <input type="email" name="GMAIL_ADDRESS" placeholder="your@gmail.com">
        </div>
        <div class="form-group">
          <label>App Password</label>
          <input type="password" name="GMAIL_APP_PASSWORD" placeholder="16-char app password">
          <div class="hint">Generate at myaccount.google.com/apppasswords (NOT your Gmail password)</div>
        </div>
      </div>

      <!-- NOTIFICATIONS -->
      <div class="card">
        <div class="card-title">Telegram <span class="optional">(push notifications)</span></div>
        <div class="form-group">
          <label>Bot Token</label>
          <input type="text" name="TELEGRAM_BOT_TOKEN" placeholder="From @BotFather">
        </div>
        <div class="form-group">
          <label>Chat ID</label>
          <input type="text" name="TELEGRAM_CHAT_ID" placeholder="Your numeric chat ID">
        </div>
      </div>

    </div>

    <button type="submit" class="btn">Save & Launch Money Right →</button>
    <button type="button" class="btn btn-secondary" onclick="skipSetup()">
      Skip — I'll configure later in Settings
    </button>
  </form>

  <div id="status" class="status"></div>
</div>

<script>
function toggleOptional() {
  const sec = document.getElementById('optional-section');
  const btn = document.querySelector('.section-toggle');
  const hidden = sec.classList.toggle('hidden');
  btn.textContent = hidden
    ? '▸ Show optional services (Kalshi, Gmail, Notifications)'
    : '▾ Hide optional services';
}

async function saveSetup(e) {
  e.preventDefault();
  const form = document.getElementById('setup-form');
  const data = {};
  new FormData(form).forEach((v, k) => { if (v.trim()) data[k] = v.trim(); });

  const status = document.getElementById('status');
  status.textContent = 'Saving configuration...';
  status.className = 'status';

  try {
    const resp = await fetch('/setup/save', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(data),
    });
    const result = await resp.json();
    if (result.ok) {
      status.textContent = '✓ Saved! Launching Money Right...';
      status.className = 'status success';
      setTimeout(() => window.location.href = '/', 1500);
    } else {
      throw new Error(result.error || 'Save failed');
    }
  } catch (err) {
    status.textContent = '✗ ' + err.message;
    status.className = 'status error';
  }
}

async function skipSetup() {
  await fetch('/setup/skip', { method: 'POST' });
  window.location.href = '/';
}
</script>
</body>
</html>"""


def create_setup_app(base_dir: str, port: int):
    """Create a minimal Flask app that serves the setup wizard."""
    from flask import Flask, request, jsonify, Response

    setup_app = Flask(__name__)

    @setup_app.route('/')
    def index():
        return Response(SETUP_HTML, mimetype='text/html')

    @setup_app.route('/setup/save', methods=['POST'])
    def save_config():
        data     = request.get_json() or {}
        env_path = os.path.join(base_dir, '.env')

        # Generate a secret key if not provided
        if 'SECRET_KEY' not in data:
            import secrets
            data['SECRET_KEY'] = secrets.token_hex(32)

        # Always set sensible defaults
        defaults = {
            'FLASK_ENV':                      'production',
            'KRAKEN_SYNC_INTERVAL_MINUTES':   '5',
            'KALSHI_SYNC_INTERVAL_MINUTES':   '5',
            'EMAIL_SYNC_INTERVAL_MINUTES':    '15',
            'KALSHI_DEMO_MODE':               'false',
        }
        for k, v in defaults.items():
            if k not in data:
                data[k] = v

        try:
            lines = [
                '# Money Right Configuration',
                '# Generated by setup wizard',
                '',
            ]
            for key, val in data.items():
                # Wrap multi-line values in quotes
                if '\n' in val:
                    val = f'"{val}"'
                lines.append(f'{key}={val}')

            with open(env_path, 'w') as f:
                f.write('\n'.join(lines) + '\n')

            return jsonify({'ok': True})
        except Exception as e:
            return jsonify({'ok': False, 'error': str(e)})

    @setup_app.route('/setup/skip', methods=['POST'])
    def skip():
        # Create minimal .env with just a secret key
        import secrets
        env_path = os.path.join(base_dir, '.env')
        with open(env_path, 'w') as f:
            f.write(f'SECRET_KEY={secrets.token_hex(32)}\n')
            f.write('FLASK_ENV=production\n')
        return jsonify({'ok': True})

    return setup_app


# ─────────────────────────────────────────
#  MAIN APP FACTORY
# ─────────────────────────────────────────

def create_main_app():
    if getattr(sys, 'frozen', False):
        if sys._MEIPASS not in sys.path:
            sys.path.insert(0, sys._MEIPASS)
        if BASE_DIR not in sys.path:
            sys.path.insert(0, BASE_DIR)

    data_dir = os.path.join(BASE_DIR, 'data')
    os.makedirs(data_dir, exist_ok=True)
    os.environ.setdefault('MONEYRIGHT_DATA_DIR', data_dir)

    if getattr(sys, 'frozen', False):
        frontend_dir = os.path.join(sys._MEIPASS, 'frontend')
        os.environ['MONEYRIGHT_FRONTEND_DIR'] = frontend_dir

    from app import app

    # Force DB initialization before any requests hit
    with app.app_context():
        from backend.models.database import init_db, DB_PATH
        print(f"[startup] Database: {DB_PATH}")

    return app

# ─────────────────────────────────────────
#  BROWSER LAUNCHER
# ─────────────────────────────────────────

def open_browser(port: int, delay: float = 1.5):
    """Open browser after a short delay to let the server start."""
    def _open():
        time.sleep(delay)
        webbrowser.open(f'http://localhost:{port}')
    threading.Thread(target=_open, daemon=True).start()


# ─────────────────────────────────────────
#  SERVER
# ─────────────────────────────────────────

def run_server(app, port: int, is_setup: bool = False):
    """Run the app with Waitress (production WSGI server)."""
    from waitress import serve

    label = 'Setup Wizard' if is_setup else 'Money Right'
    print(f"\n{'='*50}")
    print(f"  {label}")
    print(f"  http://localhost:{port}")
    print(f"{'='*50}\n")
    print("  Press Ctrl+C to stop\n")

    try:
        serve(app, host='127.0.0.1', port=port, threads=4)
    except KeyboardInterrupt:
        print("\n[shutdown] Money Right stopped.")
        sys.exit(0)


# ─────────────────────────────────────────
#  ENTRY POINT
# ─────────────────────────────────────────

def main():
    port = find_free_port(5000)

    if is_first_run():
        # Show setup wizard
        print("[startup] First run detected — showing setup wizard")
        open_browser(port, delay=1.0)
        setup_app = create_setup_app(BASE_DIR, port)

        # Run setup wizard — when user saves, the .env is written
        # Then restart into main app
        import threading as _threading

        def _watch_for_env():
            """Restart into main app once .env is created."""
            while True:
                time.sleep(1)
                if find_env_file():
                    time.sleep(2)  # Let user see success message
                    # Reload the server with the main app
                    print("[startup] Config saved — restarting into Money Right...")
                    os.execv(sys.executable, [sys.executable] + sys.argv)

        _threading.Thread(target=_watch_for_env, daemon=True).start()
        run_server(setup_app, port, is_setup=True)

    else:
        # Normal startup
        load_env()
        # DEBUG — remove after confirming
        import sys, os
        if getattr(sys, 'frozen', False):
            data_dir = os.path.join(os.path.dirname(sys.executable), 'data')
        else:
            data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data')
        os.environ['MONEYRIGHT_DATA_DIR'] = data_dir
        print(f"[debug] DB will be at: {data_dir}")

        open_browser(port, delay=1.5)

        try:
            app = create_main_app()
            run_server(app, port, is_setup=False)
        except Exception as e:
            print(f"\n[ERROR] Failed to start Money Right: {e}")
            print("\nTroubleshooting:")
            print("  1. Check your .env file for invalid values")
            print("  2. Make sure no other app is using port 5000")
            print("  3. Check the logs/ folder for details")
            input("\nPress Enter to exit...")
            sys.exit(1)


if __name__ == '__main__':
    main()
