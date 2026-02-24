export function dashboardHTML(roomId: string, baseUrl: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>agent-sync · ${roomId.slice(0, 8)}</title>
<style>
  :root {
    --bg: #0d1117; --fg: #c9d1d9; --dim: #484f58; --border: #21262d;
    --accent: #58a6ff; --green: #3fb950; --yellow: #d29922; --red: #f85149;
    --surface: #161b22; --surface2: #1c2129; --purple: #bc8cff; --orange: #f0883e;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'SF Mono', 'Cascadia Code', 'Fira Code', monospace;
    font-size: 13px; line-height: 1.5;
    background: var(--bg); color: var(--fg);
    padding: 1rem; max-width: 1100px; margin: 0 auto;
  }

  .header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 0.5rem; }
  h1, h1 > a { font-size: 14px; font-weight: 600; color: var(--accent); }
  .room-id > a { color: var(--dim); font-size: 11px; word-break: break-all; }
  .poll-info { color: var(--dim); font-size: 11px; display: flex; align-items: center; gap: 6px; }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--green); }
  .dot.error { background: var(--red); }

  .tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin: 0.75rem 0 0; }
  .tab {
    padding: 0.4rem 0.8rem; font-size: 12px; cursor: pointer;
    color: var(--dim); border-bottom: 2px solid transparent;
    background: none; border-top: none; border-left: none; border-right: none;
    font-family: inherit; transition: color 0.15s;
  }
  .tab:hover { color: var(--fg); }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .tab .badge {
    display: inline-block; background: var(--border); border-radius: 8px;
    padding: 0 5px; font-size: 10px; margin-left: 4px; color: var(--dim);
  }
  .tab.active .badge { background: rgba(88,166,255,0.15); color: var(--accent); }
  .panel { display: none; padding-top: 0.75rem; }
  .panel.active { display: block; }

  /* Agents */
  .agent-grid { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .agent-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 6px; padding: 0.5rem 0.7rem; min-width: 150px; flex: 0 0 auto;
  }
  .agent-card .name { color: var(--accent); font-weight: 600; font-size: 12px; }
  .agent-card .role { color: var(--dim); font-size: 11px; }
  .agent-card .status-badge {
    display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 3px;
    font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;
  }
  .status-active { background: rgba(63,185,80,0.15); color: var(--green); }
  .status-done { background: rgba(88,166,255,0.15); color: var(--accent); }
  .status-waiting { background: rgba(210,153,34,0.15); color: var(--yellow); }
  .agent-card .waiting-on {
    margin-top: 4px; font-size: 10px; color: var(--yellow);
    font-style: italic; word-break: break-all;
  }
  .agent-card .heartbeat { color: var(--dim); font-size: 10px; margin-top: 2px; }
  .agent-card .heartbeat.stale { color: var(--yellow); }
  .agent-card .heartbeat.dead { color: var(--red); }

  /* Messages */
  .msg-list {
    display: flex; flex-direction: column; gap: 1px;
    max-height: 60vh; overflow-y: auto; scroll-behavior: smooth;
  }
  .msg {
    display: grid; grid-template-columns: 100px 1fr auto;
    gap: 0.5rem; padding: 4px 8px; font-size: 12px;
    border-radius: 3px; background: var(--surface);
  }
  .msg:hover { background: var(--surface2); }
  .msg.threaded { margin-left: 24px; border-left: 2px solid var(--border); }
  .msg .from { color: var(--accent); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .msg .body-wrap { color: var(--fg); word-break: break-word; min-width: 0; }
  .msg .kind-tag {
    display: inline-block; background: var(--border); border-radius: 2px;
    padding: 0 4px; font-size: 10px; color: var(--dim); margin-right: 4px; vertical-align: middle;
  }
  .kind-task { background: rgba(210,153,34,0.2); color: var(--yellow); }
  .kind-result { background: rgba(63,185,80,0.2); color: var(--green); }
  .kind-proposal { background: rgba(188,140,255,0.2); color: var(--purple); }
  .kind-vote { background: rgba(88,166,255,0.2); color: var(--accent); }
  .kind-correction, .kind-error { background: rgba(248,81,73,0.2); color: var(--red); }
  .kind-synthesis { background: rgba(240,136,62,0.2); color: var(--orange); }
  .msg .to-badge { color: var(--yellow); font-size: 11px; }
  .msg .claim-badge { font-size: 10px; color: var(--green); margin-left: 4px; }
  .msg .reply-badge { font-size: 10px; color: var(--dim); margin-left: 4px; }
  .msg .meta { color: var(--dim); font-size: 11px; white-space: nowrap; text-align: right; }
  .msg-body-text { white-space: pre-wrap; }

  /* State */
  .scope-group { margin-bottom: 0.75rem; }
  .scope-header {
    display: flex; align-items: center; gap: 6px; cursor: pointer;
    padding: 0.3rem 0.5rem; background: var(--surface); border: 1px solid var(--border);
    border-radius: 4px 4px 0 0; font-size: 12px; user-select: none;
  }
  .scope-header.collapsed { border-radius: 4px; }
  .scope-header .arrow { font-size: 10px; color: var(--dim); transition: transform 0.15s; display: inline-block; }
  .scope-header.collapsed .arrow { transform: rotate(-90deg); }
  .scope-header .scope-name { font-weight: 600; }
  .scope-shared .scope-name { color: var(--yellow); }
  .scope-view .scope-name { color: var(--purple); }
  .scope-agent .scope-name { color: var(--accent); }
  .scope-header .count { color: var(--dim); font-size: 11px; }
  .scope-body {
    border: 1px solid var(--border); border-top: none;
    border-radius: 0 0 4px 4px; overflow: hidden;
  }
  .scope-body.hidden { display: none; }

  .state-row {
    display: grid; grid-template-columns: 150px 1fr 30px;
    gap: 0.5rem; padding: 0.3rem 0.5rem; font-size: 12px;
    border-bottom: 1px solid var(--border); align-items: start;
  }
  .state-row:last-child { border-bottom: none; }
  .state-row .key { color: var(--green); font-weight: 500; word-break: break-word; }
  .state-row .ver { color: var(--dim); text-align: center; font-size: 11px; }
  .state-row .expr { color: var(--purple); font-size: 11px; font-style: italic; }
  .state-row .resolved { color: var(--green); font-size: 11px; }
  .state-row .view-detail { display: flex; flex-direction: column; gap: 2px; }

  /* JSON tree */
  .json-val { cursor: default; }
  .json-str { color: #a5d6ff; }
  .json-num { color: #79c0ff; }
  .json-bool { color: var(--orange); }
  .json-null { color: var(--dim); font-style: italic; }
  .json-key { color: #7ee787; }
  .json-bracket { color: var(--dim); }
  .json-toggle {
    cursor: pointer; user-select: none; display: inline;
  }
  .json-toggle:hover { color: var(--accent); }
  .json-children { padding-left: 16px; }
  .json-children.hidden { display: none; }
  .json-collapsed-hint { color: var(--dim); font-style: italic; font-size: 11px; }
  .json-plain { color: var(--fg); white-space: pre-wrap; word-break: break-word; }

  .flash-row { animation: flashRow 0.6s ease-out; }
  @keyframes flashRow { from { background: rgba(88,166,255,0.12); } to { background: transparent; } }

  /* CEL Console */
  .cel-console {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 6px; padding: 0.75rem; margin-top: 0.5rem;
  }
  .cel-input-row { display: flex; gap: 0.5rem; }
  .cel-input {
    flex: 1; background: var(--bg); border: 1px solid var(--border);
    border-radius: 4px; padding: 0.4rem 0.6rem; color: var(--fg);
    font-family: inherit; font-size: 12px; outline: none;
  }
  .cel-input:focus { border-color: var(--accent); }
  .cel-btn {
    background: var(--accent); color: var(--bg); border: none;
    border-radius: 4px; padding: 0.4rem 0.8rem; cursor: pointer;
    font-family: inherit; font-size: 12px; font-weight: 600;
  }
  .cel-btn:hover { opacity: 0.9; }
  .cel-result {
    margin-top: 0.5rem; padding: 0.5rem;
    background: var(--bg); border-radius: 4px; font-size: 12px;
    white-space: pre-wrap; word-break: break-word; display: none;
    max-height: 300px; overflow-y: auto;
  }
  .cel-result.visible { display: block; }
  .cel-result.error { color: var(--red); }
  .cel-result.success { color: var(--green); }
  .cel-history { margin-top: 0.5rem; display: flex; flex-wrap: wrap; gap: 4px; }
  .cel-history-item {
    background: var(--border); border: none; border-radius: 3px;
    padding: 2px 6px; font-size: 10px; color: var(--dim);
    cursor: pointer; font-family: inherit;
  }
  .cel-history-item:hover { color: var(--accent); }

  .summary-bar {
    display: flex; gap: 1rem; padding: 0.5rem 0; font-size: 12px; color: var(--dim); flex-wrap: wrap;
  }
  .summary-bar .stat { display: flex; align-items: center; gap: 4px; }
  .summary-bar .stat .num { color: var(--fg); font-weight: 600; }
  .summary-bar .stat .label { color: var(--dim); }

  .empty { color: var(--dim); font-style: italic; padding: 1rem; text-align: center; }

  /* Timer & enabled badges */
  .timer-badge {
    display: inline-block; font-size: 9px; padding: 1px 5px; border-radius: 3px;
    background: rgba(210,153,34,0.15); color: var(--yellow); margin-left: 4px;
    font-weight: 500; vertical-align: middle;
  }
  .timer-badge.expired { background: rgba(248,81,73,0.15); color: var(--red); }
  .timer-badge.dormant { background: rgba(188,140,255,0.15); color: var(--purple); }
  .enabled-badge {
    display: inline-block; font-size: 9px; padding: 1px 5px; border-radius: 3px;
    background: rgba(188,140,255,0.15); color: var(--purple); margin-left: 4px;
    font-weight: 500; vertical-align: middle; max-width: 200px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }

  /* Actions */
  .action-list { display: flex; flex-direction: column; gap: 0.5rem; }
  .action-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 6px; padding: 0.6rem 0.8rem;
  }
  .action-card .action-header {
    display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
  }
  .action-card .action-id { color: var(--orange); font-weight: 600; font-size: 13px; }
  .action-card .action-scope {
    font-size: 10px; padding: 1px 5px; border-radius: 3px;
    background: rgba(210,153,34,0.15); color: var(--yellow);
  }
  .action-card .action-scope.shared { background: rgba(210,153,34,0.15); color: var(--yellow); }
  .action-card .action-scope.agent { background: rgba(88,166,255,0.15); color: var(--accent); }
  .action-card .action-meta { font-size: 11px; color: var(--dim); }
  .action-card .action-if { font-size: 11px; color: var(--purple); font-style: italic; margin-top: 2px; }
  .action-card .action-writes { font-size: 11px; color: var(--dim); margin-top: 4px; }
  .action-card .action-write-item { color: var(--green); }
  .action-card .action-params { margin-top: 4px; font-size: 11px; }
  .action-card .action-params .param-name { color: var(--accent); }
  .action-card .action-params .param-type { color: var(--dim); }
  .action-card .action-cooldown { font-size: 10px; color: var(--yellow); margin-top: 2px; }
  .action-avail {
    display: inline-block; font-size: 10px; padding: 1px 5px; border-radius: 3px;
    font-weight: 600;
  }
  .action-avail.yes { background: rgba(63,185,80,0.15); color: var(--green); }
  .action-avail.no { background: rgba(248,81,73,0.15); color: var(--red); }
</style>
</head>
<body>

<div class="header">
  <div>
    <h1><a href="/">agent-sync</a></h1>
    <div class="room-id"><a href="https://sync.parc.land/?room=${roomId}">${roomId}</a></div>
  </div>
  <div class="poll-info">
    <span class="dot" id="pulse"></span>
    <span id="poll-status">connecting…</span>
  </div>
</div>

<div class="summary-bar" id="summary"></div>

<div class="tabs">
  <button class="tab active" data-tab="agents">Agents <span class="badge" id="agent-count">0</span></button>
  <button class="tab" data-tab="messages">Messages <span class="badge" id="msg-count">0</span></button>
  <button class="tab" data-tab="state">State <span class="badge" id="state-count">0</span></button>
  <button class="tab" data-tab="actions">Actions <span class="badge" id="action-count">0</span></button>
  <button class="tab" data-tab="cel">CEL Console</button>
</div>

<div class="panel active" id="panel-agents">
  <div id="agents" class="agent-grid"><div class="empty">no agents</div></div>
</div>

<div class="panel" id="panel-messages">
  <div id="messages" class="msg-list"><div class="empty">no messages</div></div>
</div>

<div class="panel" id="panel-state">
  <div id="state"><div class="empty">no state</div></div>
</div>

<div class="panel" id="panel-actions">
  <div id="actions" class="action-list"><div class="empty">no actions</div></div>
</div>

<div class="panel" id="panel-cel">
  <div class="cel-console">
    <div class="cel-input-row">
      <input class="cel-input" id="cel-input" placeholder="state._shared.phase" spellcheck="false"
        onkeydown="if(event.key==='Enter')runCel()">
      <button class="cel-btn" onclick="runCel()">Eval</button>
    </div>
    <div class="cel-history" id="cel-history"></div>
    <div class="cel-result" id="cel-result"></div>
  </div>
  <div style="margin-top:0.75rem; color: var(--dim); font-size: 11px;">
    <strong>Quick refs:</strong>
    <span style="cursor:pointer;color:var(--accent)" onclick="quickCel('state._shared')">_shared</span> ·
    <span style="cursor:pointer;color:var(--purple)" onclick="quickCel('state._view')">_view</span> ·
    <span style="cursor:pointer;color:var(--accent)" onclick="quickCel('agents')">agents</span> ·
    <span style="cursor:pointer;color:var(--accent)" onclick="quickCel('messages')">messages</span> ·
    <span style="cursor:pointer;color:var(--orange)" onclick="quickCel('actions')">actions</span> ·
    <span style="cursor:pointer;color:var(--accent)" onclick="quickCel('state')">all state</span>
  </div>
</div>

<script>
const BASE = "${baseUrl}";
const ROOM = "${roomId}";
const POLL_MS = 2000;
let msgCursor = 0;
let allMessages = [];
let agentMap = {};
let prevStateVersions = {};
let celHistory = [];

// ── Persistent UI state (survives re-renders) ──
const collapsedScopes = new Set();    // tracks which scopes user collapsed
const expandedValues = new Set();      // tracks which state values user expanded
let scopeInitialized = false;          // first render sets defaults

// ── Tabs ──
document.querySelectorAll('.tab').forEach(t => {
  t.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    document.getElementById('panel-' + t.dataset.tab).classList.add('active');
  });
});

// ── Utils ──
async function api(path) {
  const r = await fetch(BASE + path);
  if (!r.ok) return null;
  return r.json();
}

function esc(s) {
  if (s == null) return '';
  const d = document.createElement('div');
  d.textContent = String(s);
  return d.innerHTML;
}

function agentName(id) {
  if (!id) return 'system';
  const a = agentMap[id];
  return a ? a.name : (id.length > 12 ? id.slice(0, 8) + '…' : id);
}

// Relative time: "2m ago", "1h ago", "3d ago"
function relTime(ts) {
  if (!ts) return '';
  // Handle both "YYYY-MM-DD HH:MM:SS" (sqlite) and ISO formats
  const d = new Date(ts.replace(' ', 'T') + (ts.includes('Z') || ts.includes('+') ? '' : 'Z'));
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 0) return 'just now';
  if (secs < 5) return 'just now';
  if (secs < 60) return secs + 's ago';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  return days + 'd ago';
}

