// frontend/js/modules/connections.js
// Connections page — service status, sync controls, ingestion log

let _connectionsData = null;
let _connectionsTab  = 'overview'; // 'overview' | 'log'

async function renderConnections() {
  const el = document.getElementById('page-connections');
  el.innerHTML = loadingHtml('Loading connections');
  try {
    const [conns, status] = await Promise.all([
      api.get('/connections/'),
      api.get('/connections/status').catch(() => ({})),
    ]);
    _connectionsData = conns;
    renderConnectionsView(el, conns, status);
  } catch (e) {
    el.innerHTML = `<p style="color:var(--red);padding:20px">Error: ${e.message}</p>`;
  }
}

function renderConnectionsView(el, conns, liveStatus) {
  const connections = conns.connections || [];
  const scheduler   = conns.scheduler   || {};

  const allConfigured = connections.filter(c => c.configured).length;
  const allEnabled    = connections.filter(c => c.configured && c.enabled).length;

  el.innerHTML = `
    <div class="page-header">
      <div>
        <div class="page-title">Connections</div>
        <div class="page-subtitle">Third-party data ingestion — auto-sync your finances</div>
      </div>
      <button class="btn btn-ghost btn-sm" onclick="refreshConnectionStatus()">↻ Refresh</button>
    </div>

    <!-- Scheduler status strip -->
    <div class="connections-status-strip" style="margin-bottom:20px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:6px">
          <div style="width:8px;height:8px;border-radius:50%;background:${scheduler.running ? 'var(--green)' : 'var(--red)'}"></div>
          <span style="font-size:0.78rem;color:${scheduler.running ? 'var(--green)' : 'var(--red)'}">
            Scheduler ${scheduler.running ? 'running' : 'stopped'}
          </span>
        </div>
        <span style="color:var(--border);font-size:0.8rem">|</span>
        <span style="font-size:0.72rem;color:var(--text-3)">
          ${allConfigured} of ${connections.length} services configured
        </span>
        <span style="color:var(--border);font-size:0.8rem">|</span>
        <span style="font-size:0.72rem;color:var(--text-3)">
          ${allEnabled} active
        </span>
      </div>
      ${scheduler.jobs?.length ? `
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">
        ${scheduler.jobs.map(j => `
          <span style="font-size:0.65rem;color:var(--text-3);background:var(--bg-3);
                       padding:2px 8px;border-radius:10px;border:1px solid var(--border)">
            ${j.name}
          </span>`).join('')}
      </div>` : ''}
    </div>

    <!-- Tabs -->
    <div class="market-tabs" style="margin-bottom:20px">
      <button class="market-tab ${_connectionsTab==='overview'?'active':''}"
        onclick="setConnectionsTab('overview')">Services</button>
      <button class="market-tab ${_connectionsTab==='log'?'active':''}"
        onclick="setConnectionsTab('log')">Ingestion Log</button>
    </div>

    <div id="connections-tab-content"></div>
  `;

  _renderConnectionsTab(connections, liveStatus);
}

function setConnectionsTab(tab) {
  _connectionsTab = tab;
  document.querySelectorAll('.page-connections .market-tab, #page-connections .market-tab')
    .forEach(t => t.classList.toggle('active',
      t.textContent.trim() === (tab === 'overview' ? 'Services' : 'Ingestion Log')
    ));
  if (!_connectionsData) return;
  _renderConnectionsTab(_connectionsData.connections || [], {});
}

function _renderConnectionsTab(connections, liveStatus) {
  const container = document.getElementById('connections-tab-content');
  if (!container) return;

  if (_connectionsTab === 'log') {
    _renderIngestionLog(container);
    return;
  }

  // Services overview
  container.innerHTML = connections.map(c => _serviceCard(c, liveStatus[c.service])).join('');
}

