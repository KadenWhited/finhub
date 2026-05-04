// Backup & Restore UI — add to settings.js
// Renders the backup/restore card inside the Settings page

function renderBackupCard() {
  return `
    <div class="card" style="margin-bottom:20px">
      <div class="card-title" style="margin-bottom:4px">Backup & Restore</div>
      <div style="font-size:0.72rem;color:var(--text-3);margin-bottom:16px;line-height:1.5">
        Export your data as an encrypted <code>.mrbackup</code> file.
        Import on any machine to restore or migrate your data.
        If you set a password, it cannot be recovered — store it safely.
      </div>

      <!-- EXPORT SECTION -->
      <div style="border:1px solid var(--border);border-radius:var(--radius-lg);
                  padding:16px;margin-bottom:12px">
        <div style="font-size:0.78rem;font-weight:600;color:var(--text);margin-bottom:12px">
          ↓ Export Backup
        </div>
        <div class="form-grid" style="margin-bottom:12px">
          <div class="form-group">
            <label class="form-label">Scope</label>
            <select id="backup-scope" class="form-select">
              <option value="full">Full backup (everything)</option>
              <option value="financial">Financial data only</option>
              <option value="settings">Settings & watchlists only</option>
              <option value="market">Market watchlists only</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label">
              Encryption Password
              <span style="font-size:0.65rem;color:var(--text-3);font-weight:400">
                — leave blank for unencrypted
              </span>
            </label>
            <input id="backup-password" class="form-input" type="password"
              placeholder="Optional — cannot be recovered if lost">
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn btn-primary" onclick="downloadBackup()">
            ↓ Download Backup
          </button>
          <div id="backup-status" style="font-size:0.72rem;color:var(--text-3)"></div>
        </div>
      </div>

      <!-- IMPORT SECTION -->
      <div style="border:1px solid var(--border);border-radius:var(--radius-lg);
                  padding:16px;margin-bottom:12px">
        <div style="font-size:0.78rem;font-weight:600;color:var(--text);margin-bottom:12px">
          ↑ Import Backup
        </div>

        <!-- File drop zone -->
        <div id="backup-dropzone"
          style="border:2px dashed var(--border);border-radius:var(--radius);
                 padding:24px;text-align:center;cursor:pointer;margin-bottom:12px;
                 transition:all 0.15s;color:var(--text-3);font-size:0.78rem"
          ondragover="event.preventDefault();this.style.borderColor='var(--accent)'"
          ondragleave="this.style.borderColor='var(--border)'"
          ondrop="handleBackupDrop(event)"
          onclick="document.getElementById('backup-file-input').click()">
          <div style="font-size:1.2rem;margin-bottom:6px">📁</div>
          Drop .mrbackup file here or click to browse
          <input id="backup-file-input" type="file" accept=".mrbackup"
            style="display:none" onchange="handleBackupFile(this.files[0])">
        </div>

        <!-- File info (shown after file selected) -->
        <div id="backup-file-info" style="display:none;margin-bottom:12px">
          <div style="background:var(--bg-3);border:1px solid var(--border);
                      border-radius:var(--radius);padding:12px;font-size:0.75rem">
            <div id="backup-file-name" style="font-weight:600;color:var(--text);
                                               margin-bottom:6px"></div>
            <div id="backup-file-meta" style="color:var(--text-3);line-height:1.8"></div>
          </div>
        </div>

        <!-- Password for encrypted backups -->
        <div id="backup-import-pw-row" style="display:none;margin-bottom:12px">
          <div class="form-group">
            <label class="form-label">Decryption Password</label>
            <input id="backup-import-password" class="form-input" type="password"
              placeholder="Password used when creating this backup"
              oninput="validateBackupFile()">
          </div>
        </div>

        <!-- Import mode -->
        <div class="form-group" style="margin-bottom:12px">
          <label class="form-label">Import Mode</label>
          <div style="display:flex;gap:10px;margin-top:4px">
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;
                          font-size:0.78rem">
              <input type="radio" name="import-mode" value="merge" checked>
              <span>
                <strong>Merge</strong>
                <span style="color:var(--text-3)"> — add missing records, keep existing</span>
              </span>
            </label>
            <label style="display:flex;align-items:center;gap:6px;cursor:pointer;
                          font-size:0.78rem">
              <input type="radio" name="import-mode" value="replace">
              <span>
                <strong>Replace</strong>
                <span style="color:var(--red)"> — wipe and restore (safety backup created first)</span>
              </span>
            </label>
          </div>
        </div>

        <div style="display:flex;gap:8px;align-items:center">
          <button id="backup-import-btn" class="btn btn-primary" style="display:none"
            onclick="importBackup()">
            ↑ Import
          </button>
          <div id="backup-import-status" style="font-size:0.72rem;color:var(--text-3)"></div>
        </div>
      </div>

      <!-- AUTO BACKUPS -->
      <div style="border:1px solid var(--border);border-radius:var(--radius-lg);padding:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;
                    margin-bottom:10px">
          <div style="font-size:0.78rem;font-weight:600;color:var(--text)">
            🛡 Safety Backups
          </div>
          <button class="btn btn-ghost btn-sm" onclick="loadSafetyBackups()">↻ Refresh</button>
        </div>
        <div style="font-size:0.7rem;color:var(--text-3);margin-bottom:10px">
          Automatically created before every Replace import. Stored locally in
          <code>data/backups/</code>.
        </div>
        <div id="safety-backups-list">
          <div style="font-size:0.7rem;color:var(--text-3)">
            <button class="btn btn-ghost btn-sm" onclick="loadSafetyBackups()">
              Load safety backups
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}


// ── EXPORT ────────────────────────────────────────────────────────────────────

async function downloadBackup() {
  const scope    = document.getElementById('backup-scope')?.value || 'full';
  const password = document.getElementById('backup-password')?.value || '';
  const statusEl = document.getElementById('backup-status');

  if (statusEl) statusEl.textContent = 'Creating backup...';

  try {
    // Fetch as blob for file download
    const response = await fetch('/api/backup/export', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ scope, password: password || null }),
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error || 'Export failed');
    }

    // Get filename from Content-Disposition header
    const disposition = response.headers.get('Content-Disposition') || '';
    const nameMatch   = disposition.match(/filename="?([^";\n]+)"?/);
    const filename    = nameMatch ? nameMatch[1] : `moneyright_backup.mrbackup`;

    const blob = await response.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);

    const encrypted = password ? ' (encrypted)' : '';
    if (statusEl) {
      statusEl.textContent = `✓ Downloaded: ${filename}`;
      statusEl.style.color = 'var(--green)';
      setTimeout(() => {
        if (statusEl) { statusEl.textContent = ''; statusEl.style.color = ''; }
      }, 4000);
    }
    showToast(`Backup downloaded${encrypted} ✓`, 'success');

  } catch (e) {
    if (statusEl) {
      statusEl.textContent = `✗ ${e.message}`;
      statusEl.style.color = 'var(--red)';
    }
    showToast(e.message, 'error');
  }
}


// ── IMPORT ────────────────────────────────────────────────────────────────────

let _backupFileContent = null;
let _backupIsEncrypted = false;

function handleBackupDrop(e) {
  e.preventDefault();
  const dropzone = document.getElementById('backup-dropzone');
  if (dropzone) dropzone.style.borderColor = 'var(--border)';
  const file = e.dataTransfer.files[0];
  if (file) handleBackupFile(file);
}

async function handleBackupFile(file) {
  if (!file) return;
  if (!file.name.endsWith('.mrbackup')) {
    showToast('Please select a .mrbackup file', 'error');
    return;
  }

  const reader = new FileReader();
  reader.onload = async e => {
    _backupFileContent = e.target.result;

    // Quick parse to get metadata without decrypting
    try {
      const envelope = JSON.parse(_backupFileContent);
      _backupIsEncrypted = envelope.encrypted || false;

      // Update dropzone
      const dz = document.getElementById('backup-dropzone');
      if (dz) {
        dz.style.borderColor  = 'var(--green)';
        dz.innerHTML = `<div style="color:var(--green);font-size:0.9rem">✓ ${file.name}</div>`;
      }

      // Show file info
      const infoEl = document.getElementById('backup-file-info');
      const nameEl = document.getElementById('backup-file-name');
      const metaEl = document.getElementById('backup-file-meta');
      if (infoEl) infoEl.style.display = 'block';
      if (nameEl) nameEl.textContent = file.name;
      if (metaEl) {
        const date = envelope.created_at
          ? new Date(envelope.created_at).toLocaleString() : 'Unknown';
        metaEl.innerHTML = `
          Scope: <strong>${envelope.scope || 'unknown'}</strong> ·
          Created: <strong>${date}</strong> ·
          App version: <strong>v${envelope.app_version || '?'}</strong> ·
          Encrypted: <strong>${_backupIsEncrypted ? '🔒 Yes' : '🔓 No'}</strong>
        `;
      }

      // Show password field if encrypted
      const pwRow = document.getElementById('backup-import-pw-row');
      if (pwRow) pwRow.style.display = _backupIsEncrypted ? 'block' : 'none';

      // If not encrypted, validate immediately
      if (!_backupIsEncrypted) {
        await validateBackupFile();
      }

    } catch (err) {
      showToast('Could not read backup file — may be corrupted', 'error');
    }
  };
  reader.readAsText(file);
}

async function validateBackupFile() {
  if (!_backupFileContent) return;

  const password = _backupIsEncrypted
    ? (document.getElementById('backup-import-password')?.value || '')
    : '';

  const statusEl = document.getElementById('backup-import-status');
  const importBtn = document.getElementById('backup-import-btn');

  if (statusEl) statusEl.textContent = 'Validating...';

  try {
    const formData = new FormData();
    formData.append('file', new Blob([_backupFileContent], {type: 'application/octet-stream'}),
                    'backup.mrbackup');
    if (password) formData.append('password', password);

    const resp   = await fetch('/api/backup/validate', { method: 'POST', body: formData });
    const result = await resp.json();

    if (result.valid && result.decrypted) {
      const total = result.total_records || 0;
      const tables = Object.entries(result.record_counts || {})
        .map(([t, n]) => `${t}: ${n}`)
        .join(' · ');

      if (statusEl) {
        statusEl.innerHTML = `<span style="color:var(--green)">
          ✓ Valid — ${total} records across ${result.tables?.length || 0} tables
        </span>`;
      }

      // Show table breakdown as tooltip/detail
      const metaEl = document.getElementById('backup-file-meta');
      if (metaEl && tables) {
        metaEl.innerHTML += `<br><span style="font-size:0.65rem">${tables}</span>`;
      }

      if (importBtn) importBtn.style.display = 'block';
    } else if (result.valid && !result.decrypted) {
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--yellow)">
        Enter the decryption password above
      </span>`;
      if (importBtn) importBtn.style.display = 'none';
    } else {
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--red)">
        ✗ ${result.error || 'Invalid backup'}
      </span>`;
      if (importBtn) importBtn.style.display = 'none';
    }
  } catch (e) {
    if (statusEl) statusEl.textContent = `Error: ${e.message}`;
  }
}

async function importBackup() {
  if (!_backupFileContent) return;

  const mode     = document.querySelector('input[name="import-mode"]:checked')?.value || 'merge';
  const password = _backupIsEncrypted
    ? (document.getElementById('backup-import-password')?.value || '')
    : '';

  // Extra confirm for replace mode
  if (mode === 'replace') {
    const confirmed = confirm(
      '⚠ REPLACE MODE\n\n' +
      'This will WIPE all existing data and restore from the backup.\n' +
      'A safety backup will be created first in data/backups/\n\n' +
      'Are you sure you want to continue?'
    );
    if (!confirmed) return;
  }

  const statusEl  = document.getElementById('backup-import-status');
  const importBtn = document.getElementById('backup-import-btn');
  if (statusEl) statusEl.textContent = 'Importing...';
  if (importBtn) importBtn.disabled = true;

  try {
    const formData = new FormData();
    formData.append('file', new Blob([_backupFileContent], {type: 'application/octet-stream'}),
                    'backup.mrbackup');
    formData.append('mode', mode);
    if (password) formData.append('password', password);

    const resp   = await fetch('/api/backup/import', { method: 'POST', body: formData });
    const result = await resp.json();

    if (result.ok) {
      const msg = `✓ Imported ${result.records_imported} records · ` +
                  `${result.records_skipped} skipped · ` +
                  `${result.tables_restored} tables`;

      if (statusEl) {
        statusEl.innerHTML = `<span style="color:var(--green)">${msg}</span>`;
      }
      showToast(`Import complete — ${result.records_imported} records restored`, 'success');

      if (result.warnings?.length) {
        console.warn('Import warnings:', result.warnings);
        showToast(`${result.warnings.length} table(s) had warnings — check console`, '');
      }

      // Reload the page after 2s so data reflects
      setTimeout(() => window.location.reload(), 2000);

    } else {
      throw new Error(result.error || 'Import failed');
    }
  } catch (e) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--red)">✗ ${e.message}</span>`;
    showToast(e.message, 'error');
  } finally {
    if (importBtn) importBtn.disabled = false;
  }
}