// Heartbeat staleness class
function heartbeatClass(ts) {
  if (!ts) return 'dead';
  const d = new Date(ts.replace(' ', 'T') + (ts.includes('Z') || ts.includes('+') ? '' : 'Z'));
  const mins = (Date.now() - d.getTime()) / 60000;
  if (mins < 2) return '';
  if (mins < 10) return 'stale';
  return 'dead';
}

function fmtTime(ts) {
  if (!ts) return '';
  return ts.split(' ')[1] || ts.slice(11, 19) || ts;
}

function kindClass(kind) {
  const map = { task: 'kind-task', result: 'kind-result', proposal: 'kind-proposal',
    vote: 'kind-vote', correction: 'kind-correction', error: 'kind-error', synthesis: 'kind-synthesis' };
  return map[kind] || '';
}

function timerBadge(item) {
  if (!item.timer_json && !item.timer_expires_at && !item.timer_ticks_left) return '';
  const parts = [];
  if (item.timer_effect) parts.push(item.timer_effect);
  if (item.timer_expires_at) {
    const exp = new Date(item.timer_expires_at);
    const now = Date.now();
    if (exp.getTime() < now) {
      parts.push('expired');
      return '<span class="timer-badge expired" title="' + esc(item.timer_expires_at) + '">' + parts.join(' ') + '</span>';
    }
    const secsLeft = Math.round((exp.getTime() - now) / 1000);
    parts.push(secsLeft + 's left');
  }
  if (item.timer_ticks_left != null) {
    parts.push(item.timer_ticks_left + ' ticks');
    if (item.timer_tick_on) parts.push('on ' + item.timer_tick_on);
  }
  if (parts.length === 0 && item.timer_json) {
    try { const t = JSON.parse(item.timer_json); parts.push(JSON.stringify(t)); } catch {}
  }
  const cls = item.timer_effect === 'enable' ? 'dormant' : '';
  return '<span class="timer-badge ' + cls + '" title="' + esc(item.timer_json || '') + '">' + esc(parts.join(' | ')) + '</span>';
}