function _serviceCard(c, live) {
  const isConfigured = c.configured;
  const isEnabled    = c.enabled && isConfigured;
  const statusColor  = !isConfigured ? 'var(--text-3)'
                     : c.last_sync_status === 'error' ? 'var(--red)'
                     : c.last_sync_status === 'success' ? 'var(--green)'
                     : 'var(--yellow)';
  const statusLabel  = !isConfigured ? 'Not configured'
                     : c.last_sync_status === 'error' ? 'Sync error'
                     : c.last_sync_status === 'success' ? 'Synced'
                     : isEnabled ? 'Pending first sync'
                     : 'Disabled';

  const liveOk       = live?.ok;
  const phaseLabel   = c.phase > 1 ? `Phase ${c.phase}` : '';

  const modeLabel    = c.mode === 'read_write'
    ? '<span class="badge badge-yellow" style="font-size:0.6rem">Read + Write</span>'
    : '<span class="badge badge-cyan"   style="font-size:0.6rem">Read Only</span>';

  return `
    <div class="connection-card ${isEnabled ? '' : 'connection-card-disabled'}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">

        <div style="flex:1;min-width:200px">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap">
            <div style="width:10px;height:10px;border-radius:50%;background:${statusColor};flex-shrink:0"></div>
            <span style="font-family:var(--font-display);font-weight:700;font-size:0.95rem">${c.label}</span>
            ${modeLabel}
            ${phaseLabel ? `<span class="badge badge-gray" style="font-size:0.6rem">${phaseLabel}</span>` : ''}
          </div>
          <div style="font-size:0.72rem;color:var(--text-3);margin-bottom:8px">${c.description}</div>
          <div style="font-size:0.7rem;color:${statusColor}">${statusLabel}</div>
          ${c.last_sync_at ? `
            <div style="font-size:0.65rem;color:var(--text-3);margin-top:2px">
              Last sync: ${_fmtSyncTime(c.last_sync_at)}
            </div>` : ''}
          ${c.error_message ? `
            <div style="font-size:0.68rem;color:var(--red);margin-top:4px;word-break:break-word">
              ${c.error_message}
            </div>` : ''}
          ${c.records_imported > 0 ? `
            <div style="font-size:0.68rem;color:var(--text-3);margin-top:2px">
              ${c.records_imported.toLocaleString()} records imported
            </div>` : ''}
        </div>

        <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;flex-shrink:0">
          ${isConfigured ? `
            <label class="toggle-switch">
              <input type="checkbox" ${isEnabled ? 'checked' : ''}
                onchange="toggleService('${c.service}', this.checked)">
              <span class="toggle-slider"></span>
            </label>` : ''}
          ${isConfigured ? `
            <button class="btn btn-ghost btn-sm" onclick="triggerSync('${c.service}')">
              ↻ Sync now
            </button>` : `
            <button class="btn btn-ghost btn-sm" onclick="openSetupGuide('${c.service}')">
              ⚙ Setup
            </button>`}
        </div>
      </div>

      ${!isConfigured ? _setupGuide(c.service) : ''}
    </div>
  `;
}

function _setupGuide(service) {
  const guides = {
    coinbase: `
      <div class="setup-guide">
        <div style="font-size:0.72rem;font-weight:600;color:var(--text);margin-bottom:8px">Setup: Coinbase Advanced Trade</div>
        <ol style="font-size:0.7rem;color:var(--text-3);padding-left:16px;line-height:2">
          <li>Go to <a href="https://cdp.coinbase.com" target="_blank" style="color:var(--accent)">cdp.coinbase.com</a></li>
          <li>Create a new API key → select <strong>View</strong> permissions only</li>
          <li>Copy the Key Name and Private Key</li>
          <li>Add to <code>.env</code>:<br>
            <code style="color:var(--green)">COINBASE_API_KEY_NAME=your-key-name</code><br>
            <code style="color:var(--green)">COINBASE_API_PRIVATE_KEY=your-private-key</code>
          </li>
          <li>Restart the app</li>
        </ol>
      </div>`,
    kalshi: `
      <div class="setup-guide">
        <div style="font-size:0.72rem;font-weight:600;color:var(--text);margin-bottom:8px">Setup: Kalshi</div>
        <ol style="font-size:0.7rem;color:var(--text-3);padding-left:16px;line-height:2">
          <li>Go to <a href="https://kalshi.com" target="_blank" style="color:var(--accent)">kalshi.com</a> → Settings → API</li>
          <li>Create a new API key — save the Key ID and Private Key</li>
          <li>Add to <code>.env</code>:<br>
            <code style="color:var(--green)">KALSHI_API_KEY_ID=your-key-id</code><br>
            <code style="color:var(--green)">KALSHI_API_PRIVATE_KEY=your-private-key</code>
          </li>
          <li>Restart the app</li>
        </ol>
      </div>`,
    gmail: `
      <div class="setup-guide">
        <div style="font-size:0.72rem;font-weight:600;color:var(--text);margin-bottom:8px">Setup: Gmail Email Parsing</div>
        <ol style="font-size:0.7rem;color:var(--text-3);padding-left:16px;line-height:2">
          <li>Go to <a href="https://myaccount.google.com/apppasswords" target="_blank" style="color:var(--accent)">myaccount.google.com/apppasswords</a></li>
          <li>Create an App Password for "Mail"</li>
          <li>Add to <code>.env</code>:<br>
            <code style="color:var(--green)">GMAIL_ADDRESS=you@gmail.com</code><br>
            <code style="color:var(--green)">GMAIL_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx</code>
          </li>
          <li>Restart the app — emails are parsed every 15 minutes</li>
        </ol>
        <div style="font-size:0.68rem;color:var(--yellow);margin-top:8px">
          ⚠ Use an App Password, never your main Gmail password
        </div>
      </div>`,
  };
  return guides[service] || '';
}

