// frontend/js/dash-customize.js
// Dashboard widget visibility customization
// Users toggle which module cards appear on the dashboard

// ─────────────────────────────────────────
//  DEFAULT WIDGET CONFIG
// ─────────────────────────────────────────

const DASH_WIDGETS_DEFAULT = [
  { id: 'trades',      label: 'Trade Journal', visible: true  },
  { id: 'checkbook',   label: 'Checkbook',     visible: true  },
  { id: 'budget',      label: 'Budget',        visible: true  },
  { id: 'stocks',      label: 'Stocks',        visible: true  },
  { id: 'gambling',    label: 'Gambling',      visible: true  },
  { id: 'predictions', label: 'Predictions',   visible: true  },
  { id: 'market',      label: 'Market',        visible: true  },
  { id: 'charts',      label: 'Analytics',     visible: true  },
];

let _dashWidgets   = null;
let _dashEditMode  = false;
let _dashDragSrc   = null;

// ─────────────────────────────────────────
//  LOAD / SAVE
// ─────────────────────────────────────────

async function loadDashWidgets() {
  try {
    const s   = await api.get('/settings/');
    const raw = s.dash_widgets;
    if (raw) {
      const saved = JSON.parse(raw);
      _dashWidgets = _mergeDashWidgets(saved);
    } else {
      _dashWidgets = JSON.parse(JSON.stringify(DASH_WIDGETS_DEFAULT));
    }
  } catch (e) {
    _dashWidgets = JSON.parse(JSON.stringify(DASH_WIDGETS_DEFAULT));
  }
  return _dashWidgets;
}

async function saveDashWidgets() {
  try {
    await api.put('/settings/', { dash_widgets: JSON.stringify(_dashWidgets) });
  } catch (e) {
    console.error('Failed to save dash widgets:', e);
  }
}

function _mergeDashWidgets(saved) {
  const savedIds = new Set(saved.map(w => w.id));
  const merged   = [...saved];
  for (const def of DASH_WIDGETS_DEFAULT) {
    if (!savedIds.has(def.id)) merged.push({ ...def });
  }
  return merged;
}

// ─────────────────────────────────────────
//  EDIT MODE TOGGLE
// ─────────────────────────────────────────

function toggleDashEdit() {
  _dashEditMode = !_dashEditMode;

  const btn = document.getElementById('dash-edit-btn');
  if (btn) {
    btn.textContent = _dashEditMode ? '✓ Done' : '✎ Customize';
    btn.style.color = _dashEditMode ? 'var(--green)' : 'var(--text-3)';
  }

  const panel = document.getElementById('dash-customize-panel');
  if (panel) {
    panel.style.display = _dashEditMode ? 'flex' : 'none';
  }

  // Rebuild module grid with drag handles if in edit mode
  _refreshDashModules();
}