function enabledBadge(item) {
  if (!item.enabled_expr) return '';
  return '<span class="enabled-badge" title="' + esc(item.enabled_expr) + '">if: ' + esc(item.enabled_expr) + '</span>';
}

// ── JSON Tree Renderer ──
// Renders JSON values as interactive, collapsible, syntax-highlighted trees
function tryParse(s) {
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return undefined; }
}

function renderJsonValue(val, depth, path) {
  if (val === null) return '<span class="json-null">null</span>';
  if (val === undefined) return '<span class="json-null">undefined</span>';
  if (typeof val === 'boolean') return '<span class="json-bool">' + val + '</span>';
  if (typeof val === 'number') return '<span class="json-num">' + val + '</span>';
  if (typeof val === 'string') {
    // Check if it's a string that contains JSON
    if (depth < 3 && (val.startsWith('{') || val.startsWith('['))) {
      const inner = tryParse(val);
      if (inner !== undefined && typeof inner === 'object') {
        return renderJsonValue(inner, depth, path);
      }
    }
    const escaped = esc(val);
    if (val.length > 120) {
      return '<span class="json-str">"' + escaped.slice(0, 120) + '…"</span>';
    }
    return '<span class="json-str">"' + escaped + '"</span>';
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return '<span class="json-bracket">[]</span>';
    const id = 'jt-' + path;
    const isOpen = expandedValues.has(id);
    let html = '<span class="json-toggle" onclick="toggleJson(\\''+id+'\\')">';
    html += '<span class="json-bracket">[</span>';
    if (!isOpen) html += '<span class="json-collapsed-hint"> ' + val.length + ' items… </span><span class="json-bracket">]</span>';
    html += '</span>';
    if (isOpen) {
      html += '<div class="json-children">';
      val.forEach((v, i) => {
        html += '<div>' + renderJsonValue(v, depth+1, path+'.'+i);
        if (i < val.length - 1) html += ',';
        html += '</div>';
      });
      html += '</div><span class="json-bracket">]</span>';
    }
    return html;
  }
  if (typeof val === 'object') {
    const keys = Object.keys(val);
    if (keys.length === 0) return '<span class="json-bracket">{}</span>';
    const id = 'jt-' + path;
    // Auto-expand small objects (<=3 keys) at depth 0
    const defaultOpen = depth === 0 && keys.length <= 4;
    const isOpen = expandedValues.has(id) || (defaultOpen && !expandedValues.has(id + ':closed'));
    let html = '<span class="json-toggle" onclick="toggleJson(\\''+id+'\\','+defaultOpen+')">';
    html += '<span class="json-bracket">{</span>';
    if (!isOpen) {
      const preview = keys.slice(0, 3).map(k => esc(k)).join(', ');
      html += '<span class="json-collapsed-hint"> ' + (keys.length > 3 ? preview + '… +' + (keys.length-3) : preview) + ' </span><span class="json-bracket">}</span>';
    }
    html += '</span>';
    if (isOpen) {
      html += '<div class="json-children">';
      keys.forEach((k, i) => {
        html += '<div><span class="json-key">' + esc(k) + '</span>: ' + renderJsonValue(val[k], depth+1, path+'.'+k);
        if (i < keys.length - 1) html += ',';
        html += '</div>';
      });
      html += '</div><span class="json-bracket">}</span>';
    }
    return html;
  }
  return '<span class="json-plain">' + esc(String(val)) + '</span>';
}

