/* Claude Proxy Bridge — Dashboard App
   All API logic preserved; adds theme toggle, custom confirm modal,
   drag-and-drop pipeline reordering, log search / stats / autoscroll,
   unsaved-changes indicator, and skeleton loaders. */

const SVG = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const ICONS = {
  wrench: SVG('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>'),
  chat: SVG('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>'),
  star: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  refresh: SVG('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'),
  box: SVG('<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>'),
  save: SVG('<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>'),
  check: SVG('<polyline points="20 6 9 17 4 12"/>'),
  copy: SVG('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  zap: SVG('<path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>'),
  arrowUp: SVG('<line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/>'),
  arrowDown: SVG('<line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/>'),
  x: SVG('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  edit: SVG('<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>'),
  grip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01"/></svg>'
};

let appState = {
  status: null,
  config: null,
  pipeline: [],
  catalog: {},
  autoRefresh: true,
  refreshInterval: null,
  pipelineDirty: false
};

// Log view state
let logFilterType = 'all';
let logSearchQuery = '';
let logAutoscroll = true;

// Initialization
document.addEventListener('DOMContentLoaded', () => {
  renderPipelineSkeleton();
  renderCatalogSkeleton();

  fetchStatus();
  loadConfig();
  loadLogs();
  startAutoRefresh();

  // Confirm modal buttons
  document.getElementById('confirm-ok-btn').addEventListener('click', () => resolveConfirm(true));
  document.getElementById('confirm-cancel-btn').addEventListener('click', () => resolveConfirm(false));
  document.getElementById('confirm-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) resolveConfirm(false);
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (document.getElementById('confirm-modal').classList.contains('active')) {
        resolveConfirm(false);
      } else {
        closeModelModal();
      }
    }
    if (e.key === 'Enter' && document.getElementById('model-modal').classList.contains('active')) {
      e.preventDefault();
      saveModalModel();
    }
  });
});

/* --------------------------------------------------------------------------
   Theme toggle (persisted in localStorage)
   -------------------------------------------------------------------------- */
function toggleTheme() {
  const root = document.documentElement;
  const goingLight = root.getAttribute('data-theme') !== 'light';
  if (goingLight) {
    root.setAttribute('data-theme', 'light');
  } else {
    root.removeAttribute('data-theme');
  }
  try {
    localStorage.setItem('cpb-theme', goingLight ? 'light' : 'dark');
  } catch (e) { /* storage unavailable */ }
}

/* --------------------------------------------------------------------------
   Custom confirm modal (replaces browser confirm())
   -------------------------------------------------------------------------- */
let confirmResolver = null;

function showConfirm({ title, message, variant = 'warning', confirmLabel = 'Confirm' }) {
  return new Promise((resolve) => {
    confirmResolver = resolve;
    const box = document.getElementById('confirm-box');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    const okBtn = document.getElementById('confirm-ok-btn');
    okBtn.textContent = confirmLabel;
    okBtn.className = 'btn ' + (variant === 'danger' ? 'btn-danger-solid' : 'btn-primary');
    box.className = 'modal-box confirm-box ' + variant;
    document.getElementById('confirm-modal').classList.add('active');
  });
}

function resolveConfirm(result) {
  document.getElementById('confirm-modal').classList.remove('active');
  if (confirmResolver) {
    const resolve = confirmResolver;
    confirmResolver = null;
    resolve(result);
  }
}

/* --------------------------------------------------------------------------
   Auto refresh
   -------------------------------------------------------------------------- */
function toggleAutoRefresh(enabled) {
  appState.autoRefresh = enabled;
  if (enabled) {
    startAutoRefresh();
  } else {
    clearInterval(appState.refreshInterval);
  }
}

function startAutoRefresh() {
  clearInterval(appState.refreshInterval);
  appState.refreshInterval = setInterval(() => {
    if (appState.autoRefresh) {
      fetchStatus();
      loadLogs();
    }
  }, 4000);
}

/* --------------------------------------------------------------------------
   Tab switching
   -------------------------------------------------------------------------- */
function switchTab(tabId, clickedEl) {
  const btn = clickedEl || event?.target;

  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

  if (btn) btn.classList.add('active');
  const target = document.getElementById(tabId);
  if (target) target.classList.add('active');

  if (tabId === 'tab-logs') loadLogs();
}

/* --------------------------------------------------------------------------
   Notifications
   -------------------------------------------------------------------------- */
function showToast(message, type = 'success') {
  const container = document.getElementById('toast-container');

  const existing = container.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.insertBefore(toast, container.firstChild);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

/* --------------------------------------------------------------------------
   Status management
   -------------------------------------------------------------------------- */
async function fetchStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    appState.status = data;

    const pill = document.getElementById('proxy-status-pill');
    const text = document.getElementById('proxy-status-text');

    if (data.running) {
      pill.className = 'status-pill running';
      text.textContent = `Running (PID ${data.pid || 'Active'})`;
    } else {
      pill.className = 'status-pill stopped';
      text.textContent = 'Proxy Stopped';
    }
  } catch (err) {
    console.error('Failed to fetch status:', err);
  }
}

