// modules/settings.js

async function renderSettings() {
  const el = document.getElementById('page-settings');
  el.innerHTML = loadingHtml('Loading settings');

  try {
    const settings = await api.get('/settings/');
    renderSettingsView(el, settings);
  } catch (e) {
    el.innerHTML = `<p style="color:var(--red);padding:20px">Error: ${e.message}</p>`;
  }
}

function renderSettingsView(el, s) {
  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Settings</div>
        <div class="page-subtitle">Account configuration</div>
      </div>
    </div>

    <div style="max-width:520px;display:flex;flex-direction:column;gap:18px;">

      <div class="card">
        <div class="card-title">Trading Capital</div>
        <div class="form-grid" style="margin-top:12px">
          <div class="form-group">
            <label class="form-label">Starting Capital ($)</label>
            <input id="s-capital" class="form-input" type="number" step="any" value="${s.starting_capital || 350}">
          </div>
          <div class="form-group">
            <label class="form-label">Default Risk Per Trade (%)</label>
            <input id="s-risk" class="form-input" type="number" step="0.1" min="0.1" max="100" value="${s.risk_per_trade_pct || 2}">
          </div>
        </div>
        <div style="font-size:0.72rem;color:var(--text-3);margin-bottom:14px">
          At ${s.risk_per_trade_pct || 2}% risk, you risk $${((parseFloat(s.starting_capital || 350) * parseFloat(s.risk_per_trade_pct || 2)) / 100).toFixed(2)} per trade.
        </div>
      </div>

      <div class="card">
        <div class="card-title">Data Management</div>
        <div style="display:flex;flex-direction:column;gap:10px;margin-top:12px">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--border)">
            <div>
              <div style="font-size:0.82rem;color:var(--text)">Export all data (JSON)</div>
              <div style="font-size:0.7rem;color:var(--text-3)">Full backup — can be re-imported</div>
            </div>
            <a href="/api/export/json" class="btn btn-ghost btn-sm" download>⬇ Export</a>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--border)">
            <div>
              <div style="font-size:0.82rem;color:var(--text)">Export trades (CSV)</div>
              <div style="font-size:0.7rem;color:var(--text-3)">For spreadsheet analysis</div>
            </div>
            <a href="/api/export/csv/trades" class="btn btn-ghost btn-sm" download>⬇ Export</a>
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;border-bottom:1px solid var(--border)">
            <div>
              <div style="font-size:0.82rem;color:var(--text)">Export checkbook (CSV)</div>
            </div>
            <a href="/api/export/csv/checkbook" class="btn btn-ghost btn-sm" download>⬇ Export</a>
          </div>
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
        Save Settings
      </button>

    </div>
  `;
}

async function saveSettings() {
  const capital = document.getElementById('s-capital').value;
  const risk = document.getElementById('s-risk').value;
  if (!capital || !risk) { showToast('Fill in all fields', 'error'); return; }
  try {
    await api.put('/settings/', {
      starting_capital: capital,
      risk_per_trade_pct: risk
    });
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