function renderStateValue(rawValue, scopeKey) {
  const parsed = tryParse(rawValue);
  if (parsed !== undefined && typeof parsed === 'object' && parsed !== null) {
    return '<div class="json-val">' + renderJsonValue(parsed, 0, scopeKey) + '</div>';
  }
  // Plain string or primitive
  return '<div class="json-val"><span class="json-plain">' + esc(rawValue) + '</span></div>';
}

window.toggleJson = function(id, defaultOpen) {
  if (defaultOpen) {
    // For default-open nodes, toggling means closing
    if (expandedValues.has(id + ':closed')) {
      expandedValues.delete(id + ':closed');
    } else {
      expandedValues.add(id + ':closed');
    }
    expandedValues.delete(id);
  } else {
    if (expandedValues.has(id)) {
      expandedValues.delete(id);
    } else {
      expandedValues.add(id);
    }
  }
  // Re-render state (uses preserved collapse state)
  if (lastStates) renderState(lastStates);
};

// ── Agents ──
function renderAgents(agents) {
  const el = document.getElementById('agents');
  const countEl = document.getElementById('agent-count');
  if (!agents || agents.length === 0) { el.innerHTML = '<div class="empty">no agents</div>'; countEl.textContent = '0'; return; }
  agentMap = {};
  agents.forEach(a => agentMap[a.id] = a);
  countEl.textContent = agents.length;

  el.innerHTML = agents.map(a => {
    const statusCls = 'status-' + (a.status || 'active');
    const hbClass = heartbeatClass(a.last_heartbeat);
    const hbText = relTime(a.last_heartbeat);
    return '<div class="agent-card">' +
      '<div><span class="status-badge ' + statusCls + '">' + esc(a.status || 'active') + '</span></div>' +
      '<div class="name">' + esc(a.name) + '</div>' +
      '<div class="role">' + esc(a.role) + '</div>' +
      (a.waiting_on ? '<div class="waiting-on">⏳ ' + esc(a.waiting_on) + '</div>' : '') +
      '<div class="heartbeat ' + hbClass + '" title="' + esc(a.last_heartbeat || '') + '">' + esc(hbText) + '</div>' +
    '</div>';
  }).join('');
}