async function handleProxyAction(action) {
  if (action === 'stop') {
    const ok = await showConfirm({
      title: 'Stop the LiteLLM proxy?',
      message: 'Claude Code & Claude Desktop will lose connection until you restart the proxy.',
      variant: 'danger',
      confirmLabel: 'Stop Proxy'
    });
    if (!ok) return;
  }
  if (action === 'restart') {
    const ok = await showConfirm({
      title: 'Restart the LiteLLM proxy?',
      message: 'There will be a brief interruption to all Claude API requests.',
      variant: 'warning',
      confirmLabel: 'Restart Proxy'
    });
    if (!ok) return;
  }

  showToast(`Executing proxy ${action}...`, 'success');
  try {
    const res = await fetch('/api/proxy/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action })
    });
    const data = await res.json();
    appState.status = data;
    fetchStatus();
    showToast(`Proxy ${action} completed!`, 'success');
    loadLogs();
  } catch (err) {
    showToast(`Failed to ${action} proxy: ${err}`, 'error');
  }
}

/* --------------------------------------------------------------------------
   Config management
   -------------------------------------------------------------------------- */
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    appState.config = data;
    appState.pipeline = [...data.pipeline];
    appState.catalog = { ...data.catalog };
    appState.pipelineDirty = false;
    updateSavePipelineBtn();

    renderPipeline();
    renderCatalog();

    const editor = document.getElementById('raw-yaml-editor');
    if (editor) {
      editor.value = data.raw_yaml || '';
    }
  } catch (err) {
    showToast(`Failed to load configuration: ${err}`, 'error');
  }
}

// Load clean starter template (litellm_config.example.yaml) into raw editor
async function loadExampleTemplate() {
  const confirmed = await openConfirmModal({
    title: 'Load Starter Template',
    body: 'Load the clean starter template (litellm_config.example.yaml) into the editor? Any unsaved edits will be replaced.',
    confirmText: 'Load Template',
    danger: false
  });
  if (!confirmed) return;

  try {
    const res = await fetch('/api/config/example');
    if (!res.ok) {
      throw new Error(`Server returned ${res.status}`);
    }
    const data = await res.json();
    const editor = document.getElementById('raw-yaml-editor');
    if (editor) {
      editor.value = data.raw_yaml || '';
      showToast('Starter template loaded into editor. Click "Save & Restart Proxy" to apply.', 'info');
    }
  } catch (err) {
    showToast(`Failed to load template: ${err.message || err}`, 'error');
  }
}

// Detect provider from api_base URL
function detectProviderName(apiBase) {
  if (!apiBase) return 'Custom';
  const url = apiBase.toLowerCase();
  if (url.includes('codecraftapi.com')) return 'CodeCraft';
  if (url.includes('dahl.global')) return 'Dahl Global';
  if (url.includes('artbloom.tech')) return 'ArtBloom';
  if (url.includes('minimax.io')) return 'MiniMax';
  if (url.includes('vyceai.com')) return 'VyceAI';
  if (url.includes('token-x.com')) return 'Token-X';
  if (url.includes('xkiro.com')) return 'XKiro';
  if (url.includes('xmiaom.com')) return 'XMiaom';
  if (url.includes('xinjianya.top')) return 'XinJianYa';
  if (url.includes('fxqidian.de5.net')) return 'Fxqidian';
  if (url.includes('apmix.ai')) return 'Apmix AI';
  if (url.includes('openai.com')) return 'OpenAI';
  return 'Provider';
}

// Known models with verified native function/tool calling support
const TOOL_CALLING_MODELS = [
  'claude-fable-5.1',
  'claude-sonnet-4-6',
  'claude-sonnet-4-6-alias',
  'deepseek-v4-flash',
  'MiniMaxAI/MiniMax-M2.7',
  'minimax-m3',
  'zai-org/GLM-5.3-Flash'
];

function isToolCallingSupported(modelName) {
  if (!modelName) return false;
  return TOOL_CALLING_MODELS.some(m => modelName.toLowerCase().includes(m.toLowerCase()));
}

// Copy helper with visual feedback
async function copyToClipboard(text, btnElement) {
  try {
    await navigator.clipboard.writeText(text);
    if (btnElement) {
      const origHtml = btnElement.innerHTML;
      btnElement.innerHTML = ICONS.check + 'Copied';
      btnElement.style.color = 'var(--success)';
      setTimeout(() => {
        btnElement.innerHTML = origHtml;
        btnElement.style.color = '';
      }, 2000);
    }
    showToast('Copied to clipboard!', 'success');
  } catch (err) {
    showToast('Failed to copy to clipboard', 'error');
  }
}

// Setup-tab snippets kept here so onclick attributes stay free of nested quotes
const SETUP_SNIPPETS = {
  agent: './run_claude.sh --dangerously-skip-permissions',
  safe: './run_claude.sh',
  desktop: '{\n  "anthropic_base_url": "http://localhost:4000",\n  "anthropic_api_key": "sk-litellm-proxy"\n}',
  shell: 'export ANTHROPIC_BASE_URL="http://localhost:4000"\nexport ANTHROPIC_API_KEY="sk-litellm-proxy"\nclaude'
};

function copySetupSnippet(key, btnElement) {
  const text = SETUP_SNIPPETS[key];
  if (!text) return;
  copyToClipboard(text, btnElement);
}

/* --------------------------------------------------------------------------
   Hero quick bar
   -------------------------------------------------------------------------- */