async function _renderIngestionLog(container) {
  container.innerHTML = loadingHtml('Loading log');
  try {
    const rows  = await api.get('/connections/log?limit=100');
    if (!rows.length) {
      container.innerHTML = emptyStateHtml('≡', 'No ingestion events yet');
      return;
    }

    const statusColors = {
      success:   'var(--green)',
      duplicate: 'var(--text-3)',
      error:     'var(--red)',
      skipped:   'var(--text-3)',
    };

    container.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th><th>Source</th><th>Type</th>
              <th>Status</th><th>Message</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr>
                <td style="font-size:0.7rem;color:var(--text-3);white-space:nowrap">
                  ${_fmtSyncTime(r.created_at)}
                </td>
                <td><span class="badge badge-gray" style="font-size:0.65rem">${r.source}</span></td>
                <td style="font-size:0.72rem">${r.record_type || '—'}</td>
                <td>
                  <span style="font-size:0.7rem;font-weight:600;color:${statusColors[r.status] || 'var(--text-3)'}">
                    ${r.status}
                  </span>
                </td>
                <td style="font-size:0.7rem;color:var(--text-3);max-width:280px;
                           overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                    title="${r.message || ''}">
                  ${r.message || '—'}
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  } catch (e) {
    container.innerHTML = `<div style="color:var(--red)">${e.message}</div>`;
  }
}

// ── Actions ───────────────────────────────────────────────────────────────────

async function toggleService(service, enabled) {
  try {
    await api.post(`/connections/${service}/toggle`, { enabled });
    showToast(`${service} ${enabled ? 'enabled' : 'disabled'} ✓`, 'success');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function triggerSync(service) {
  try {
    const result = await api.post(`/connections/${service}/sync`, {});
    showToast(result.message || 'Sync triggered ✓', 'success');
    setTimeout(refreshConnectionStatus, 3000);
  } catch (e) {
    showToast(e.message, 'error');
  }
}

async function refreshConnectionStatus() {
  try {
    const [conns, status] = await Promise.all([
      api.get('/connections/'),
      api.get('/connections/status').catch(() => ({})),
    ]);
    _connectionsData = conns;
    const el = document.getElementById('page-connections');
    if (el) renderConnectionsView(el, conns, status);
  } catch (e) { /* ignore */ }
}

function openSetupGuide(service) {
  // Scroll to the setup guide on the card
  const card = document.querySelector(`[onclick*="${service}"]`)?.closest('.connection-card');
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function _fmtSyncTime(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMin = Math.floor((now - d) / 60000);
    if (diffMin < 1)   return 'just now';
    if (diffMin < 60)  return `${diffMin}m ago`;
    if (diffMin < 1440)return `${Math.floor(diffMin/60)}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return '—'; }
}
