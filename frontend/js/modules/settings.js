// modules/settings.js — Stage 2c replacement

async function renderSettings() {
  const el = document.getElementById('page-settings');
  el.innerHTML = loadingHtml('Loading settings');
  
  try {
    const s = await api.get('/settings/');
    renderSettingsView(el, s);
  } catch (e) {
    el.innerHTML = `<p style="color:var(--red);padding:20px">Error: ${e.message}</p>`;
  }
}

function renderSettingsView(el, s) {
  const cap = parseFloat(s.starting_capital || 350);
  const riskPct = parseFloat(s.risk_per_trade_pct || 2);
  const riskAmt = (cap * riskPct / 100).toFixed(2);
  const maxLoss = parseFloat(s.max_daily_loss_pct || 5);
  const maxLossAmt = (cap * maxLoss / 100).toFixed(2);
  const alertThreshold = s.alert_threshold_pct || '5';
  const duration = s.preferred_trade_duration || 'swing';

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Settings</div>
        <div class="page-subtitle">Account & risk configuration</div>
      </div>
    </div>

    <div style="max-width:560px;display:flex;flex-direction:column;gap:18px">

      <!-- Capital -->
      <div class="card">
        <div class="card-title" style="margin-bottom:14px">Trading Capital</div>
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">Starting Capital ($)</label>
            <input id="s-capital" class="form-input" type="number" step="any"
              value="${s.starting_capital || 350}"
              oninput="updateRiskPreview()">
          </div>
          <div class="form-group">
            <label class="form-label">Currency</label>
            <select id="s-currency" class="form-select">
              <option value="USD" ${s.currency === 'USD' ? 'selected' : ''}>USD</option>
              <option value="EUR" ${s.currency === 'EUR' ? 'selected' : ''}>EUR</option>
              <option value="GBP" ${s.currency === 'GBP' ? 'selected' : ''}>GBP</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Risk Profile -->
      <div class="card">
        <div class="card-title" style="margin-bottom:6px">Risk Profile</div>
        <div style="font-size:0.72rem;color:var(--text-3);margin-bottom:14px;line-height:1.6">
          These values feed directly into the position size calculator and will power the Stage 3 backtester.
        </div>

        <div class="form-grid">
          <div class="form-group">
            <label class="form-label">Risk Per Trade (%)</label>
            <input id="s-risk" class="form-input" type="number" step="0.1" min="0.1" max="100"
              value="${s.risk_per_trade_pct || 2}"
              oninput="updateRiskPreview()">
          </div>
          <div class="form-group">
            <label class="form-label">Max Open Positions</label>
            <input id="s-maxpos" class="form-input" type="number" min="1" max="20"
              value="${s.max_open_positions || 3}">
          </div>
          <div class="form-group">
            <label class="form-label">Max Daily Loss (%)</label>
            <input id="s-maxloss" class="form-input" type="number" step="0.5" min="1" max="100"
              value="${s.max_daily_loss_pct || 5}"
              oninput="updateRiskPreview()">
          </div>
          <div class="form-group">
            <label class="form-label">Trade Style</label>
            <select id="s-duration" class="form-select">
              <option value="scalp" ${duration === 'scalp' ? 'selected' : ''}>Scalp (minutes–hours)</option>
              <option value="swing" ${duration === 'swing' ? 'selected' : ''}>Swing (days–weeks)</option>
              <option value="position" ${duration === 'position' ? 'selected' : ''}>Position (weeks–months)</option>
            </select>
          </div>
        </div>

        <!-- Live risk preview -->
        <div id="risk-preview" class="risk-preview">
          <div class="risk-row">
            <span>Max risk per trade</span>
            <span id="rp-per-trade" class="neg">-$${riskAmt}</span>
          </div>
          <div class="risk-row">
            <span>Max daily loss</span>
            <span id="rp-daily-loss" class="neg">-$${maxLossAmt}</span>
          </div>
          <div class="risk-row">
            <span>Max open positions</span>
            <span id="rp-maxpos">${s.max_open_positions || 3} simultaneous</span>
          </div>
        </div>
      </div>

      <!-- Market Alerts -->
      <div class="card">
        <div class="card-title" style="margin-bottom:14px">Market Alert Threshold</div>
        <div class="form-group">
          <label class="form-label">Flag coins moving more than this % in 24h</label>
          <div style="display:flex;align-items:center;gap:10px">
            <input id="s-alert" class="form-input" type="number" step="0.5" min="1" max="50"
              value="${alertThreshold}" style="max-width:120px">
            <span style="font-size:0.78rem;color:var(--text-3)">% (default: 5%)</span>
          </div>
        </div>
      </div>

      <!-- News Feed Weight Customization -->
      <div class="card">
        <div class="card-title" style="margin-bottom:6px">News Feed Personalization Weights</div>
        <div style="font-size:0.72rem;color:var(--text-3);margin-bottom:16px;line-height:1.6">
          Control how the ranking algorithm weighs each factor.
          Higher value = that factor matters more. Values auto-normalize to 100%.
        </div>
        <div style="display:flex;flex-direction:column;gap:12px">
          ${[
            ['news_weight_recency',        'Recency',           'How recent the article is',           40],
            ['news_weight_coin_relevance', 'Coin Relevance',    'Mentions your watchlist/traded coins', 30],
            ['news_weight_strategy_align', 'Strategy Fit',      'Matches your trading style',          15],
            ['news_weight_level_match',    'Experience Level',  'Matches beginner/intermediate/advanced',10],
            ['news_weight_content_type',   'Content Type',      'News vs education vs analysis',        5],
          ].map(([key, label, desc, defaultVal]) => `
            <div>
              <div style="display:flex;justify-content:space-between;margin-bottom:4px">
                <div>
                  <div style="font-size:0.78rem;color:var(--text)">${label}</div>
                  <div style="font-size:0.68rem;color:var(--text-3)">${desc}</div>
                </div>
                <span id="${key}_display" style="font-size:0.82rem;color:var(--accent);font-weight:600;min-width:36px;text-align:right">
                  \${s.${key} || ${defaultVal}}
                </span>
              </div>
              <input type="range" id="${key}" class="weight-slider"
                min="0" max="80" step="5"
                value="\${s.${key} || ${defaultVal}}"
                oninput="document.getElementById('${key}_display').textContent=this.value">
            </div>
          `).join('')}
        </div>
        <div style="font-size:0.68rem;color:var(--text-3);margin-top:10px">
          Values auto-normalize — setting Recency to 80 doesn't break other factors.
        </div>
      </div>

      <!-- Notification Settings -->
      <div class="card">
        <div class="card-title" style="margin-bottom:14px">Price Alert Notifications</div>
        <div style="font-size:0.72rem;color:var(--text-3);margin-bottom:14px;line-height:1.6">
          Desktop notifications when watched coins move beyond your alert threshold.
          Requires <code style="background:var(--bg-3);padding:1px 5px;border-radius:3px">pip install plyer</code> for system notifications.
        </div>
        <div id="alert-status-display" style="margin-bottom:14px"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-ghost btn-sm" onclick="testNotification()">🔔 Send Test Alert</button>
          <button class="btn btn-ghost btn-sm" onclick="clearAlertCooldowns()">↺ Reset Cooldowns</button>
          <button class="btn btn-ghost btn-sm" onclick="loadAlertStatus()">↻ Refresh Status</button>
        </div>
      </div>

      <!-- PWA & Mobile -->
      <div class="card">
        <div class="card-title" style="margin-bottom:6px">Mobile & Notifications</div>
        <div style="font-size:0.72rem;color:var(--text-3);margin-bottom:14px;line-height:1.6">
          Install FinHub to your phone home screen and enable push notifications
          for price alerts that work even when the app is closed.
        </div>

        <div style="display:flex;flex-direction:column;gap:10px">

          <!-- Install to home screen -->
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
            <div>
              <div style="font-size:0.82rem;color:var(--text)">Install to Home Screen</div>
              <div style="font-size:0.7rem;color:var(--text-3)">Works like a native app, no app store needed</div>
            </div>
            <button id="pwa-install-btn" class="btn btn-primary btn-sm" onclick="promptInstall()" style="display:none">
              Install
            </button>
            <span id="pwa-installed-badge" style="display:none;font-size:0.72rem;color:var(--green)">✓ Installed</span>
          </div>

          <!-- Push notifications -->
          <div style="padding:10px 0;border-bottom:1px solid var(--border)">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div>
                <div style="font-size:0.82rem;color:var(--text)">Push Notifications</div>
                <div style="font-size:0.7rem;color:var(--text-3)">Price alerts sent to your device</div>
              </div>
              <div style="display:flex;gap:6px">
                <button class="btn btn-ghost btn-sm" onclick="enablePushNotifications()">Enable</button>
                <button class="btn btn-ghost btn-sm" onclick="disablePushNotifications()">Disable</button>
              </div>
            </div>
            <div id="push-status-display" style="margin-top:8px"></div>
          </div>

          <!-- Test push -->
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0">
            <div>
              <div style="font-size:0.82rem;color:var(--text)">Test Push Notification</div>
              <div style="font-size:0.7rem;color:var(--text-3)">Send a test to all subscribed devices</div>
            </div>
            <button class="btn btn-ghost btn-sm" onclick="sendTestPush()">Send Test</button>
          </div>

        </div>
      </div>

      <!-- Data Management -->
      <div class="card">
        <div class="card-title" style="margin-bottom:14px">Data Management</div>
        <div style="display:flex;flex-direction:column;gap:0">
          ${exportRow('Export all data (JSON)', 'Full backup — re-importable', '/api/export/json')}
          ${exportRow('Export trades (CSV)', 'For spreadsheet analysis', '/api/export/csv/trades')}
          ${exportRow('Export checkbook (CSV)', '', '/api/export/csv/checkbook')}
          ${exportRow('Export gambling (CSV)', '', '/api/export/csv/gambling')}
          ${exportRow('Export credit (CSV)', '', '/api/export/csv/credit')}
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0">
            <div>
              <div style="font-size:0.82rem;color:var(--text)">Import from JSON backup</div>
              <div style="font-size:0.7rem;color:var(--text-3)">Merges with existing data</div>
            </div>
            <button class="btn btn-ghost btn-sm" onclick="document.getElementById('import-file').click()">⬆ Import</button>
            <input id="import-file" type="file" accept=".json" style="display:none" onchange="handleImport(event)">
          </div>
        </div>
      </div>

      <button class="btn btn-primary" onclick="saveSettings()" style="width:100%;padding:13px;font-size:0.88rem">
        Save All Settings
      </button>

    </div>
  `;

  loadPushStatus();
  if (window.matchMedia('(display-mode: standalone)').matches) {
    document.getElementById('pwa-installed-badge').style.display = 'inline';
  } else {
    document.getElementById('pwa-install-btn').style.display = _installPrompt ? 'block' : 'none';
  }
}

function exportRow(label, sub, href) {
  return `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--border)">
      <div>
        <div style="font-size:0.82rem;color:var(--text)">${label}</div>
        ${sub ? `<div style="font-size:0.7rem;color:var(--text-3)">${sub}</div>` : ''}
      </div>
      <a href="${href}" class="btn btn-ghost btn-sm" download>⬇ Export</a>
    </div>
  `;
}

function updateRiskPreview() {
  const cap = parseFloat(document.getElementById('s-capital')?.value || 350);
  const risk = parseFloat(document.getElementById('s-risk')?.value || 2);
  const maxLoss = parseFloat(document.getElementById('s-maxloss')?.value || 5);
  const maxPos = document.getElementById('s-maxpos')?.value || 3;

  const perTrade = document.getElementById('rp-per-trade');
  const dailyLoss = document.getElementById('rp-daily-loss');
  const maxPosEl = document.getElementById('rp-maxpos');

  if (perTrade) perTrade.textContent = `-$${(cap * risk / 100).toFixed(2)}`;
  if (dailyLoss) dailyLoss.textContent = `-$${(cap * maxLoss / 100).toFixed(2)}`;
  if (maxPosEl) maxPosEl.textContent = `${maxPos} simultaneous`;
}

async function saveSettings() {
  const body = {
    starting_capital: document.getElementById('s-capital').value,
    currency: document.getElementById('s-currency').value,
    risk_per_trade_pct: document.getElementById('s-risk').value,
    max_open_positions: document.getElementById('s-maxpos').value,
    max_daily_loss_pct: document.getElementById('s-maxloss').value,
    preferred_trade_duration: document.getElementById('s-duration').value,
    alert_threshold_pct: document.getElementById('s-alert').value,
    news_weight_recency:        document.getElementById('news_weight_recency')?.value,
    news_weight_coin_relevance: document.getElementById('news_weight_coin_relevance')?.value,
    news_weight_strategy_align: document.getElementById('news_weight_strategy_align')?.value,
    news_weight_level_match:    document.getElementById('news_weight_level_match')?.value,
    news_weight_content_type:   document.getElementById('news_weight_content_type')?.value,
  };

  const missing = Object.entries(body).filter(([k, v]) => !v);
  if (missing.length) { showToast('Fill in all fields', 'error'); return; }

  try {
    await api.put('/settings/', body);
    showToast('Settings saved ✓', 'success');
    renderSettings();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function handleImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const result = await api.post('/export/import', data);
    const counts = Object.entries(result.imported).map(([k, v]) => `${v} ${k}`).join(', ');
    showToast(`Imported: ${counts}`, 'success');
  } catch (e) {
    showToast('Import failed: ' + e.message, 'error');
  }
  event.target.value = '';
}

async function loadAlertStatus() {
  try {
    const status = await api.get('/alerts/status');
    const el = document.getElementById('alert-status-display');
    if (!el) return;

    const recent = Object.entries(status.last_alerts || {})
      .map(([coin, ts]) => `${coin.toUpperCase().substring(0,8)}: ${new Date(ts).toLocaleTimeString()}`)
      .join(', ');

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <div style="width:8px;height:8px;border-radius:50%;background:${status.running?'var(--green)':'var(--red)'}"></div>
        <span style="font-size:0.78rem;color:${status.running?'var(--green)':'var(--text-3)'}">
          ${status.running ? 'Alert thread running' : 'Alert thread not running'}
        </span>
      </div>
      ${recent ? `<div style="font-size:0.7rem;color:var(--text-3)">Recent alerts: ${recent}</div>` : ''}
      <div style="font-size:0.7rem;color:var(--text-3)">Cooldown: ${status.cooldown_hours}h between same-coin alerts</div>
    `;
  } catch (e) {
    const el = document.getElementById('alert-status-display');
    if (el) el.innerHTML = `<div style="font-size:0.72rem;color:var(--text-3)">Alert service unavailable</div>`;
  }
}