// ── Messages ──
function renderMessages() {
  const el = document.getElementById('messages');
  const countEl = document.getElementById('msg-count');
  countEl.textContent = allMessages.length;
  if (allMessages.length === 0) { el.innerHTML = '<div class="empty">no messages</div>'; return; }

  const wasAtBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 30;

  el.innerHTML = allMessages.map(m => {
    const isThread = m.reply_to != null;
    let bodyText = m.body || '';
    // Try to pretty-print JSON bodies inline (truncated)
    try {
      const parsed = JSON.parse(bodyText);
      if (typeof parsed === 'object') bodyText = JSON.stringify(parsed, null, 2);
    } catch {}
    const truncBody = bodyText.length > 500 ? bodyText.slice(0, 500) + '…' : bodyText;
    const kc = kindClass(m.kind);

    return '<div class="msg' + (isThread ? ' threaded' : '') + (m._new ? ' flash-row' : '') + '">' +
      '<div class="from" title="' + esc(m.from_agent || '') + '">' + esc(agentName(m.from_agent)) + '</div>' +
      '<div class="body-wrap">' +
        '<span class="kind-tag ' + kc + '">' + esc(m.kind || 'msg') + '</span>' +
        (m.to_agent ? '<span class="to-badge">→' + esc(agentName(m.to_agent)) + '</span> ' : '') +
        (isThread ? '<span class="reply-badge">↩' + m.reply_to + '</span> ' : '') +
        (m.claimed_by ? '<span class="claim-badge">✓ ' + esc(agentName(m.claimed_by)) + '</span> ' : '') +
        timerBadge(m) +
        '<span class="msg-body-text">' + esc(truncBody) + '</span>' +
      '</div>' +
      '<div class="meta">#' + m.id + ' · ' + esc(relTime(m.created_at)) + '</div>' +
    '</div>';
  }).join('');

  if (wasAtBottom) el.scrollTop = el.scrollHeight;
}

