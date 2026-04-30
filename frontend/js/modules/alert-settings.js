// REPLACE the existing notification/alert cards in settings.js
// with this comprehensive alert settings section.
// Add these functions to settings.js and call loadAlertSettings()
// at the end of renderSettingsView().

// ── DATA DEFINITIONS ─────────────────────────────────────────────────────────

const ALERT_TYPES = [
  { id: 'price_move',         label: 'Price Move',           icon: '📈', group: 'market',
    desc: 'Coin moves beyond your alert threshold %' },
  { id: 'rsi_extreme',        label: 'RSI Extreme',          icon: '⚡', group: 'market',
    desc: 'RSI crosses into oversold (<30) or overbought (>70) territory' },
  { id: 'volume_spike',       label: 'Volume Spike',         icon: '📊', group: 'market',
    desc: 'Trading volume significantly above average' },
  { id: 'news_sentiment',     label: 'Sentiment Shift',      icon: '📰', group: 'market',
    desc: 'Market sentiment flips from bullish to bearish or vice versa' },
  { id: 'strategy_signal',    label: 'Strategy Signal',      icon: '🎯', group: 'market',
    desc: 'Backtester detects a pattern matching your active strategies' },
  { id: 'balance_low',        label: 'Low Cash Balance',     icon: '💵', group: 'finance',
    desc: 'Checkbook balance drops below your minimum threshold' },
  { id: 'large_transaction',  label: 'Large Transaction',    icon: '💳', group: 'finance',
    desc: 'Single expense exceeds your large transaction threshold' },
  { id: 'credit_utilization', label: 'Credit Utilization',   icon: '🏦', group: 'finance',
    desc: 'Any credit card exceeds your utilization % threshold' },
  { id: 'credit_charge',      label: 'Large Credit Charge',  icon: '⚠️', group: 'finance',
    desc: 'Single credit charge exceeds your threshold' },
  { id: 'daily_summary',      label: 'Daily Summary',        icon: '☀️', group: 'summary',
    desc: 'Morning digest: portfolio, top movers, cash balance' },
];

const CHANNELS = ['desktop', 'telegram', 'ntfy', 'push'];
const CHANNEL_LABELS = { desktop: '🖥 Desktop', telegram: '✈️ Telegram', ntfy: '📱 ntfy', push: '🔔 Web Push' };
const TIERS = ['high', 'medium', 'low'];
const TIER_COLORS = { high: 'var(--red)', medium: 'var(--yellow)', low: 'var(--cyan)' };
const TIER_LABELS = { high: '🔴 HIGH', medium: '🟡 MED', low: '🔵 LOW' };

// ── RENDER FUNCTION ───────────────────────────────────────────────────────────

async function loadAlertSettings() {
  try {
    const s = await api.get('/alerts/settings');
    renderAlertSettingsCard(s);
  } catch (e) {
    const el = document.getElementById('alert-settings-card');
    if (el) el.innerHTML = `<div style="color:var(--text-3);font-size:0.78rem">Could not load alert settings</div>`;
  }
}

