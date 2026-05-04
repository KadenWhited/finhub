// frontend/js/nav-customize.js
// Sidebar nav customization — drag to reorder, toggle visibility
// Dashboard is always first, Settings always last — both locked

// ─────────────────────────────────────────
//  DEFAULT NAV CONFIG
// ─────────────────────────────────────────

const NAV_DEFAULT = [
  // Locked — cannot be moved or hidden
  { page: 'dashboard',   label: 'Dashboard',   icon: '◈', locked: true  },

  // Orderable / hideable
  { page: 'checkbook',   label: 'Checkbook',   icon: '◻', locked: false },
  { page: 'credit',      label: 'Credit',       icon: '▣', locked: false },
  { page: 'budget',      label: 'Budget',       icon: '◈', locked: false },
  { page: 'trades',      label: 'Trade Journal',icon: '◇', locked: false },
  { page: 'market',      label: 'Market',       icon: '◉', locked: false },
  { page: 'stocks',      label: 'Stocks',       icon: '◈', locked: false },
  { page: 'charts',      label: 'Analytics',    icon: '╱', locked: false },
  { page: 'gambling',    label: 'Gambling',     icon: '◈', locked: false },
  { page: 'predictions', label: 'Predictions',  icon: '◈', locked: false },
  { page: 'news',        label: 'News',         icon: '≋', locked: false },
  { page: 'tools',       label: 'Tools',        icon: '⊕', locked: false },
  { page: 'backtester',  label: 'Backtester',   icon: '◈', locked: false },
  { page: 'connections', label: 'Connections',  icon: '⬡', locked: false },
  { page: 'notes',       label: 'Journal',      icon: '≡', locked: false },

  // Locked — always last
  { page: 'settings',    label: 'Settings',     icon: '⊙', locked: true  },
];

// ─────────────────────────────────────────
//  STATE
// ─────────────────────────────────────────

let _navConfig     = null;
let _navEditMode   = false;
let _dragSrc       = null;

// ─────────────────────────────────────────
//  LOAD / SAVE
// ─────────────────────────────────────────

async function loadNavConfig() {
  try {
    const s = await api.get('/settings/');
    const raw = s.nav_config;
    if (raw) {
      const saved = JSON.parse(raw);
      // Merge saved with defaults — handles new pages added after initial save
      _navConfig = _mergeNavConfig(saved);
    } else {
      _navConfig = JSON.parse(JSON.stringify(NAV_DEFAULT));
    }
  } catch (e) {
    _navConfig = JSON.parse(JSON.stringify(NAV_DEFAULT));
  }
  return _navConfig;
}

async function saveNavConfig() {
  try {
    await api.put('/settings/', { nav_config: JSON.stringify(_navConfig) });
  } catch (e) {
    console.error('Failed to save nav config:', e);
  }
}

function _mergeNavConfig(saved) {
  // Keep saved order/visibility, but add any new pages from NAV_DEFAULT
  const savedPages = new Set(saved.map(n => n.page));
  const merged     = [...saved];

  for (const def of NAV_DEFAULT) {
    if (!savedPages.has(def.page)) {
      // New page added — insert before Settings
      const settingsIdx = merged.findIndex(n => n.page === 'settings');
      const insertAt    = settingsIdx >= 0 ? settingsIdx : merged.length;
      merged.splice(insertAt, 0, { ...def });
    }
  }

  // Ensure locked items stay locked regardless of saved state
  return merged.map(item => {
    const def = NAV_DEFAULT.find(d => d.page === item.page);
    return { ...item, locked: def?.locked ?? false };
  });
}

// ─────────────────────────────────────────
//  BUILD NAV
// ─────────────────────────────────────────

function buildNav() {
  if (!_navConfig) return;
  const ul = document.querySelector('#sidebar .nav-links');
  if (!ul) return;

  // Use the app's currentPage variable, not the DOM — DOM gets reset on rebuild
  const activePage = (typeof currentPage !== 'undefined' ? currentPage : null)
                  || document.querySelector('.page.active')?.id?.replace('page-', '')
                  || 'dashboard';

  ul.innerHTML = _navConfig.map(item => {
    const hidden   = item.hidden && !item.locked;
    const isActive = item.page === activePage;
    if (hidden) return '';

    return `
      <li data-page-item="${item.page}"
          draggable="${_navEditMode && !item.locked ? 'true' : 'false'}"
          class="${_navEditMode && !item.locked ? 'nav-draggable' : ''}
                 ${_navEditMode && item.locked   ? 'nav-locked'   : ''}">
        <a data-page="${item.page}"
           class="nav-link ${isActive ? 'active' : ''}"
           style="cursor:pointer">
          <span class="nav-icon">${item.icon}</span>
          <span class="nav-label">${item.label}</span>
          ${_navEditMode && !item.locked
            ? `<span class="nav-drag-handle" title="Drag to reorder">⠿</span>`
            : ''}
          ${_navEditMode && item.locked
            ? `<span style="font-size:0.6rem;color:var(--text-3);margin-left:auto">🔒</span>`
            : ''}
        </a>
      </li>`;
  }).join('');

  if (_navEditMode) {
    _attachDragHandlers(ul);
  } else {
    ul.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', e => {
        e.preventDefault();
        const page = link.dataset.page;
        if (page) navigateTo(page);
      });
    });
  }
}