// ── State ──
let lastStates = null;

function renderState(states) {
  const el = document.getElementById('state');
  const countEl = document.getElementById('state-count');
  if (!states || states.length === 0) { el.innerHTML = '<div class="empty">no state</div>'; countEl.textContent = '0'; return; }
  countEl.textContent = states.length;
  lastStates = states;

  // Group by scope
  const scopes = {};
  for (const s of states) {
    if (!scopes[s.scope]) scopes[s.scope] = [];
    scopes[s.scope].push(s);
  }

  const order = Object.keys(scopes).sort((a, b) => {
    if (a === '_shared') return -1; if (b === '_shared') return 1;
    if (a === '_view') return -1; if (b === '_view') return 1;
    return a.localeCompare(b);
  });

  // Initialize default collapse state on first render
  if (!scopeInitialized) {
    for (const scope of order) {
      const isAgent = scope !== '_shared' && scope !== '_view';
      if (isAgent) collapsedScopes.add(scope);
    }
    scopeInitialized = true;
  }

  let html = '';
  for (const scope of order) {
    const entries = scopes[scope];
    const scopeType = scope === '_shared' ? 'shared' : scope === '_view' ? 'view' : 'agent';
    const isCollapsed = collapsedScopes.has(scope);

    html += '<div class="scope-group">';
    html += '<div class="scope-header scope-' + scopeType + (isCollapsed ? ' collapsed' : '') + '" onclick="toggleScope(\\'' + esc(scope) + '\\')">';
    html += '<span class="arrow">▼</span> ';
    html += '<span class="scope-name">' + esc(scope) + '</span> ';
    html += '<span class="count">(' + entries.length + ' keys)</span>';
    html += '</div>';
    html += '<div class="scope-body' + (isCollapsed ? ' hidden' : '') + '">';

    for (const s of entries) {
      const vKey = scope + '.' + s.key;
      const changed = prevStateVersions[vKey] !== undefined && prevStateVersions[vKey] !== s.version;

      // Computed view
      let viewExpr = null;
      let resolvedVal = null;
      if (scope === '_view') {
        try {
          const parsed = typeof s.value === 'object' ? s.value : JSON.parse(s.value);
          if (parsed && parsed.computed && parsed.expr) {
            viewExpr = parsed.expr;
            resolvedVal = s.resolved_value;
          } else if (parsed && parsed._cel_expr) {
            viewExpr = parsed._cel_expr;
            resolvedVal = s.resolved_value;
          }
        } catch {}
      }

      html += '<div class="state-row' + (changed ? ' flash-row' : '') + '">';
      html += '<div class="key">' + esc(s.key) + timerBadge(s) + enabledBadge(s) + '</div>';

      if (viewExpr) {
        html += '<div class="view-detail">';
        html += '<div class="expr">expr: ' + esc(viewExpr) + '</div>';
        const resolvedDisplay = resolvedVal != null ? renderJsonValue(resolvedVal, 0, vKey + '.resolved') : '<span class="json-null">null</span>';
        html += '<div class="resolved">→ ' + resolvedDisplay + '</div>';
        html += '</div>';
      } else {
        html += renderStateValue(s.value, vKey);
      }

      html += '<div class="ver">v' + s.version + '</div>';
      html += '</div>';
      prevStateVersions[vKey] = s.version;
    }

    html += '</div></div>';
  }
  el.innerHTML = html;
}