function renderAlertSettingsCard(s) {
  const el = document.getElementById('alert-settings-card');
  if (!el) return;

  const marketTypes  = ALERT_TYPES.filter(t => t.group === 'market');
  const financeTypes = ALERT_TYPES.filter(t => t.group === 'finance');
  const summaryTypes = ALERT_TYPES.filter(t => t.group === 'summary');

  el.innerHTML = `
    <!-- Channel routing matrix -->
    <div style="margin-bottom:20px">
      <div style="font-size:0.78rem;font-weight:600;color:var(--text);margin-bottom:4px">
        Channel Routing Matrix
      </div>
      <div style="font-size:0.7rem;color:var(--text-3);margin-bottom:12px">
        Choose which channels receive each priority tier. Each cell is independently toggleable.
      </div>
      <div style="overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:0.75rem">
          <thead>
            <tr>
              <th style="padding:8px 10px;text-align:left;color:var(--text-3);font-weight:500;border-bottom:1px solid var(--border)">Priority</th>
              ${CHANNELS.map(ch => `
                <th style="padding:8px 10px;text-align:center;color:var(--text-3);font-weight:500;border-bottom:1px solid var(--border)">
                  ${CHANNEL_LABELS[ch]}
                </th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${TIERS.map(tier => `
              <tr style="border-bottom:1px solid var(--border)">
                <td style="padding:10px;font-weight:600;color:${TIER_COLORS[tier]}">${TIER_LABELS[tier]}</td>
                ${CHANNELS.map(ch => {
                  const key     = `alert_channel_${tier}_${ch}`;
                  const checked = (s[key] || '0') === '1';
                  return `
                    <td style="padding:10px;text-align:center">
                      <label class="toggle-switch" style="margin:0 auto">
                        <input type="checkbox" id="${key}" ${checked ? 'checked' : ''}
                          onchange="saveAlertSetting('${key}', this.checked ? '1' : '0')">
                        <span class="toggle-slider"></span>
                      </label>
                    </td>`;
                }).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Alert types by group -->
    ${_alertTypeGroup('📈 Market & Crypto', marketTypes, s)}
    ${_alertTypeGroup('💰 Financial', financeTypes, s)}
    ${_alertTypeGroup('☀️ Summary', summaryTypes, s)}

    <!-- Thresholds -->
    <div style="margin-top:16px">
      <div style="font-size:0.78rem;font-weight:600;color:var(--text);margin-bottom:10px">Thresholds</div>
      <div class="form-grid">
        <div class="form-group">
          <label class="form-label">Price Alert Threshold (%)</label>
          <input id="alert_threshold_pct" class="form-input" type="number" step="0.5" min="1"
            value="${s.alert_threshold_pct || 5}"
            onchange="saveAlertSetting('alert_threshold_pct', this.value)">
          <div style="font-size:0.68rem;color:var(--text-3);margin-top:3px">LOW fires at this %, MEDIUM at 1.4×, HIGH at 2×</div>
        </div>
        <div class="form-group">
          <label class="form-label">Min Cash Balance ($)</label>
          <input id="alert_checkbook_min_balance" class="form-input" type="number" step="10"
            value="${s.alert_checkbook_min_balance || 100}"
            onchange="saveAlertSetting('alert_checkbook_min_balance', this.value)">
        </div>
        <div class="form-group">
          <label class="form-label">Large Transaction Threshold ($)</label>
          <input id="alert_large_tx_threshold" class="form-input" type="number" step="10"
            value="${s.alert_large_tx_threshold || 100}"
            onchange="saveAlertSetting('alert_large_tx_threshold', this.value)">
        </div>
        <div class="form-group">
          <label class="form-label">Credit Utilization Alert (%)</label>
          <input id="alert_credit_utilization_pct" class="form-input" type="number" step="5" min="10" max="100"
            value="${s.alert_credit_utilization_pct || 80}"
            onchange="saveAlertSetting('alert_credit_utilization_pct', this.value)">
        </div>
        <div class="form-group">
          <label class="form-label">Large Credit Charge ($)</label>
          <input id="alert_credit_charge_threshold" class="form-input" type="number" step="25"
            value="${s.alert_credit_charge_threshold || 200}"
            onchange="saveAlertSetting('alert_credit_charge_threshold', this.value)">
        </div>
        <div class="form-group">
          <label class="form-label">Daily Summary Time</label>
          <input id="alert_daily_summary_time" class="form-input" type="time"
            value="${s.alert_daily_summary_time || '08:00'}"
            onchange="saveAlertSetting('alert_daily_summary_time', this.value)">
        </div>
      </div>
    </div>

    <!-- Test panel -->
    <div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">
      <div style="font-size:0.78rem;font-weight:600;color:var(--text);margin-bottom:10px">Test Notifications</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        ${TIERS.map(tier => `
          <button class="btn btn-ghost btn-sm" onclick="testAlertTier('${tier}')" style="color:${TIER_COLORS[tier]}">
            ${TIER_LABELS[tier]} Test
          </button>`).join('')}
        <button class="btn btn-ghost btn-sm" onclick="clearAlertCooldowns()">↺ Reset Cooldowns</button>
      </div>
      <div id="alert-test-results" style="font-size:0.72rem;color:var(--text-3)"></div>
    </div>
  `;
}

function _alertTypeGroup(groupLabel, types, s) {
  return `
    <div style="margin-bottom:14px">
      <div style="font-size:0.72rem;color:var(--text-3);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:8px">
        ${groupLabel}
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${types.map(t => {
          const enabledKey  = `alert_type_${t.id}_enabled`;
          const priorityKey = `alert_type_${t.id}_min_priority`;
          const enabled     = (s[enabledKey]  || '1') === '1';
          const minPriority = s[priorityKey] || 'low';
          return `
            <div style="display:flex;justify-content:space-between;align-items:center;
                        padding:10px 12px;background:var(--bg-2);border:1px solid var(--border);
                        border-radius:var(--radius);gap:12px;flex-wrap:wrap">
              <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:200px">
                <label class="toggle-switch" style="flex-shrink:0">
                  <input type="checkbox" id="${enabledKey}" ${enabled ? 'checked' : ''}
                    onchange="saveAlertSetting('${enabledKey}', this.checked ? '1' : '0');
                              this.closest('div').style.opacity = this.checked ? '1' : '0.45'">
                  <span class="toggle-slider"></span>
                </label>
                <div style="opacity:${enabled ? 1 : 0.45}">
                  <div style="font-size:0.82rem;font-weight:500">${t.icon} ${t.label}</div>
                  <div style="font-size:0.68rem;color:var(--text-3)">${t.desc}</div>
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
                <span style="font-size:0.68rem;color:var(--text-3)">Min priority:</span>
                <select id="${priorityKey}" class="form-select" style="font-size:0.72rem;padding:4px 8px;width:auto"
                  onchange="saveAlertSetting('${priorityKey}', this.value)">
                  <option value="low"    ${minPriority==='low'    ?'selected':''}>🔵 LOW+</option>
                  <option value="medium" ${minPriority==='medium' ?'selected':''}>🟡 MEDIUM+</option>
                  <option value="high"   ${minPriority==='high'   ?'selected':''}>🔴 HIGH only</option>
                </select>
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

// ── SAVE HELPERS ──────────────────────────────────────────────────────────────

async function saveAlertSetting(key, value) {
  try {
    await api.put('/alerts/settings', { [key]: value });
    // Subtle visual confirmation
    const el = document.getElementById(key);
    if (el && el.tagName !== 'INPUT') {
      el.style.outline = '1px solid var(--green)';
      setTimeout(() => { if (el) el.style.outline = ''; }, 800);
    }
  } catch (e) {
    showToast('Failed to save: ' + e.message, 'error');
  }
}

// ── TEST HELPERS ──────────────────────────────────────────────────────────────

async function testAlertTier(priority) {
  const el = document.getElementById('alert-test-results');
  if (el) el.innerHTML = `<span style="color:var(--text-3)">Sending ${priority} priority test...</span>`;
  try {
    const result = await api.post('/alerts/test', { channels: 'all', priority });
    const r = result.results || {};
    const lines = Object.entries(r).map(([ch, ok]) =>
      `${CHANNEL_LABELS[ch] || ch}: ${ok ? '✓' : '✗'}`
    );
    if (el) el.innerHTML = lines.map(l =>
      `<span style="margin-right:12px;color:${l.includes('✓')?'var(--green)':'var(--red)'}">${l}</span>`
    ).join('');
  } catch (e) {
    if (el) el.innerHTML = `<span style="color:var(--red)">${e.message}</span>`;
  }
}

async function clearAlertCooldowns() {
  try {
    await api.post('/alerts/clear', {});
    showToast('Cooldowns reset ✓', 'success');
  } catch (e) { showToast(e.message, 'error'); }
}
