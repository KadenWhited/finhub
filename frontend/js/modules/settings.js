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