function updateHeroQuickBar() {
  const pipeline = appState.pipeline || [];
  const primaryModel = pipeline.length > 0 ? pipeline[0] : '';
  const fallbackChain = pipeline.slice(1);

  const heroModelName = document.getElementById('hero-model-name');
  const heroProviderTag = document.getElementById('hero-provider-tag');
  const heroToolBadge = document.getElementById('hero-tool-badge');
  const heroToolBadgeText = document.getElementById('hero-tool-badge-text');
  const heroSelect = document.getElementById('hero-quick-select');
  const heroFallbackChain = document.getElementById('hero-fallback-chain');
  const heroFallbackText = document.getElementById('hero-fallback-text');

  if (heroModelName && primaryModel) {
    heroModelName.textContent = primaryModel;
    const modelData = appState.catalog[primaryModel];
    const prov = modelData ? detectProviderName(modelData.api_base) : 'Proxy';
    if (heroProviderTag) heroProviderTag.textContent = prov;

    if (heroToolBadge && heroToolBadgeText) {
      if (isToolCallingSupported(primaryModel)) {
        heroToolBadgeText.textContent = 'Tool Calling Verified';
        heroToolBadge.className = 'hero-tool-badge';
      } else {
        heroToolBadgeText.textContent = 'Text / Chat Only';
        heroToolBadge.className = 'hero-tool-badge warning';
      }
    }
  } else if (heroModelName) {
    heroModelName.textContent = 'None configured';
    if (heroProviderTag) heroProviderTag.textContent = '—';
  }

  if (heroFallbackChain && heroFallbackText) {
    if (fallbackChain.length > 0) {
      heroFallbackText.textContent = fallbackChain.join(' → ');
      heroFallbackChain.style.display = 'inline-flex';
    } else {
      heroFallbackChain.style.display = 'none';
    }
  }

  if (heroSelect && appState.catalog) {
    heroSelect.innerHTML = '';
    Object.entries(appState.catalog).forEach(([name, data]) => {
      const opt = document.createElement('option');
      opt.value = name;
      const prov = detectProviderName(data.api_base);
      const isPri = name === primaryModel;
      opt.textContent = `${isPri ? '[#1] ' : ''}${name} (${prov})`;
      if (isPri) opt.selected = true;
      heroSelect.appendChild(opt);
    });
  }
}

function populateQuickSelectors() {
  const heroSelect = document.getElementById('hero-quick-select');
  if (!heroSelect) return;

  const currentPrimary = appState.pipeline && appState.pipeline.length > 0 ? appState.pipeline[0] : '';
  const entries = Object.entries(appState.catalog || {});

  heroSelect.innerHTML = '';

  entries.forEach(([name, data]) => {
    const opt = document.createElement('option');
    opt.value = name;
    const prov = detectProviderName(data.api_base);
    const isPri = name === currentPrimary;
    opt.textContent = `${isPri ? '[#1] ' : ''}${name} (${prov} — ${data.target_model || name})`;
    if (isPri) opt.selected = true;
    heroSelect.appendChild(opt);
  });

  updateHeroQuickBar();
}

async function applyQuickSwitchFromSelect(modelName) {
  if (!modelName) return;
  await setAsPrimaryModel(modelName);
}

/* --------------------------------------------------------------------------
   Fallback pipeline
   -------------------------------------------------------------------------- */
function renderPipelineSkeleton() {
  const container = document.getElementById('pipeline-list');
  if (!container) return;
  container.innerHTML = [1, 2, 3].map(() => `
    <div class="pipeline-item">
      <div class="pipeline-left">
        <div class="skeleton" style="width: 32px; height: 32px; border-radius: 8px;"></div>
        <div style="flex: 1; min-width: 200px;">
          <div class="skeleton skeleton-line sk-lg"></div>
          <div class="skeleton skeleton-line sk-md"></div>
        </div>
      </div>
      <div class="skeleton" style="width: 150px; height: 30px;"></div>
    </div>
  `).join('');
}

function renderPipeline() {
  const container = document.getElementById('pipeline-list');
  container.innerHTML = '';

  populateQuickSelectors();

  if (!appState.pipeline || appState.pipeline.length === 0) {
    container.innerHTML = '<div class="empty-state">No active pipeline models configured.</div>';
    return;
  }

  appState.pipeline.forEach((modelName, index) => {
    const modelData = appState.catalog[modelName] || {
      model_name: modelName,
      target_model: modelName,
      api_base: 'configured'
    };

    const isPrimary = index === 0;
    const provider = detectProviderName(modelData.api_base);
    const toolSupported = isToolCallingSupported(modelName);
    const item = document.createElement('div');
    item.className = `pipeline-item ${isPrimary ? 'priority-1' : ''}`;
    item.dataset.index = index;

    item.innerHTML = `
      <div class="pipeline-left">
        <span class="drag-handle" title="Drag to reorder priority">${ICONS.grip}</span>
        <div class="priority-badge">${index + 1}</div>
        <div class="pipeline-info">
          <div class="pipeline-name">
            ${escapeHtml(modelName)}
            <span class="provider-tag">${escapeHtml(provider)}</span>
            ${toolSupported
        ? `<span class="tool-badge verified">${ICONS.wrench} Tool Calling</span>`
        : `<span class="tool-badge text-only">${ICONS.chat} Chat Only</span>`}
            ${isPrimary ? '<span class="primary-route-chip">PRIMARY ACTIVE ROUTE</span>' : ''}
          </div>
          <div class="pipeline-meta">
            <span>Base: ${escapeHtml(modelData.api_base || 'default')}</span>
            <span>Target: ${escapeHtml(modelData.target_model || modelName)}</span>
          </div>
        </div>
      </div>

      <div class="pipeline-actions">
        <div id="ping-badge-${index}" class="ping-result" style="margin-right: 0.35rem;"></div>
        <button class="btn btn-secondary btn-sm" onclick="pingPipelineModel('${escapeHtml(modelName)}', ${index})">
          ${ICONS.zap} Ping
        </button>
        <button class="btn btn-secondary btn-sm" onclick="movePipelineItem(${index}, -1)" ${index === 0 ? 'disabled' : ''} title="Move up in priority">
          ${ICONS.arrowUp}
        </button>
        <button class="btn btn-secondary btn-sm" onclick="movePipelineItem(${index}, 1)" ${index === appState.pipeline.length - 1 ? 'disabled' : ''} title="Move down in priority">
          ${ICONS.arrowDown}
        </button>
        <button class="btn btn-danger btn-sm" onclick="removePipelineItem(${index})" title="Remove from fallback hierarchy (model remains safe in Catalog)">
          ${ICONS.x}
        </button>
      </div>
    `;

    attachPipelineDragHandlers(item);
    container.appendChild(item);
  });
}