// ─────────────────────────────────────────
//  EDIT MODE TOGGLE
// ─────────────────────────────────────────

function toggleNavEdit() {
  _navEditMode = !_navEditMode;

  const btn = document.getElementById('nav-edit-btn');
  if (btn) {
    btn.textContent = _navEditMode ? '✓ Done' : '✎ Edit';
    btn.style.color = _navEditMode ? 'var(--green)' : 'var(--text-3)';
  }

  // Show/hide visibility panel
  const panel = document.getElementById('nav-visibility-panel');
  if (panel) {
    panel.style.display = _navEditMode ? 'block' : 'none';
    if (_navEditMode) _buildVisibilityPanel(panel);
  }

  buildNav();
}

function _buildVisibilityPanel(panel) {
  const items = _navConfig.filter(n => !n.locked);
  panel.innerHTML = `
    <div style="font-size:0.62rem;color:var(--text-3);letter-spacing:0.08em;
                text-transform:uppercase;margin-bottom:8px;padding:0 12px">
      Show / Hide
    </div>
    ${items.map(item => `
      <div style="display:flex;align-items:center;justify-content:space-between;
                  padding:4px 12px;gap:8px">
        <span style="font-size:0.74rem;color:${item.hidden ? 'var(--text-3)' : 'var(--text)'}">
          ${item.icon} ${item.label}
        </span>
        <label class="toggle-switch" style="flex-shrink:0;width:30px;height:16px">
          <input type="checkbox" ${item.hidden ? '' : 'checked'}
            onchange="toggleNavItem('${item.page}', this.checked)">
          <span class="toggle-slider"></span>
        </label>
      </div>
    `).join('')}
  `;
}

function toggleNavItem(page, visible) {
  const item = _navConfig.find(n => n.page === page);
  if (item && !item.locked) {
    item.hidden = !visible;
    saveNavConfig();
    buildNav();
    // Refresh panel
    const panel = document.getElementById('nav-visibility-panel');
    if (panel && _navEditMode) _buildVisibilityPanel(panel);
  }
}

// ─────────────────────────────────────────
//  DRAG AND DROP
// ─────────────────────────────────────────

function _attachDragHandlers(ul) {
  const items = ul.querySelectorAll('li[data-page-item]');

  items.forEach(li => {
    if (li.getAttribute('draggable') !== 'true') return;

    li.addEventListener('dragstart', e => {
      _dragSrc = li;
      li.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
    });

    li.addEventListener('dragend', () => {
      li.style.opacity = '';
      ul.querySelectorAll('li').forEach(el => el.classList.remove('nav-drag-over'));
    });

    li.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      ul.querySelectorAll('li').forEach(el => el.classList.remove('nav-drag-over'));
      if (li !== _dragSrc) li.classList.add('nav-drag-over');
      return false;
    });

    li.addEventListener('drop', e => {
      e.stopPropagation();
      li.classList.remove('nav-drag-over');

      if (_dragSrc === li) return;

      const srcPage  = _dragSrc?.dataset.pageItem;
      const destPage = li.dataset.pageItem;
      if (!srcPage || !destPage) return;

      // Find positions in config
      const srcIdx  = _navConfig.findIndex(n => n.page === srcPage);
      const destIdx = _navConfig.findIndex(n => n.page === destPage);

      if (srcIdx < 0 || destIdx < 0) return;

      // Don't allow dropping on locked items
      if (_navConfig[destIdx].locked) return;

      // Reorder
      const [moved] = _navConfig.splice(srcIdx, 1);
      _navConfig.splice(destIdx, 0, moved);

      // Ensure locked items stay in place
      _enforceLocked();

      saveNavConfig();
      buildNav();
      return false;
    });
  });
}

function _attachClickHandlers(ul) {
  // In edit mode, clicking items does nothing (return false on onclick)
  // but we still need to handle the Done button saving
}

