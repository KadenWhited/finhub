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
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))
 
BASE_DIR = get_base_dir()
 
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)
 
if hasattr(sys, '_MEIPASS'):
    sys.path.insert(0, sys._MEIPASS)  # type: ignore[attr-defined]
 
 
# ─────────────────────────────────────────
#  CONFIG DETECTION
# ─────────────────────────────────────────
 
def find_env_file():
    candidates = [
        os.path.join(BASE_DIR, '.env'),
        os.path.join(os.path.dirname(BASE_DIR), '.env'),
    ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return None
 
 
def is_first_run() -> bool:
    return find_env_file() is None
 
 
def load_env():
    env_path = find_env_file()
    if env_path:
        try:
            from dotenv import load_dotenv
            load_dotenv(env_path, override=False)
            print(f"[startup] Loaded config from {env_path}")
        except ImportError:
            _parse_env_file(env_path)
    else:
        print("[startup] No .env file found")
 
 
def _parse_env_file(path: str):
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
    for port in range(preferred, preferred + 100):
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                s.bind(('127.0.0.1', port))
                return port
        except OSError:
            continue
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]
 
 
# ─────────────────────────────────────────
#  SETUP WIZARD HTML
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
    .container { max-width: 640px; width: 100%; }
    .logo { font-size: 1.4rem; font-weight: 700; color: #7c6af7; margin-bottom: 6px; letter-spacing: 0.1em; }
    .subtitle { font-size: 0.78rem; color: #606080; margin-bottom: 32px; }
    .card { background: #111118; border: 1px solid rgba(255,255,255,0.07); border-radius: 10px; padding: 24px; margin-bottom: 16px; }
    .card-title { font-size: 0.72rem; letter-spacing: 0.12em; text-transform: uppercase; color: #7c6af7; margin-bottom: 16px; }
    .form-group { margin-bottom: 14px; }
    label { display: block; font-size: 0.72rem; color: #b0b0c8; margin-bottom: 5px; }
    .hint { font-size: 0.65rem; color: #606080; margin-top: 3px; line-height: 1.4; }
    input { width: 100%; background: #1c1c28; border: 1px solid rgba(255,255,255,0.1); border-radius: 5px; padding: 8px 10px; color: #e8e8f0; font-family: 'Courier New', monospace; font-size: 0.82rem; outline: none; }
    input:focus { border-color: #7c6af7; }
    .optional { color: #606080; font-size: 0.65rem; }
    .btn { width: 100%; padding: 12px; background: #7c6af7; border: none; border-radius: 6px; color: white; font-family: 'Courier New', monospace; font-size: 0.85rem; font-weight: 600; cursor: pointer; margin-top: 8px; letter-spacing: 0.04em; }
    .btn:hover { background: #5a4fd4; }
    .btn-secondary { background: transparent; border: 1px solid rgba(255,255,255,0.1); color: #b0b0c8; margin-top: 8px; }
    .status { text-align: center; font-size: 0.75rem; color: #606080; margin-top: 16px; }
    .status.success { color: #00e676; }
    .status.error { color: #ff4757; }
    .section-toggle { font-size: 0.68rem; color: #7c6af7; cursor: pointer; margin-bottom: 12px; display: inline-block; }
    .hidden { display: none; }
  </style>
</head>
<body>
<div class="container">
  <div class="logo">⬡ MONEY RIGHT</div>
  <div class="subtitle">First-time setup — configure your personal finance hub</div>
 
  <form id="setup-form" onsubmit="saveSetup(event)">
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
        <div class="hint">Free key at <strong>coingecko.com/en/api/pricing</strong> — Demo plan. Without it, prices may be rate-limited.</div>
      </div>
    </div>
 
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
 
    <span class="section-toggle" onclick="toggleOptional()">▸ Show optional services (Kalshi, Gmail, Notifications)</span>
    <div id="optional-section" class="hidden">
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
      <div class="card">
        <div class="card-title">Gmail <span class="optional">(bank email parsing)</span></div>
        <div class="form-group">
          <label>Gmail Address</label>
          <input type="email" name="GMAIL_ADDRESS" placeholder="your@gmail.com">
        </div>
        <div class="form-group">
          <label>App Password</label>
          <input type="password" name="GMAIL_APP_PASSWORD" placeholder="16-char app password">
          <div class="hint">Generate at myaccount.google.com/apppasswords</div>
        </div>
      </div>
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
    <button type="button" class="btn btn-secondary" onclick="skipSetup()">Skip — I'll configure later in Settings</button>
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
      status.textContent = '✓ Saved! Money Right is starting in a new window...';
      status.className = 'status success';
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
  document.getElementById('status').textContent = 'Starting Money Right in a new window...';
  document.getElementById('status').className = 'status success';
}
</script>
</body>
</html>"""
 
LAUNCHING_HTML = """<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Money Right — Starting...</title>
  <style>
    body { background:#0a0a0f; color:#e8e8f0; font-family:'Courier New',monospace;
           display:flex; align-items:center; justify-content:center;
           height:100vh; margin:0; flex-direction:column; gap:16px; }
    .logo { font-size:1.4rem; color:#7c6af7; font-weight:700; letter-spacing:0.1em; }
    .msg  { font-size:0.82rem; color:#606080; }
    .dot  { animation: blink 1s infinite; }
    @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
  </style>
</head>
<body>
  <div class="logo">⬡ MONEY RIGHT</div>
  <div class="msg">Starting up<span class="dot">...</span></div>
  <script>
    async function poll() {
      try {
        const r = await fetch('/api/auth/check');
        if (r.ok) { window.location.href = '/'; return; }
      } catch(e) {}
      setTimeout(poll, 800);
    }
    setTimeout(poll, 2000);
  </script>
</body>
</html>"""
 
 
# ─────────────────────────────────────────
#  SETUP APP FACTORY
# ─────────────────────────────────────────
 
def create_setup_app(base_dir: str, port: int):
    """Minimal Flask app serving the setup wizard."""
    from flask import Flask, request, jsonify, Response
 
    setup_app = Flask(__name__)
 
    @setup_app.route('/')
    def index():
        return Response(SETUP_HTML, mimetype='text/html')
 
    @setup_app.route('/launching')
    def launching():
        return Response(LAUNCHING_HTML, mimetype='text/html')
 
    @setup_app.route('/setup/save', methods=['POST'])
    def save_config():
        data     = request.get_json() or {}
        env_path = os.path.join(base_dir, '.env')
 
        if 'SECRET_KEY' not in data:
            import secrets
            data['SECRET_KEY'] = secrets.token_hex(32)
 
        defaults = {
            'FLASK_ENV':                    'production',
            'KRAKEN_SYNC_INTERVAL_MINUTES': '5',
            'KALSHI_SYNC_INTERVAL_MINUTES': '5',
            'EMAIL_SYNC_INTERVAL_MINUTES':  '15',
            'KALSHI_DEMO_MODE':             'false',
        }
        for k, v in defaults.items():
            if k not in data:
                data[k] = v
 
        try:
            lines = ['# Money Right Configuration', '# Generated by setup wizard', '']
            for key, val in data.items():
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
        import secrets
        env_path = os.path.join(base_dir, '.env')
        with open(env_path, 'w') as f:
            f.write(f'SECRET_KEY={secrets.token_hex(32)}\n')
            f.write('FLASK_ENV=production\n')
        return jsonify({'ok': True})
 
    # Pass-through for /api/auth/check so the launching page poll works
    # while the wizard is still running (returns 503 until main app takes over)
    @setup_app.route('/api/auth/check')
    def auth_check_stub():
        return jsonify({'authenticated': False, 'setup': True}), 503
 
    return setup_app
 
 
# ─────────────────────────────────────────
#  MAIN APP FACTORY
# ─────────────────────────────────────────
 
def create_main_app():
    data_dir = os.path.join(BASE_DIR, 'data')
    os.makedirs(data_dir, exist_ok=True)
    os.environ['MONEYRIGHT_DATA_DIR'] = data_dir

    if getattr(sys, 'frozen', False) and hasattr(sys, '_MEIPASS'):
        frontend_dir = os.path.join(sys._MEIPASS, 'frontend')  # type: ignore[attr-defined]
        os.environ['MONEYRIGHT_FRONTEND_DIR'] = frontend_dir
        print(f"[startup] Frontend dir set to: {frontend_dir}")
        print(f"[startup] login.html exists: {os.path.exists(os.path.join(frontend_dir, 'login.html'))}")

    from app import app
    return app
 
 
# ─────────────────────────────────────────
#  BROWSER LAUNCHER
# ─────────────────────────────────────────
 
def open_browser(port: int, delay: float = 1.5):
    def _open():
        time.sleep(delay)
        webbrowser.open(f'http://localhost:{port}')
    threading.Thread(target=_open, daemon=True).start()
 
 
# ─────────────────────────────────────────
#  SERVER
# ─────────────────────────────────────────
 
def run_with_tray(flask_app, port: int):
    import threading
    from waitress import serve as _serve

    tray_icon = None
    try:
        import pystray
        from PIL import Image as PILImage

        icon_path = None
        for candidate in [
            os.path.join(BASE_DIR, '_internal', 'frontend', 'assets', 'icon-96.png'),
            os.path.join(BASE_DIR, 'frontend', 'assets', 'icon-96.png'),
        ]:
            if os.path.exists(candidate):
                icon_path = candidate
                break

        if icon_path:
            img = PILImage.open(icon_path).resize((64, 64))
        else:
            img = PILImage.new('RGB', (64, 64), color='#7c6af7')

        def _open_browser(icon, item):
            webbrowser.open(f'http://localhost:{port}')

        def _quit_app(icon, item):
            print("\n[shutdown] Money Right stopped.")
            icon.stop()
            os._exit(0)

        menu = pystray.Menu(
            pystray.MenuItem(f'Open Money Right', _open_browser, default=True),
            pystray.MenuItem(f'Running on port {port}', None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem('Quit', _quit_app),
        )

        tray_icon = pystray.Icon(
            'MoneyRight',
            img,
            'Money Right',
            menu,
        )

    except ImportError:
        pass

    print(f"\n{'='*50}")
    print(f"  Money Right")
    print(f"  http://localhost:{port}")
    print(f"{'='*50}")
    if tray_icon:
        print("  Check system tray to open or quit\n")
    else:
        print("  Press Ctrl+C to stop\n")

    server_thread = threading.Thread(
        target=lambda: _serve(flask_app, host='127.0.0.1', port=port, threads=4),
        daemon=True,
    )
    server_thread.start()

    if tray_icon:
        try:
            tray_icon.run()
        except KeyboardInterrupt:
            pass
        os._exit(0)
    else:
        # No tray — wait for Ctrl+C
        try:
            server_thread.join()
        except KeyboardInterrupt:
            print("\n[shutdown] Money Right stopped.")
            os._exit(0)
 
 
# ─────────────────────────────────────────
#  ENTRY POINT
# ─────────────────────────────────────────
 
def main():
    time.sleep(1)
    port = find_free_port(5000)

    if is_first_run():
        print("[startup] First run detected — showing setup wizard")
        setup_app = create_setup_app(BASE_DIR, port)

        _env_saved = threading.Event()

        def _poll_for_env():
            while not _env_saved.is_set():
                time.sleep(1)
                if find_env_file():
                    _env_saved.set()

        threading.Thread(target=_poll_for_env, daemon=True).start()

        wizard_thread = threading.Thread(
            target=lambda: __import__('waitress').serve(
                setup_app, host='127.0.0.1', port=port, threads=2
            ),
            daemon=True,
        )
        wizard_thread.start()

        open_browser(port, delay=1.0)
        _env_saved.wait()
        print("[startup] Config saved — starting Money Right...")
        time.sleep(2)

        main_port = find_free_port(port + 1)
        load_env()
        try:
            app = create_main_app()
            webbrowser.open(f'http://localhost:{main_port}')
            _run_with_tray(app, main_port)
        except Exception as e:
            import traceback
            print(f"\n[ERROR] Failed to start Money Right: {e}")
            traceback.print_exc()
            input("\nPress Enter to exit...")
            sys.exit(1)

    else:
        load_env()
        open_browser(port, delay=1.5)
        try:
            app = create_main_app()
            _run_with_tray(app, port)
        except Exception as e:
            import traceback
            print(f"\n[ERROR] Failed to start Money Right: {e}")
            traceback.print_exc()
            input("\nPress Enter to exit...")
            sys.exit(1)

def _run_with_tray(flask_app, port: int):
  from waitress import serve as _serve

  print(f"\n{'='*50}")
  print(f"  Money Right")
  print(f"  http://localhost:{port}")
  print(f"{'='*50}")

  # Start Flask in background
  server_thread = threading.Thread(
      target=lambda: _serve(flask_app, host='127.0.0.1', port=port, threads=4),
      daemon=True,
  )
  server_thread.start()

  # Try system tray
  try:
      import pystray
      from PIL import Image as PILImage

      # Find icon
      icon_path = None
      for candidate in [
          os.path.join(BASE_DIR, '_internal', 'frontend', 'assets', 'icon-96.png'),
          os.path.join(BASE_DIR, 'frontend', 'assets', 'icon-96.png'),
          os.path.join(getattr(sys, '_MEIPASS', ''), 'frontend', 'assets', 'icon-96.png'),
      ]:
          if candidate and os.path.exists(candidate):
              icon_path = candidate
              break

      img = PILImage.open(icon_path).resize((64, 64)) if icon_path \
            else PILImage.new('RGB', (64, 64), color=(124, 106, 247))

      def _open(icon, item):
          webbrowser.open(f'http://localhost:{port}')

      def _quit(icon, item):
          print("\n[shutdown] Money Right stopped.")
          icon.stop()
          os._exit(0)

      menu = pystray.Menu(
          pystray.MenuItem('Open Money Right', _open, default=True),
          pystray.MenuItem(f'Port: {port}', None, enabled=False),
          pystray.Menu.SEPARATOR,
          pystray.MenuItem('Quit', _quit),
      )

      icon = pystray.Icon('MoneyRight', img, 'Money Right', menu)
      print("  Right-click the system tray icon to quit\n")
      icon.run()

  except ImportError:
      # No pystray — fall back to Ctrl+C
      print("  Press Ctrl+C to stop\n")
      try:
          server_thread.join()
      except KeyboardInterrupt:
          print("\n[shutdown] Money Right stopped.")
          os._exit(0)
 
if __name__ == '__main__':
    main()