// Drag & drop reordering (drag from the grip handle)
function attachPipelineDragHandlers(item) {
  const handle = item.querySelector('.drag-handle');

  handle.addEventListener('mousedown', () => { item.draggable = true; });
  handle.addEventListener('touchstart', () => { item.draggable = true; }, { passive: true });

  item.addEventListener('dragstart', (e) => {
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(item.dataset.index));
  });

  item.addEventListener('dragend', () => {
    item.draggable = false;
    item.classList.remove('dragging');
    document.querySelectorAll('.pipeline-item').forEach(el => {
      el.classList.remove('drop-above', 'drop-below');
    });
  });

  item.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const rect = item.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    item.classList.toggle('drop-above', before);
    item.classList.toggle('drop-below', !before);
  });

  item.addEventListener('dragleave', () => {
    item.classList.remove('drop-above', 'drop-below');
  });

  item.addEventListener('drop', (e) => {
    e.preventDefault();
    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    const toIndex = parseInt(item.dataset.index, 10);
    item.classList.remove('drop-above', 'drop-below');

    if (isNaN(fromIndex) || fromIndex === toIndex) return;

    const rect = item.getBoundingClientRect();
    const before = e.clientY < rect.top + rect.height / 2;
    let insertAt = before ? toIndex : toIndex + 1;
    // Removing the dragged element shifts the target index when moving down
    if (fromIndex < insertAt) insertAt--;

    const [moved] = appState.pipeline.splice(fromIndex, 1);
    appState.pipeline.splice(insertAt, 0, moved);

    renderPipeline();
    markPipelineDirty();
    showToast('Pipeline reordered. Click "Save & Reload Proxy" to commit.', 'success');
  });
}

function movePipelineItem(index, offset) {
  const newIndex = index + offset;
  if (newIndex < 0 || newIndex >= appState.pipeline.length) return;

  [appState.pipeline[index], appState.pipeline[newIndex]] =
    [appState.pipeline[newIndex], appState.pipeline[index]];

  renderPipeline();
  markPipelineDirty();
  showToast('Priority changed. Click "Save & Reload Proxy" to commit.', 'success');
}

function removePipelineItem(index) {
  if (appState.pipeline.length <= 1) {
    showToast('Cannot remove the only model in the fallback pipeline!', 'error');
    return;
  }
  const removed = appState.pipeline.splice(index, 1);
  renderPipeline();
  markPipelineDirty();
  showToast(`Removed ${removed[0]} from the pipeline. It remains safe in the Model Catalog.`, 'success');
}

/* --------------------------------------------------------------------------
   Unsaved-changes indicator + save
   -------------------------------------------------------------------------- */
function markPipelineDirty() {
  appState.pipelineDirty = true;
  updateSavePipelineBtn();
}

function updateSavePipelineBtn() {
  const btn = document.getElementById('btn-save-pipeline');
  if (!btn) return;
  btn.innerHTML =
    (appState.pipelineDirty ? '<span class="unsaved-dot" title="Unsaved changes"></span>' : ICONS.save) +
    'Save & Reload Proxy';
}

// Track in-flight save state
let saveState = { pipeline: false, model: false, yaml: false };

function setSaveState(key, loading) {
  saveState[key] = loading;
  const btn = document.getElementById('btn-save-pipeline');
  if (key === 'pipeline' && btn) {
    btn.disabled = loading;
    if (loading) {
      btn.innerHTML = '<span class="btn-spinner"></span> Saving...';
    } else {
      updateSavePipelineBtn();
    }
  }
}

async function savePipelineChanges() {
  if (saveState.pipeline) return;
  setSaveState('pipeline', true);
  try {
    showToast('Saving pipeline & updating fallback router...', 'success');
    const res = await fetch('/api/config/pipeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pipeline: appState.pipeline,
        models: appState.catalog,
        restart_proxy: true
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to save pipeline');
    }

    showToast('Pipeline saved and LiteLLM proxy restarted!', 'success');
    loadConfig();
    fetchStatus();
    loadLogs();
  } catch (err) {
    showToast(`Error saving pipeline: ${err.message}`, 'error');
  } finally {
    setSaveState('pipeline', false);
  }
}