// ── SAFETY BACKUPS ────────────────────────────────────────────────────────────

async function loadSafetyBackups() {
  const el = document.getElementById('safety-backups-list');
  if (!el) return;
  el.innerHTML = '<div style="font-size:0.7rem;color:var(--text-3)">Loading...</div>';

  try {
    const backups = await api.get('/backup/list');
    if (!backups.length) {
      el.innerHTML = '<div style="font-size:0.7rem;color:var(--text-3)">No safety backups yet</div>';
      return;
    }

    el.innerHTML = backups.map(b => `
      <div style="display:flex;justify-content:space-between;align-items:center;
                  padding:6px 0;border-bottom:1px solid var(--border);font-size:0.72rem">
        <div>
          <span style="color:var(--text);font-family:var(--font-mono)">${b.filename}</span>
          <span style="color:var(--text-3);margin-left:8px">${b.size_kb} KB</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <span style="color:var(--text-3);font-size:0.65rem">
            ${new Date(b.created).toLocaleString()}
          </span>
          <a href="/api/backup/download-local/${encodeURIComponent(b.filename)}"
             class="btn btn-ghost btn-sm" style="font-size:0.65rem"
             download="${b.filename}">
            ↓
          </a>
        </div>
      </div>
    `).join('');
  } catch (e) {
    el.innerHTML = `<div style="font-size:0.7rem;color:var(--red)">${e.message}</div>`;
  }
}