function _buildDashCustomizePanel() {
  const panel = document.getElementById('dash-customize-panel');
  if (!panel || !_dashWidgets) return;

  panel.innerHTML = _dashWidgets.map(w => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 10px;
                background:var(--bg-3);border:1px solid var(--border);
                border-radius:var(--radius);cursor:pointer;
                opacity:${w.visible ? 1 : 0.5};transition:all 0.15s"
         onclick="toggleDashWidget('${w.id}')">
      <label class="toggle-switch" style="flex-shrink:0;pointer-events:none">
        <input type="checkbox" ${w.visible ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
      <span style="font-size:0.74rem;color:var(--text)">${w.label}</span>
    </div>
  `).join('');
}

function toggleDashWidget(id) {
  const widget = _dashWidgets?.find(w => w.id === id);
  if (!widget) return;
  widget.visible = !widget.visible;
  saveDashWidgets();
  _buildDashCustomizePanel();
  _refreshDashModules();
}

// ─────────────────────────────────────────
//  MODULE GRID REFRESH
// ─────────────────────────────────────────

function _refreshDashModules() {
  const grid = document.querySelector('.dash-modules');
  if (!grid || !_dashWidgets) return;

  // Show/hide each module card based on widget config
  _dashWidgets.forEach(w => {
    const card = grid.querySelector(`[data-widget="${w.id}"]`);
    if (!card) return;

    card.style.display = w.visible ? '' : 'none';

    if (_dashEditMode && w.visible) {
      card.setAttribute('draggable', 'true');
      card.classList.add('dash-module-editable');
      // Prevent navigation when in edit mode
      card.style.cursor = 'grab';
      card.onclick = null;
    } else {
      card.removeAttribute('draggable');
      card.classList.remove('dash-module-editable');
      card.style.cursor = 'pointer';
      // Restore navigation — re-set onclick
      const page = w.id === 'charts' ? 'charts'
                 : w.id === 'market'  ? 'market'
                 : w.id;
      card.onclick = () => navigateTo(page);
    }
  });

  if (_dashEditMode) {
    _attachDashDragHandlers(grid);
  }
}

// ─────────────────────────────────────────
//  DRAG AND DROP (dashboard modules)
// ─────────────────────────────────────────

function _attachDashDragHandlers(grid) {
  const cards = grid.querySelectorAll('[data-widget][draggable="true"]');

  cards.forEach(card => {
    card.addEventListener('dragstart', e => {
      _dashDragSrc = card;
      card.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
    });

    card.addEventListener('dragend', () => {
      card.style.opacity = '';
      grid.querySelectorAll('[data-widget]').forEach(c =>
        c.classList.remove('dash-drag-over')
      );
    });

    card.addEventListener('dragover', e => {
      e.preventDefault();
      grid.querySelectorAll('[data-widget]').forEach(c =>
        c.classList.remove('dash-drag-over')
      );
      if (card !== _dashDragSrc) card.classList.add('dash-drag-over');
    });

    card.addEventListener('drop', e => {
      e.stopPropagation();
      card.classList.remove('dash-drag-over');
      if (_dashDragSrc === card) return;

      const srcId  = _dashDragSrc?.dataset.widget;
      const destId = card.dataset.widget;
      if (!srcId || !destId) return;

      const srcIdx  = _dashWidgets.findIndex(w => w.id === srcId);
      const destIdx = _dashWidgets.findIndex(w => w.id === destId);
      if (srcIdx < 0 || destIdx < 0) return;

      const [moved] = _dashWidgets.splice(srcIdx, 1);
      _dashWidgets.splice(destIdx, 0, moved);

      saveDashWidgets();

      // Reorder DOM cards to match new order
      _reorderDashModulesDOM(grid);
    });
  });
}

function _reorderDashModulesDOM(grid) {
  // Reorder actual DOM nodes to match _dashWidgets order
  _dashWidgets.forEach(w => {
    const card = grid.querySelector(`[data-widget="${w.id}"]`);
    if (card) grid.appendChild(card); // Move to end in order
  });
}

// ─────────────────────────────────────────
//  INIT — call from renderDashboard()
// ─────────────────────────────────────────

async function initDashCustomize() {
  await loadDashWidgets();

  // Add data-widget attributes to module cards
  // (called after dashboard HTML is rendered)
  const grid = document.querySelector('.dash-modules');
  if (!grid) return;

  const widgetMap = {
    'Trade Journal': 'trades',
    'Checkbook':     'checkbook',
    'Budget':        'budget',
    'Stocks':        'stocks',
    'Gambling':      'gambling',
    'Predictions':   'predictions',
    'Market':        'market',
    'Analytics':     'charts',
  };

  grid.querySelectorAll('.dash-module').forEach(card => {
    const title = card.querySelector('.module-title')?.textContent?.trim();
    const wid   = widgetMap[title];
    if (wid) card.dataset.widget = wid;
  });

  // Apply initial visibility
  _dashWidgets.forEach(w => {
    const card = grid.querySelector(`[data-widget="${w.id}"]`);
    if (card && !w.visible) card.style.display = 'none';
  });

  // Build the customize panel
  _buildDashCustomizePanel();
}