async function testNotification() {
  showToast('Sending test to all channels...', '');
  try {
    const result = await api.post('/alerts/test', {});
    const r = result.results || {};
    const lines = [
      `Desktop: ${r.desktop  ? '✓' : '✗'}`,
      `Telegram: ${r.telegram ? '✓' : '✗'}`,
      `ntfy:     ${r.ntfy    ? '✓' : '✗'}`,
      `Web push: ${r.push    ? '✓' : '✗'}`,
    ];
    showToast(lines.join('  ·  '), result.sent ? 'success' : 'error');
    console.log('Alert test results:', r);
  } catch(e) {
    showToast(e.message, 'error');
  }
}

async function clearAlertCooldowns() {
  try {
    await api.post('/alerts/clear', {});
    showToast('Alert cooldowns reset ✓', 'success');
    loadAlertStatus();
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function enablePushNotifications() {
  const granted = await requestPushPermission();
  if (!granted) return;
  const sub = await subscribeToPush();
  if (sub) loadPushStatus();
}

async function disablePushNotifications() {
  await unsubscribeFromPush();
  loadPushStatus();
}

async function loadPushStatus() {
  const el = document.getElementById('push-status-display');
  if (!el) return;
  try {
    const status = await getPushStatus();
    const serverStatus = await api.get('/push/status').catch(() => ({}));

    if (!status.supported) {
      el.innerHTML = `<div style="font-size:0.72rem;color:var(--text-3)">Push notifications not supported in this browser</div>`;
      return;
    }
    if (!status.vapid_configured || !serverStatus.vapid_configured) {
      el.innerHTML = `
        <div style="font-size:0.72rem;color:var(--yellow)">
          ⚠ VAPID keys not configured — push notifications require server-side setup.
          <a href="/DEPLOYMENT.md" target="_blank" style="color:var(--accent)">See DEPLOYMENT.md</a>
        </div>`;
      return;
    }

    el.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px">
        <div style="width:8px;height:8px;border-radius:50%;background:${status.subscribed?'var(--green)':'var(--text-3)'}"></div>
        <span style="font-size:0.75rem;color:${status.subscribed?'var(--green)':'var(--text-3)'}">
          ${status.subscribed ? 'Subscribed on this device' : 'Not subscribed on this device'}
        </span>
        <span style="font-size:0.68rem;color:var(--text-3)">
          · ${serverStatus.subscriptions || 0} total subscriptions
        </span>
      </div>
      <div style="font-size:0.68rem;color:var(--text-3);margin-top:4px">
        Permission: ${status.permission}
      </div>`;
  } catch (e) {
    if (el) el.innerHTML = `<div style="font-size:0.72rem;color:var(--text-3)">Push status unavailable</div>`;
  }
}

async function sendTestPush() {
  try {
    const result = await api.post('/push/test', {});
    if (result.sent > 0) showToast(`Test push sent to ${result.sent} device(s) ✓`, 'success');
    else showToast(result.error || 'No subscribed devices', 'error');
  } catch (e) { showToast(e.message, 'error'); }
}