window.toggleScope = function(scope) {
  if (collapsedScopes.has(scope)) {
    collapsedScopes.delete(scope);
  } else {
    collapsedScopes.add(scope);
  }
  if (lastStates) renderState(lastStates);
};

// ── Actions ──
let lastActions = [];
function renderActions(actions) {
  const el = document.getElementById('actions');
  const countEl = document.getElementById('action-count');
  if (!actions || actions.length === 0) { el.innerHTML = '<div class="empty">no actions</div>'; countEl.textContent = '0'; return; }
  countEl.textContent = actions.length;
  lastActions = actions;

  el.innerHTML = actions.map(a => {
    const scopeCls = a.scope === '_shared' ? 'shared' : 'agent';
    let html = '<div class="action-card">';
    html += '<div class="action-header">';
    html += '<span class="action-id">' + esc(a.id) + '</span>';
    html += '<span class="action-scope ' + scopeCls + '">' + esc(a.scope) + '</span>';
    html += '<span class="action-avail ' + (a.available !== false ? 'yes' : 'no') + '">' + (a.available !== false ? 'available' : 'unavailable') + '</span>';
    html += '</div>';
    if (a.registered_by) html += '<div class="action-meta">by ' + esc(agentName(a.registered_by)) + ' · v' + (a.version || 1) + ' · ' + esc(relTime(a.created_at)) + '</div>';
    if (a.if) html += '<div class="action-if">if: ' + esc(a.if) + '</div>';
    if (a.enabled_expr) html += '<div class="action-if">enabled: ' + esc(a.enabled_expr) + '</div>';

    // Params
    if (a.params && Object.keys(a.params).length > 0) {
      html += '<div class="action-params">';
      for (const [name, schema] of Object.entries(a.params)) {
        html += '<span class="param-name">' + esc(name) + '</span>';
        html += '<span class="param-type">: ' + esc(schema.type || 'any');
        if (schema.enum) html += ' [' + schema.enum.map(e => esc(e)).join(', ') + ']';
        html += '</span> ';
      }
      html += '</div>';
    }

    // Writes
    if (a.writes && a.writes.length > 0) {
      html += '<div class="action-writes">writes: ';
      html += a.writes.map(w => '<span class="action-write-item">' + esc((w.scope || '_shared') + '.' + w.key) + '</span>').join(', ');
      html += '</div>';
    }

    // Cooldown / on_invoke timer
    if (a.on_invoke && a.on_invoke.timer) {
      const t = a.on_invoke.timer;
      html += '<div class="action-cooldown">cooldown: ' + (t.ms ? t.ms + 'ms' : JSON.stringify(t)) + '</div>';
    }

    // Timer on action itself
    if (a.timer_json || a.timer_expires_at || a.timer_ticks_left) {
      html += '<div class="action-cooldown">' + timerBadge(a) + '</div>';
    }

    html += '</div>';
    return html;
  }).join('');
}