/* --------------------------------------------------------------------------
   Set primary model
   -------------------------------------------------------------------------- */
async function setAsPrimaryModel(modelName) {
  if (!appState.catalog[modelName]) {
    showToast(`Model ${modelName} not found in catalog!`, 'error');
    return;
  }

  if (appState.pipeline.length > 0 && appState.pipeline[0] === modelName) {
    showToast(`${modelName} is already the #1 Primary route!`, 'success');
    return;
  }

  const existingIdx = appState.pipeline.indexOf(modelName);
  if (existingIdx !== -1) {
    appState.pipeline.splice(existingIdx, 1);
  }
  appState.pipeline.unshift(modelName);

  renderPipeline();
  renderCatalog();

  showToast(`Promoting ${modelName} to #1 Primary...`, 'success');
  await savePipelineChanges();
}

/* --------------------------------------------------------------------------
   Catalog search & filters
   -------------------------------------------------------------------------- */
let catalogSearchQuery = '';
let catalogFilterType = 'all';

function handleCatalogSearch(query) {
  catalogSearchQuery = (query || '').toLowerCase().trim();
  const clearBtn = document.getElementById('btn-clear-search');
  if (clearBtn) {
    clearBtn.style.display = catalogSearchQuery ? 'grid' : 'none';
  }
  renderCatalog();
}

function clearCatalogSearch() {
  const input = document.getElementById('catalog-search-input');
  if (input) input.value = '';
  catalogSearchQuery = '';
  const clearBtn = document.getElementById('btn-clear-search');
  if (clearBtn) clearBtn.style.display = 'none';
  renderCatalog();
}

function setCatalogFilter(type, btnElement) {
  catalogFilterType = type;
  document.querySelectorAll('.catalog-filter-group .filter-pill').forEach(btn => {
    btn.classList.remove('active');
  });
  if (btnElement) btnElement.classList.add('active');
  renderCatalog();
}

function renderCatalogSkeleton() {
  const container = document.getElementById('catalog-grid');
  if (!container) return;
  container.innerHTML = [1, 2, 3, 4, 5, 6].map(() => `
    <div class="catalog-card">
      <div>
        <div class="skeleton skeleton-line sk-lg"></div>
        <div class="skeleton skeleton-line sk-md"></div>
      </div>
      <div class="skeleton skeleton-line sk-sm"></div>
      <div class="skeleton skeleton-line sk-md"></div>
      <div class="skeleton" style="height: 30px; margin-top: 0.5rem;"></div>
    </div>
  `).join('');
}

/* --------------------------------------------------------------------------
   Model catalog
   -------------------------------------------------------------------------- */
function renderCatalog() {
  const container = document.getElementById('catalog-grid');
  container.innerHTML = '';

  let entries = Object.entries(appState.catalog);
  const totalCount = entries.length;

  if (catalogSearchQuery) {
    entries = entries.filter(([name, data]) => {
      const prov = detectProviderName(data.api_base).toLowerCase();
      const target = (data.target_model || '').toLowerCase();
      return name.toLowerCase().includes(catalogSearchQuery) ||
        prov.includes(catalogSearchQuery) ||
        target.includes(catalogSearchQuery);
    });
  }

  if (catalogFilterType === 'tools') {
    entries = entries.filter(([name]) => isToolCallingSupported(name));
  } else if (catalogFilterType === 'pipeline') {
    entries = entries.filter(([name]) => appState.pipeline.includes(name));
  }

  const countBadge = document.getElementById('catalog-count-badge');
  if (countBadge) {
    countBadge.textContent = `${entries.length} of ${totalCount} Models`;
  }

  populateQuickSelectors();

  if (entries.length === 0) {
    container.innerHTML = '<div class="empty-state" style="grid-column: 1/-1;">No models match your current filter. Try clearing your search.</div>';
    return;
  }

  entries.forEach(([name, data]) => {
    const card = document.createElement('div');
    const pipelineIndex = appState.pipeline.indexOf(name);
    const isPrimary = pipelineIndex === 0;
    const isFallback = pipelineIndex > 0;
    const inPipeline = pipelineIndex !== -1;
    const provider = detectProviderName(data.api_base);
    const toolSupported = isToolCallingSupported(name);

    card.className = `catalog-card ${isPrimary ? 'is-primary' : ''}`;

    let statusBadgeHtml = '';
    if (isPrimary) {
      statusBadgeHtml = `<span class="catalog-badge primary">${ICONS.star} #1 PRIMARY</span>`;
    } else if (isFallback) {
      statusBadgeHtml = `<span class="catalog-badge fallback">${ICONS.refresh} FALLBACK #${pipelineIndex + 1}</span>`;
    } else {
      statusBadgeHtml = `<span class="catalog-badge standby">${ICONS.box} STANDBY</span>`;
    }

    card.innerHTML = `
      <div class="catalog-header">
        <div class="catalog-title">
          ${escapeHtml(name)}
          <span class="provider-tag">${escapeHtml(provider)}</span>
          ${toolSupported
        ? `<span class="tool-badge verified">${ICONS.wrench} Tool Calling</span>`
        : `<span class="tool-badge text-only">${ICONS.chat} Chat Only</span>`}
        </div>
        ${statusBadgeHtml}
      </div>

      <div class="catalog-details">
        <span><b>Provider:</b> ${escapeHtml(provider)}</span>
        <span><b>Endpoint:</b> ${escapeHtml(data.api_base)}</span>
        <span><b>Target Model:</b> ${escapeHtml(data.target_model || name)}</span>
        <span><b>API Key:</b> ${maskKey(data.api_key)}${keyCountLabel(data)}</span>
      </div>

      <div class="catalog-footer">
        <div id="catalog-ping-${escapeHtml(name)}" class="ping-result"></div>
        <div style="display: flex; gap: 0.4rem; flex-wrap: wrap;">
          ${!isPrimary ? `
            <button class="btn btn-primary-action btn-sm" onclick="setAsPrimaryModel('${escapeHtml(name)}')">
              ${ICONS.star} Set as #1
            </button>
          ` : `
            <span class="active-route-label">${ICONS.check} Active Route</span>
          `}
          ${!inPipeline ? `
            <button class="btn btn-secondary btn-sm" onclick="addModelToPipeline('${escapeHtml(name)}')">
              + Fallback
            </button>
          ` : ''}
          <button class="btn btn-secondary btn-sm" onclick="pingCatalogModel('${escapeHtml(name)}')">
            ${ICONS.zap} Ping
          </button>
          <button class="btn btn-secondary btn-sm" onclick="openEditModelModal('${escapeHtml(name)}')">
            ${ICONS.edit} Edit
          </button>
        </div>
      </div>
    `;

    container.appendChild(card);
  });
}