function _enforceLocked() {
  // Dashboard always first
  const dashIdx = _navConfig.findIndex(n => n.page === 'dashboard');
  if (dashIdx > 0) {
    const [dash] = _navConfig.splice(dashIdx, 1);
    _navConfig.unshift(dash);
  }

  // Settings always last
  const settingsIdx = _navConfig.findIndex(n => n.page === 'settings');
  if (settingsIdx >= 0 && settingsIdx < _navConfig.length - 1) {
    const [settings] = _navConfig.splice(settingsIdx, 1);
    _navConfig.push(settings);
  }
}

// ─────────────────────────────────────────
//  TOUCH DRAG SUPPORT (mobile)
// ─────────────────────────────────────────

function _addTouchDrag(li) {
  let startY = 0, currentY = 0, clone = null;

  li.addEventListener('touchstart', e => {
    if (!_navEditMode || li.getAttribute('draggable') !== 'true') return;
    startY   = e.touches[0].clientY;
    currentY = startY;

    clone = li.cloneNode(true);
    clone.style.cssText = `
      position:fixed;left:0;width:${li.offsetWidth}px;
      opacity:0.85;z-index:9999;pointer-events:none;
      background:var(--bg-3);border:1px solid var(--accent);
      border-radius:var(--radius);
    `;
    clone.style.top = li.getBoundingClientRect().top + 'px';
    document.body.appendChild(clone);
    li.style.opacity = '0.3';
  }, { passive: true });

  li.addEventListener('touchmove', e => {
    if (!clone) return;
    e.preventDefault();
    currentY = e.touches[0].clientY;
    clone.style.top = (currentY - 20) + 'px';

    // Find item under touch
    const els = document.elementsFromPoint(20, currentY);
    const target = els.find(el =>
      el.matches('li[data-page-item]') && el !== li
    );
    document.querySelectorAll('li[data-page-item]').forEach(el =>
      el.classList.remove('nav-drag-over')
    );
    if (target) target.classList.add('nav-drag-over');
  }, { passive: false });

  li.addEventListener('touchend', e => {
    if (!clone) return;
    clone.remove();
    clone = null;
    li.style.opacity = '';

    const target = document.querySelector('li[data-page-item].nav-drag-over');
    document.querySelectorAll('li[data-page-item]').forEach(el =>
      el.classList.remove('nav-drag-over')
    );

    if (!target) return;
    const srcPage  = li.dataset.pageItem;
    const destPage = target.dataset.pageItem;
    if (!srcPage || !destPage || srcPage === destPage) return;

    const srcIdx  = _navConfig.findIndex(n => n.page === srcPage);
    const destIdx = _navConfig.findIndex(n => n.page === destPage);
    if (srcIdx < 0 || destIdx < 0 || _navConfig[destIdx].locked) return;

    const [moved] = _navConfig.splice(srcIdx, 1);
    _navConfig.splice(destIdx, 0, moved);
    _enforceLocked();
    saveNavConfig();
    buildNav();
  });
}

// ─────────────────────────────────────────
//  SIDEBAR HTML ADDITIONS
// ─────────────────────────────────────────
// Call this once from app.js after DOMContentLoaded

async function initNavCustomize() {
  await loadNavConfig();

  const footer = document.querySelector('.sidebar-footer');
  if (footer) {

    const versionEl  = footer.querySelector('.version, #app-version');
    const signOutBtn = footer.querySelector('button');

    const panel = document.createElement('div');
    panel.id = 'nav-visibility-panel';
    panel.style.cssText = `
      display:none;
      border-bottom:1px solid var(--border);
      padding-bottom:6px;
      margin-bottom:4px;
      max-height:260px;
      overflow-y:auto;
    `;

    const editBtn = document.createElement('button');
    editBtn.id        = 'nav-edit-btn';
    editBtn.className = 'btn btn-ghost btn-sm';
    editBtn.style.cssText = 'width:100%;color:var(--text-3);font-size:0.7rem;margin-bottom:6px';
    editBtn.textContent = '✎ Edit Nav';
    editBtn.onclick   = toggleNavEdit;

    // Empty footer and rebuild in correct order
    footer.innerHTML = '';
    footer.appendChild(panel);
    footer.appendChild(editBtn);
    if (versionEl) footer.appendChild(versionEl);
    if (signOutBtn) footer.appendChild(signOutBtn);
  }

  document.querySelectorAll('#mobile-nav .mob-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      navigateTo(link.dataset.page);
    });
  });

  buildNav();
}