// ── CEL Console ──
async function runCel(expr) {
  const input = document.getElementById('cel-input');
  const resultEl = document.getElementById('cel-result');
  const expression = expr || input.value.trim();
  if (!expression) return;

  input.value = expression;
  resultEl.className = 'cel-result visible';
  resultEl.textContent = 'evaluating…';
  resultEl.style.color = 'var(--dim)';

  try {
    const r = await fetch(BASE + '/rooms/' + ROOM + '/eval', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expr: expression })
    });
    const data = await r.json();

    if (data.error) {
      resultEl.className = 'cel-result visible error';
      resultEl.textContent = data.detail || data.error;
    } else {
      resultEl.className = 'cel-result visible success';
      resultEl.textContent = JSON.stringify(data.value, null, 2);
    }

    if (!celHistory.includes(expression)) {
      celHistory.unshift(expression);
      if (celHistory.length > 12) celHistory.pop();
      renderCelHistory();
    }
  } catch (e) {
    resultEl.className = 'cel-result visible error';
    resultEl.textContent = 'fetch error: ' + e.message;
  }
}

window.quickCel = function(expr) {
  document.getElementById('cel-input').value = expr;
  runCel(expr);
};
window.runCel = runCel;

function renderCelHistory() {
  const el = document.getElementById('cel-history');
  el.innerHTML = celHistory.map(h => {
    const label = h.length > 40 ? h.slice(0, 40) + '…' : h;
    return '<button class="cel-history-item" title="' + esc(h) + '" onclick="quickCel(this.title)">' + esc(label) + '</button>';
  }).join('');
}

// ── Summary ──
function renderSummary(agents, messages, states, actions) {
  const el = document.getElementById('summary');
  const active = (agents || []).filter(a => a.status === 'active').length;
  const waiting = (agents || []).filter(a => a.status === 'waiting').length;
  const done = (agents || []).filter(a => a.status === 'done').length;
  const claimed = (messages || []).filter(m => m.claimed_by).length;
  const scopeCount = new Set((states || []).map(s => s.scope)).size;
  const views = (states || []).filter(s => s.scope === '_view').length;
  const timedState = (states || []).filter(s => s.timer_json || s.timer_expires_at).length;
  const actionCount = (actions || []).length;

  el.innerHTML =
    '<div class="stat"><span class="num">' + (agents||[]).length + '</span><span class="label">agents</span></div>' +
    (active ? '<div class="stat" style="color:var(--green)"><span class="num">' + active + '</span><span class="label">active</span></div>' : '') +
    (waiting ? '<div class="stat" style="color:var(--yellow)"><span class="num">' + waiting + '</span><span class="label">waiting</span></div>' : '') +
    (done ? '<div class="stat" style="color:var(--accent)"><span class="num">' + done + '</span><span class="label">done</span></div>' : '') +
    '<div class="stat"><span class="num">' + (messages||[]).length + '</span><span class="label">msgs</span></div>' +
    (claimed ? '<div class="stat"><span class="num">' + claimed + '</span><span class="label">claimed</span></div>' : '') +
    '<div class="stat"><span class="num">' + scopeCount + '</span><span class="label">scopes</span></div>' +
    (views ? '<div class="stat" style="color:var(--purple)"><span class="num">' + views + '</span><span class="label">views</span></div>' : '') +
    (actionCount ? '<div class="stat" style="color:var(--orange)"><span class="num">' + actionCount + '</span><span class="label">actions</span></div>' : '') +
    (timedState ? '<div class="stat" style="color:var(--yellow)"><span class="num">' + timedState + '</span><span class="label">timed</span></div>' : '');
}

// ── Polling ──
async function poll() {
  const pulse = document.getElementById('pulse');
  const status = document.getElementById('poll-status');
  try {
    const [agents, msgs, state, actions] = await Promise.all([
      api('/rooms/' + ROOM + '/agents'),
      api('/rooms/' + ROOM + '/messages?after=' + msgCursor + '&limit=200'),
      api('/rooms/' + ROOM + '/state?resolve=true'),
      api('/rooms/' + ROOM + '/actions'),
    ]);

    renderAgents(agents);

    if (msgs && msgs.length > 0) {
      msgs.forEach(m => m._new = true);
      allMessages = allMessages.concat(msgs);
      msgCursor = msgs[msgs.length - 1].id;
      renderMessages();
      setTimeout(() => { msgs.forEach(m => m._new = false); }, 700);
    }

    if (state) renderState(state);
    renderActions(actions);
    renderSummary(agents, allMessages, state, actions);

    pulse.className = 'dot';
    status.textContent = 'live · ' + allMessages.length + ' msgs';
  } catch (e) {
    pulse.className = 'dot error';
    status.textContent = 'error';
    console.error(e);
  }
}

async function init() {
  const msgs = await api('/rooms/' + ROOM + '/messages?limit=500');
  if (msgs && msgs.length > 0) {
    allMessages = msgs;
    msgCursor = msgs[msgs.length - 1].id;
  }
  renderMessages();
  poll();
  setInterval(poll, POLL_MS);
}

init();
</script>
</body>
</html>`;
}