function addModelToPipeline(modelName) {
  if (!appState.pipeline.includes(modelName)) {
    appState.pipeline.push(modelName);
    renderPipeline();
    markPipelineDirty();
    renderCatalog();
    showToast(`Added ${modelName} to the fallback pipeline. Save to commit.`, 'success');
  }
}

/* --------------------------------------------------------------------------
   Latency & connection testing
   -------------------------------------------------------------------------- */
async function pingPipelineModel(modelName, index) {
  const badge = document.getElementById(`ping-badge-${index}`);
  if (badge) badge.innerHTML = '<span style="color: var(--text-muted);">Pinging...</span>';

  const modelData = appState.catalog[modelName] || {
    target_model: modelName,
    api_base: '',
    api_key: ''
  };

  const res = await runPing(modelData.target_model || modelName, modelData.api_base, modelData.api_key);
  if (badge) {
    if (res.success) {
      badge.className = 'ping-result success';
      badge.innerHTML = `<span class="status-dot ok"></span>${res.latency_ms}ms`;
    } else {
      badge.className = 'ping-result error';
      badge.innerHTML = `<span class="status-dot fail"></span>${res.error || 'Failed'}`;
    }
  }
}

async function pingCatalogModel(modelName) {
  const badge = document.getElementById(`catalog-ping-${modelName}`);
  if (badge) badge.innerHTML = '<span style="color: var(--text-muted);">...</span>';

  const modelData = appState.catalog[modelName];
  if (!modelData) return;

  const res = await runPing(modelData.target_model || modelName, modelData.api_base, modelData.api_key);
  if (badge) {
    if (res.success) {
      badge.className = 'ping-result success';
      badge.innerHTML = `<span class="status-dot ok"></span>${res.latency_ms}ms`;
    } else {
      badge.className = 'ping-result error';
      badge.innerHTML = `<span class="status-dot fail"></span>Error`;
    }
  }
}

async function pingAllPipelineModels() {
  const container = document.getElementById('quick-diagnostics-results');
  container.innerHTML = '<span style="color: var(--text-muted);">Running diagnostic pings on all pipeline models...</span>';

  const results = [];
  for (const name of appState.pipeline) {
    const data = appState.catalog[name] || { target_model: name, api_base: '', api_key: '' };
    const ping = await runPing(data.target_model || name, data.api_base, data.api_key);
    results.push({ name, ...ping });
  }

  container.innerHTML = '';
  results.forEach(r => {
    const item = document.createElement('div');
    item.className = 'diag-chip';
    item.innerHTML = `
      <b>${escapeHtml(r.name)}:</b>
      <span class="ping-result ${r.success ? 'success' : 'error'}">
        ${r.success
        ? `<span class="status-dot ok"></span>${r.latency_ms}ms`
        : `<span class="status-dot fail"></span>${r.error || 'Failed'}`}
      </span>
    `;
    container.appendChild(item);
  });
}

async function runPing(model, api_base, api_key) {
  try {
    const res = await fetch('/api/test-provider', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, api_base, api_key })
    });
    return await res.json();
  } catch (err) {
    return { success: false, latency_ms: 0, error: err.message };
  }
}

/* --------------------------------------------------------------------------
   Add / edit model modal
   -------------------------------------------------------------------------- */
function openAddModelModal() {
  document.getElementById('modal-title').textContent = 'Add Custom Model';
  document.getElementById('modal-model-name').value = '';
  document.getElementById('modal-model-name').disabled = false;
  document.getElementById('modal-api-base').value = '';
  renderKeyRows(['']);
  document.getElementById('modal-target-model').value = '';
  document.getElementById('modal-test-result').innerHTML = '';
  document.getElementById('model-modal').classList.add('active');
}

/* ---------------------------------------------------------------------------
   API key rotation group
   A model can hold several keys. They render as an ordered list; the proxy
   tries them in this order before falling through to the next provider.
--------------------------------------------------------------------------- */

function renderKeyRows(keys) {
  const list = document.getElementById('modal-key-list');
  if (!list) return;
  const values = (keys && keys.length) ? keys : [''];
  list.innerHTML = values.map((key, i) => `
    <div class="key-row" data-index="${i}">
      <span class="key-rank" title="Priority ${i + 1}">${i + 1}</span>
      <input type="text" class="form-input modal-key-input" value="${escapeHtml(key)}"
        placeholder="${i === 0 ? 'sk-... or dummy key for local' : 'backup key for the same model'}">
      <button class="icon-btn" type="button" onclick="copyKeyRow(${i})"
        title="Copy this key" aria-label="Copy this key">${ICONS.copy || 'copy'}</button>
      <button class="icon-btn danger" type="button" onclick="removeKeyRow(${i})"
        title="Remove this key" aria-label="Remove this key"
        ${values.length === 1 ? 'disabled' : ''}>&times;</button>
    </div>
  `).join('');
}

function getKeyRows() {
  return Array.from(document.querySelectorAll('.modal-key-input'))
    .map(el => el.value.trim());
}

function addKeyRow() {
  const keys = getKeyRows();
  keys.push('');
  renderKeyRows(keys);
  const inputs = document.querySelectorAll('.modal-key-input');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

function removeKeyRow(index) {
  const keys = getKeyRows();
  if (keys.length <= 1) return;
  keys.splice(index, 1);
  renderKeyRows(keys);
}

async function copyKeyRow(index) {
  const keys = getKeyRows();
  if (!keys[index]) {
    showToast('No API key to copy', 'error');
    return;
  }
  await copyToClipboard(keys[index], null);
}

function openEditModelModal(name) {
  const data = appState.catalog[name];
  if (!data) return;

  document.getElementById('modal-title').textContent = `Edit Model: ${name}`;
  document.getElementById('modal-model-name').value = name;
  document.getElementById('modal-model-name').disabled = true;
  document.getElementById('modal-api-base').value = data.api_base || '';
  renderKeyRows(data.api_keys && data.api_keys.length ? data.api_keys : [data.api_key || '']);
  document.getElementById('modal-target-model').value = data.target_model || name;
  document.getElementById('modal-test-result').innerHTML = '';
  document.getElementById('model-modal').classList.add('active');
}

function closeModelModal() {
  document.getElementById('model-modal').classList.remove('active');
}

async function testModalModel() {
  const resultDiv = document.getElementById('modal-test-result');
  resultDiv.innerHTML = '<span style="color: var(--text-muted);">Testing connection...</span>';

  const model = document.getElementById('modal-target-model').value || document.getElementById('modal-model-name').value;
  const api_base = document.getElementById('modal-api-base').value;
  const api_key = getKeyRows().find(k => k) || '';

  const res = await runPing(model, api_base, api_key);
  if (res.success) {
    resultDiv.innerHTML = `<span style="color: var(--success);">Verified! Latency: ${res.latency_ms}ms (Response: "${escapeHtml(res.response)}")</span>`;
  } else {
    resultDiv.innerHTML = `<span style="color: var(--danger);">Failed: ${escapeHtml(res.error || 'Unknown error')}</span>`;
  }
}

async function saveModalModel() {
  if (saveState.model) return;
  const name = document.getElementById('modal-model-name').value.trim();
  const api_base = document.getElementById('modal-api-base').value.trim();
  const api_keys = getKeyRows().filter(k => k);
  const api_key = api_keys[0] || '';
  const target_model = document.getElementById('modal-target-model').value.trim() || name;

  if (!name || !api_base) {
    showToast('Name and API Base URL are required!', 'error');
    return;
  }

  const saveBtn = document.querySelector('#model-modal .modal-footer button:last-child');
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<span class="btn-spinner"></span> Saving...';
  }
  saveState.model = true;

  try {
    const res = await fetch('/api/config/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model_name: name,
        target_model: target_model,
        api_base: api_base,
        api_key: api_key,
        api_keys: api_keys,
        restart_proxy: true
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to save model');
    }

    showToast(`Saved ${name} and reloaded proxy!`, 'success');
    closeModelModal();
    await loadConfig();
    await fetchStatus();
    loadLogs();
  } catch (err) {
    showToast(`Failed to update ${name}: ${err.message}`, 'error');
  } finally {
    saveState.model = false;
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'Save to Catalog';
    }
  }
}

/* --------------------------------------------------------------------------
   Raw YAML editor
   -------------------------------------------------------------------------- */
async function saveRawYaml() {
  const editor = document.getElementById('raw-yaml-editor');
  const content = editor.value;
  const saveBtn = document.getElementById('btn-save-yaml');

  try {
    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="btn-spinner"></span> Saving...';
    }
    showToast('Validating & saving raw YAML...', 'success');
    const res = await fetch('/api/config/raw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ yaml_content: content, restart_proxy: true })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to save YAML');
    }

    showToast('Configuration updated and proxy restarted!', 'success');
    loadConfig();
    fetchStatus();
    loadLogs();
  } catch (err) {
    showToast(`Error saving YAML: ${err.message}`, 'error');
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = 'Save & Restart Proxy';
    }
  }
}

/* --------------------------------------------------------------------------
   Live logs
   -------------------------------------------------------------------------- */
function setLogFilter(type, btnElement) {
  logFilterType = type;
  document.querySelectorAll('.log-filter-pills .filter-pill').forEach(btn => {
    btn.classList.remove('active');
  });
  if (btnElement) btnElement.classList.add('active');
  loadLogs();
}

function handleLogSearch(query) {
  logSearchQuery = (query || '').toLowerCase().trim();
  loadLogs();
}

function handleLogAutoscrollChange(enabled) {
  logAutoscroll = enabled;
  if (enabled) {
    const container = document.getElementById('log-container');
    if (container) container.scrollTop = container.scrollHeight;
  }
}

function clearLogsView() {
  const container = document.getElementById('log-container');
  if (container) {
    container.innerHTML = '<div class="empty-state">Logs display cleared. New incoming logs will appear here.</div>';
  }
  updateLogStats([]);
}

function classifyLogLevel(line) {
  if (line.includes('[MODEL ACTIVE]')) return 'model-active';
  if (line.includes('[FALLBACK ROUTE]')) return 'fallback-route';
  if (line.includes('ERROR') || line.includes('429') || line.includes('Exception') || line.includes('502')) return 'error';
  if (line.includes('WARNING') || line.includes('Retrying')) return 'warning';
  if (line.includes('200 OK') || line.includes('healthy')) return 'success';
  return '';
}

function updateLogStats(lines) {
  const stats = {
    total: lines.length,
    active: 0,
    fallbacks: 0,
    errors: 0
  };
  lines.forEach(line => {
    if (line.includes('[MODEL ACTIVE]')) stats.active++;
    if (line.includes('[FALLBACK ROUTE]')) stats.fallbacks++;
    if (line.includes('ERROR') || line.includes('429') || line.includes('502') || line.includes('Exception')) stats.errors++;
  });

  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  set('stat-total', stats.total);
  set('stat-model-active', stats.active);
  set('stat-fallbacks', stats.fallbacks);
  set('stat-errors', stats.errors);
}

// Update Live "Last Served" badge in the hero bar from [MODEL ACTIVE] lines
function updateLiveServed(lines) {
  const activeLines = lines.filter(l => l.includes('[MODEL ACTIVE]'));
  if (activeLines.length === 0) return;

  const lastLine = activeLines[activeLines.length - 1];
  const modelMatch = lastLine.match(/Upstream:\s*([^\s@]+)/);
  const timeMatch = lastLine.match(/\[([0-9:]+)\]/);
  const latencyMatch = lastLine.match(/\(([\d.]+)ms/);

  const liveModelEl = document.getElementById('live-served-model');
  const liveMetaEl = document.getElementById('live-served-meta');
  if (liveModelEl && modelMatch) {
    liveModelEl.textContent = modelMatch[1];
  }
  if (liveMetaEl && timeMatch) {
    let meta = `(${timeMatch[1]}`;
    if (latencyMatch) {
      const s = Math.round(parseFloat(latencyMatch[1]) / 100) / 10;
      meta += ` · ${s}s`;
    }
    meta += ')';
    liveMetaEl.textContent = meta;
  }
}

async function loadLogs() {
  try {
    const res = await fetch('/api/logs?lines=80');
    const data = await res.json();
    const container = document.getElementById('log-container');

    if (!data.lines || data.lines.length === 0) {
      container.innerHTML = '<div class="empty-state">No logs recorded yet.</div>';
      updateLogStats([]);
      return;
    }

    updateLiveServed(data.lines);
    updateLogStats(data.lines);

    let linesToDisplay = data.lines;
    if (logFilterType === 'model') {
      linesToDisplay = linesToDisplay.filter(l => l.includes('[MODEL ACTIVE]'));
    } else if (logFilterType === 'warning') {
      linesToDisplay = linesToDisplay.filter(l =>
        l.includes('[FALLBACK ROUTE]') ||
        l.includes('ERROR') ||
        l.includes('429') ||
        l.includes('502') ||
        l.includes('Exception') ||
        l.includes('WARNING')
      );
    }

    if (logSearchQuery) {
      linesToDisplay = linesToDisplay.filter(l => l.toLowerCase().includes(logSearchQuery));
    }

    if (linesToDisplay.length === 0) {
      container.innerHTML = '<div class="empty-state">No logs matching the current filter.</div>';
      return;
    }

    container.innerHTML = '';
    linesToDisplay.forEach(line => {
      const lineDiv = document.createElement('div');
      lineDiv.className = 'log-line';
      const level = classifyLogLevel(line);
      if (level) lineDiv.classList.add(level);
      lineDiv.textContent = line;
      container.appendChild(lineDiv);
    });

    if (logAutoscroll) {
      container.scrollTop = container.scrollHeight;
    }
  } catch (err) {
    console.error('Failed to load logs:', err);
  }
}

/* --------------------------------------------------------------------------
   Helpers
   -------------------------------------------------------------------------- */
function escapeHtml(str) {
  if (!str) return '';
  const map = {
    '&': '&' + 'amp;',
    '<': '&' + 'lt;',
    '>': '&' + 'gt;',
    '"': '&' + 'quot;',
    "'": '&' + '#039;'
  };
  return String(str).replace(/[&<>"']/g, (ch) => map[ch]);
}

function keyCountLabel(data) {
  const n = (data.api_keys || []).length;
  if (n <= 1) return '';
  return ` <span class="key-count" title="${n} keys tried in order before falling back">+${n - 1} backup</span>`;
}

function maskKey(key) {
  if (!key) return '(none)';
  if (key.length <= 8) return '****';
  return key.substring(0, 4) + '...' + key.substring(key.length - 4);
}
