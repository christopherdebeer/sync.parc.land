/**
 * dashboard-v8.ts — Substrate Surfaces dashboard.
 *
 * Self-contained HTML + vanilla JS. No React, no hydration.
 * Implements the substrate-surfaces vision:
 *   - Surfaces: views with render hints as observation-mode-composable cards
 *   - Semantic type inference: quantity, narrative, catalogue, record, status
 *   - Temporal depth: sparklines from /history endpoint
 *   - Provenance: last writer derived from audit trail
 *   - Observation modes: value (default) + trace + lens + provenance (expandable)
 *   - Debug tabs below for full substrate inspection
 */

export function renderDashboardV8(roomId: string): Response {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${roomId} — sync v8</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<script src="https://cdn.jsdelivr.net/npm/eruda"></script>
<script>if(typeof eruda!=='undefined')eruda.init();</script>
<style>
  :root {
    --bg: #0d1117; --fg: #c9d1d9; --dim: #484f58;
    --accent: #58a6ff; --border: #21262d; --surface: #161b22;
    --green: #3fb950; --yellow: #d29922; --red: #f85149;
    --purple: #bc8cff; --orange: #f0883e;
    color-scheme: dark;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: "SF Mono","Fira Code",monospace; font-size: 13px; line-height: 1.5; background: var(--bg); color: var(--fg); max-width: 960px; margin: 0 auto; padding: 1rem; }
  a { color: var(--accent); text-decoration: none; } a:hover { text-decoration: underline; }
  h1 { font-size: 15px; font-weight: 600; color: var(--accent); margin-bottom: 0.25rem; }
  h3 { font-size: 12px; font-weight: 600; color: var(--dim); margin: 0.75rem 0 0.25rem; }
  .sub { color: var(--dim); font-size: 11px; }
  .status { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 4px; }
  .status.live { background: var(--green); } .status.error { background: var(--red); } .status.connecting { background: var(--yellow); }
  .gate { text-align: center; padding: 20vh 1rem; }
  .gate input { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 0.5rem 0.75rem; color: var(--fg); font-family: inherit; font-size: 13px; width: 100%; max-width: 22rem; text-align: center; outline: none; }
  .gate input:focus { border-color: var(--accent); }
  .gate .err { color: var(--red); font-size: 12px; margin-top: 0.5rem; }
  .summary { display: flex; gap: 1rem; flex-wrap: wrap; font-size: 12px; color: var(--dim); margin: 0.5rem 0; }
  .summary b { color: var(--fg); }
  #header-row { display: flex; justify-content: space-between; align-items: baseline; }
  #poll-info { font-size: 11px; color: var(--dim); }
  .id-bar { display: flex; align-items: center; gap: 0.5rem; padding: 0.35rem 0.6rem; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; margin: 0.5rem 0; font-size: 12px; flex-wrap: wrap; }
  .id-bar select { background: var(--bg); border: 1px solid var(--border); border-radius: 4px; color: var(--fg); font-family: inherit; font-size: 12px; padding: 2px 6px; outline: none; }

  /* ── Surfaces ── */
  .surfaces { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0.75rem; margin: 0.75rem 0; }
  .surface-card { background: var(--surface); border: 1px solid var(--border); border-radius: 8px; padding: 0.75rem 1rem; position: relative; }
  .surface-card .s-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--dim); margin-bottom: 0.25rem; }
  .surface-card .s-value { font-size: 20px; font-weight: 700; color: var(--fg); line-height: 1.2; }
  .surface-card .s-value.green { color: var(--green); } .surface-card .s-value.red { color: var(--red); } .surface-card .s-value.yellow { color: var(--yellow); }
  .surface-card .s-unit { font-size: 11px; color: var(--dim); font-weight: 400; margin-left: 4px; }
  .surface-card .s-narrative { font-size: 12px; color: var(--fg); line-height: 1.6; max-height: 8rem; overflow-y: auto; }
  .surface-card .s-narrative h1,.surface-card .s-narrative h2,.surface-card .s-narrative h3 { font-size: 13px; color: var(--accent); margin: 0.5rem 0 0.25rem; }
  .surface-card .s-narrative p { margin: 0.25rem 0; }
  .surface-card .s-narrative code { background: var(--bg); padding: 1px 4px; border-radius: 3px; font-size: 11px; }
  .surface-card .s-record { font-size: 12px; }
  .surface-card .s-record dt { color: var(--dim); float: left; width: 40%; }
  .surface-card .s-record dd { color: var(--fg); margin-left: 42%; margin-bottom: 2px; }
  .surface-card .s-catalogue { font-size: 11px; width: 100%; }
  .surface-card .s-catalogue th { font-size: 10px; }
  .surface-card .s-error { color: var(--red); font-size: 11px; }
  .surface-card .s-status { font-size: 16px; font-weight: 600; }

  /* Sparkline */
  .sparkline { display: block; margin-top: 4px; opacity: 0.6; }
  .sparkline-delta { font-size: 10px; color: var(--dim); margin-top: 2px; }
  .sparkline-delta.up { color: var(--green); } .sparkline-delta.down { color: var(--red); }

  /* Observation modes */
  .s-modes { display: flex; gap: 0.5rem; margin-top: 0.5rem; font-size: 10px; border-top: 1px solid var(--border); padding-top: 0.4rem; }
  .s-mode-btn { color: var(--dim); cursor: pointer; border: none; background: none; font-family: inherit; font-size: 10px; padding: 1px 4px; border-radius: 3px; }
  .s-mode-btn:hover { color: var(--fg); background: rgba(88,166,255,0.08); }
  .s-mode-btn.active { color: var(--accent); background: rgba(88,166,255,0.12); }
  .s-mode-panel { margin-top: 0.5rem; padding-top: 0.4rem; border-top: 1px solid var(--border); font-size: 11px; }
  .s-mode-panel .lens-expr { color: var(--accent); font-size: 11px; word-break: break-all; }
  .s-mode-panel .lens-deps { margin-top: 4px; }
  .s-mode-panel .lens-dep { display: inline-block; padding: 1px 5px; background: rgba(188,140,255,0.1); color: var(--purple); border-radius: 3px; margin: 1px 2px; font-size: 10px; }
  .s-mode-panel .prov-row { display: flex; justify-content: space-between; padding: 2px 0; }
  .s-mode-panel .prov-agent { color: var(--orange); }
  .s-mode-panel .prov-bar { display: inline-block; height: 6px; background: var(--accent); border-radius: 2px; opacity: 0.6; }

  /* ── Debug tabs ── */
  .debug-toggle { display: flex; align-items: center; gap: 6px; width: 100%; padding: 0.5rem 0; border: none; border-top: 1px solid var(--border); background: none; color: var(--dim); font-family: inherit; font-size: 11px; cursor: pointer; margin-top: 0.5rem; }
  .debug-toggle:hover { color: var(--fg); }
  .tabs { display: flex; border-bottom: 1px solid var(--border); overflow-x: auto; }
  .tab { padding: 0.35rem 0.6rem; font-size: 12px; cursor: pointer; border: none; background: none; color: var(--dim); font-family: inherit; border-bottom: 2px solid transparent; white-space: nowrap; }
  .tab:hover { color: var(--fg); } .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .tab .badge { background: var(--border); border-radius: 8px; padding: 0 5px; font-size: 10px; margin-left: 3px; }
  .tab.active .badge { background: rgba(88,166,255,0.15); color: var(--accent); }
  .panel { display: none; padding: 0.5rem 0; } .panel.active { display: block; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; color: var(--dim); font-weight: 600; padding: 0.3rem 0.5rem; border-bottom: 1px solid var(--border); }
  td { padding: 0.3rem 0.5rem; border-bottom: 1px solid var(--border); vertical-align: top; max-width: 400px; overflow: hidden; text-overflow: ellipsis; }
  td.key { color: var(--accent); white-space: nowrap; } td.scope { color: var(--purple); white-space: nowrap; font-size: 11px; }
  td.val { word-break: break-word; white-space: pre-wrap; font-size: 11px; color: var(--dim); max-height: 4rem; overflow-y: auto; }
  td.agent { color: var(--orange); }
  .tag { display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 10px; }
  .tag.green { background: rgba(63,185,80,0.15); color: var(--green); } .tag.yellow { background: rgba(210,153,34,0.15); color: var(--yellow); }
  .tag.red { background: rgba(248,81,73,0.15); color: var(--red); } .tag.purple { background: rgba(188,140,255,0.15); color: var(--purple); }
  .tag.blue { background: rgba(88,166,255,0.15); color: var(--accent); }
  .salience-bar { display: inline-block; height: 8px; background: var(--accent); border-radius: 2px; opacity: 0.7; }
  .msg { padding: 0.4rem 0; border-bottom: 1px solid var(--border); }
  .msg .from { color: var(--orange); font-weight: 600; } .msg .kind { color: var(--dim); font-size: 10px; } .msg .body { margin-top: 2px; } .msg .to { color: var(--purple); font-size: 11px; }
</style>
</head>
<body>
<div id="app"></div>
<script>
const ROOM = ${JSON.stringify(roomId)};
const BASE = location.origin;
const POLL_MS = 2500;
let token = null, pollTimer = null, data = null, salienceData = null, viewAsAgent = '';
let historyCache = {};  // viewId → [{value,ts}]
let expandedModes = {}; // cardId → Set of active modes
let debugOpen = false;
let activeTab = 'state';

// ── Helpers ──
function esc(s) { const d = document.createElement('div'); d.textContent = String(s ?? ''); return d.innerHTML; }
function fmtVal(v) {
  if (v === null || v === undefined) return '<span class="sub">null</span>';
  if (typeof v === 'object') return esc(JSON.stringify(v, null, 1));
  return esc(String(v));
}
function tokenKind() { if (!token) return null; if (token.startsWith('room_') || token.startsWith('tok_')) return 'room'; if (token.startsWith('view_')) return 'view'; return 'agent'; }

// ── Semantic type inference ──
function inferSemantic(value, hint) {
  if (hint?.as) return hint.as;
  if (hint?.type === 'metric') return 'quantity';
  if (hint?.type === 'markdown') return 'narrative';
  if (hint?.type === 'array-table') return 'catalogue';
  if (hint?.type) return hint.type;
  if (value === null || value === undefined) return 'empty';
  if (typeof value === 'number' || typeof value === 'bigint') return 'quantity';
  if (typeof value === 'boolean') return 'status';
  if (typeof value === 'string') {
    if (value.length > 120 || value.includes('\\n') || /^#+\\s/.test(value)) return 'narrative';
    return 'status';
  }
  if (Array.isArray(value)) {
    if (value.length > 0 && typeof value[0] === 'object') return 'catalogue';
    return 'enumeration';
  }
  if (typeof value === 'object') return 'record';
  return 'unknown';
}

// ── Sparkline SVG ──
function sparklineSvg(values, w, h) {
  if (!values || values.length < 2) return '';
  const nums = values.map(v => typeof v === 'number' ? v : parseFloat(v)).filter(n => !isNaN(n));
  if (nums.length < 2) return '';
  const mn = Math.min(...nums), mx = Math.max(...nums);
  const range = mx - mn || 1;
  const points = nums.map((v, i) => {
    const x = (i / (nums.length - 1)) * w;
    const y = h - ((v - mn) / range) * (h - 2) - 1;
    return x.toFixed(1) + ',' + y.toFixed(1);
  }).join(' ');
  return '<svg class="sparkline" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '"><polyline fill="none" stroke="var(--accent)" stroke-width="1.5" points="' + points + '"/></svg>';
}

// ── History fetch — extract values from audit entries ──
async function fetchHistory(scope, key, viewId) {
  const cacheKey = viewId || (scope + '.' + key);
  if (historyCache[cacheKey]) return historyCache[cacheKey];
  try {
    const r = await fetch(BASE + '/rooms/' + ROOM + '/history/' + encodeURIComponent(scope) + '/' + encodeURIComponent(key) + '?limit=50', { headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok) return [];
    const d = await r.json();
    const raw = d.entries || [];
    // Extract the value for this specific key from each audit entry's writes
    const values = [];
    for (const e of raw) {
      const entry = e.entry || e;
      const ts = entry.ts || '';
      const agent = entry.agent || '';
      // For invoke entries, find the write that matches our scope+key
      if (entry.effect && entry.effect.writes) {
        for (const w of entry.effect.writes) {
          if (w.scope === scope && w.key === key && w.value !== undefined) {
            values.push({ value: w.value, ts, agent, seq: e.seq });
          }
        }
      }
      // For register entries (schema.writes contains templates with the key)
      if (entry.kind === 'register_action' && entry.schema?.writes) {
        for (const w of entry.schema.writes) {
          if (w.scope === scope && w.key === key) {
            values.push({ value: null, ts, agent, seq: e.seq, kind: 'register' });
          }
        }
      }
    }
    historyCache[cacheKey] = values;
    return values;
  } catch { return []; }
}

// ── Provenance from audit ──
function buildProvenance(viewDeps) {
  if (!data || !viewDeps || !viewDeps.length) return [];
  const audit = data.audit || [];
  const agentCounts = {};
  const actionCounts = {};
  for (const a of audit) {
    const v = typeof a.value === 'string' ? JSON.parse(a.value) : a.value;
    if (!v.effect?.writes) continue;
    for (const w of v.effect.writes) {
      for (const dep of viewDeps) {
        const match = (dep.access === 'direct' && w.scope === dep.scope && w.key === dep.key)
          || (dep.access === 'scope' && w.scope === dep.scope)
          || (dep.access === 'prefix' && dep.prefix && w.key?.startsWith(dep.prefix));
        if (match && v.agent) {
          agentCounts[v.agent] = (agentCounts[v.agent] || 0) + 1;
          if (v.action) actionCounts[v.action] = (actionCounts[v.action] || 0) + 1;
        }
      }
    }
  }
  return Object.entries(agentCounts).sort((a, b) => b[1] - a[1]).map(([agent, count]) => ({ agent, count }));
}

// ── Render a surface card ──
function renderSurfaceCard(viewId, def, value) {
  const sem = inferSemantic(value, def.render);
  const label = def.render?.label || def.description || viewId;
  const unit = def.render?.unit || '';
  const temporal = def.render?.temporal;
  const cardId = 'sc-' + viewId.replace(/[^a-zA-Z0-9]/g, '_');
  const modes = expandedModes[cardId] || new Set();
  const isError = value && typeof value === 'object' && value._error;

  let html = '<div class="surface-card" id="' + cardId + '">';
  html += '<div class="s-label">' + esc(label) + '</div>';

  // ── Value mode (always shown) ──
  if (isError) {
    html += '<div class="s-error">' + esc(value._error) + '</div>';
  } else if (sem === 'quantity') {
    const n = typeof value === 'number' ? value : parseFloat(value);
    const color = def.render?.color || '';
    html += '<div class="s-value ' + color + '">' + (isNaN(n) ? esc(String(value)) : n.toLocaleString());
    if (unit) html += '<span class="s-unit">' + esc(unit) + '</span>';
    html += '</div>';
    // Sparkline placeholder
    html += '<div id="' + cardId + '-spark"></div>';
  } else if (sem === 'narrative') {
    // Simple markdown rendering
    let md = String(value || '');
    md = md.replace(/^### (.+)$/gm, '<h3>$1</h3>').replace(/^## (.+)$/gm, '<h2>$1</h2>').replace(/^# (.+)$/gm, '<h1>$1</h1>');
    md = md.replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>').replace(/\`(.+?)\`/g, '<code>$1</code>');
    md = md.replace(/\\n/g, '<br>');
    html += '<div class="s-narrative">' + md + '</div>';
  } else if (sem === 'record' && typeof value === 'object' && !Array.isArray(value)) {
    html += '<dl class="s-record">';
    for (const [k, v] of Object.entries(value)) {
      html += '<dt>' + esc(k) + '</dt><dd>' + esc(typeof v === 'object' ? JSON.stringify(v) : String(v)) + '</dd>';
    }
    html += '</dl>';
  } else if (sem === 'catalogue' && Array.isArray(value)) {
    const cols = def.render?.columns || (value.length > 0 ? Object.keys(value[0]).slice(0, 4) : []);
    const colKeys = cols.map(c => typeof c === 'string' ? c : c.key);
    const colLabels = cols.map(c => typeof c === 'string' ? c : (c.label || c.key));
    html += '<div class="s-value" style="font-size:14px">' + value.length + ' items</div>';
    html += '<table class="s-catalogue"><tr>' + colLabels.map(l => '<th>' + esc(l) + '</th>').join('') + '</tr>';
    for (const row of value.slice(0, def.render?.max_rows || 10)) {
      html += '<tr>' + colKeys.map(k => '<td class="sub">' + esc(typeof row[k] === 'object' ? JSON.stringify(row[k]) : String(row[k] ?? '')) + '</td>').join('') + '</tr>';
    }
    html += '</table>';
  } else if (sem === 'status') {
    const statusMap = def.render?.status_map || {};
    const color = statusMap[String(value)] || (value === true ? 'green' : value === false ? 'red' : '');
    html += '<div class="s-status"><span class="tag ' + color + '">' + esc(String(value)) + '</span></div>';
  } else if (sem === 'enumeration' && Array.isArray(value)) {
    html += '<div class="s-value" style="font-size:14px">' + value.length + ' items</div>';
    html += '<div class="sub">' + value.slice(0, 8).map(v => esc(String(v))).join(', ') + (value.length > 8 ? '…' : '') + '</div>';
  } else {
    html += '<div class="sub" style="max-height:4rem;overflow:auto">' + fmtVal(value) + '</div>';
  }

  // ── Observation mode buttons ──
  html += '<div class="s-modes">';
  if (def.deps?.length) html += '<button class="s-mode-btn' + (modes.has('trace') ? ' active' : '') + '" data-card="' + cardId + '" data-mode="trace">▸ trace</button>';
  html += '<button class="s-mode-btn' + (modes.has('lens') ? ' active' : '') + '" data-card="' + cardId + '" data-mode="lens">▸ lens</button>';
  if (def.deps?.length) html += '<button class="s-mode-btn' + (modes.has('provenance') ? ' active' : '') + '" data-card="' + cardId + '" data-mode="provenance">▸ provenance</button>';
  html += '</div>';

  // ── Expanded mode panels ──
  if (modes.has('trace')) {
    // Trace panel: shows detailed history timeline. Content loaded async.
    html += '<div class="s-mode-panel" id="' + cardId + '-trace"><div class="sub">loading trace…</div></div>';
  }

  if (modes.has('lens')) {
    html += '<div class="s-mode-panel"><div class="lens-expr">' + esc(def.expr) + '</div>';
    if (def.deps?.length) {
      html += '<div class="lens-deps">';
      for (const d of def.deps) {
        html += '<span class="lens-dep">' + esc((d.scope || '?') + '.' + (d.key || (d.prefix ? d.prefix + '*' : '*'))) + '</span>';
      }
      html += '</div>';
    }
    html += '<div class="sub" style="margin-top:4px">scope: ' + esc(def.scope || '_shared') + (def.registered_by ? ' · by: ' + esc(def.registered_by) : '') + '</div>';
    html += '</div>';
  }

  if (modes.has('provenance') && def.deps?.length) {
    const prov = buildProvenance(def.deps);
    if (prov.length > 0) {
      const maxCount = Math.max(...prov.map(p => p.count), 1);
      html += '<div class="s-mode-panel">';
      for (const p of prov) {
        const pct = Math.round((p.count / maxCount) * 100);
        html += '<div class="prov-row"><span class="prov-agent">' + esc(p.agent) + '</span><span><span class="prov-bar" style="width:' + pct + 'px"></span> ' + p.count + ' writes</span></div>';
      }
      html += '</div>';
    }
  }

  html += '</div>';
  return { html, viewId, cardId, temporal: temporal || sem === 'quantity', deps: def.deps };
}

// ── Salience fetch ──
async function fetchSalience(agentId) {
  if (!agentId || !token) { salienceData = null; return; }
  try {
    const r = await fetch(BASE + '/rooms/' + ROOM + '/salience?limit=30&agent=' + encodeURIComponent(agentId), { headers: { Authorization: 'Bearer ' + token } });
    if (r.ok) salienceData = await r.json(); else salienceData = null;
  } catch { salienceData = null; }
}

// ── Init ──
const app = document.getElementById('app');
function init() {
  const hash = location.hash;
  if (hash.includes('token=')) { token = new URLSearchParams(hash.slice(1)).get('token'); history.replaceState(null, '', location.pathname + location.search); }
  if (!token) token = sessionStorage.getItem('sync_tok_' + ROOM);
  if (token) startPolling(); else renderGate();
}

function renderGate() {
  app.innerHTML = '<div class="gate"><h1>sync</h1><div class="sub">' + ROOM + '</div><div style="margin-top:1rem"><input id="tok-input" placeholder="paste room, agent, or view token" autofocus></div><div id="gate-err" class="err"></div></div>';
  document.getElementById('tok-input').addEventListener('keydown', async e => {
    if (e.key !== 'Enter') return;
    const t = e.target.value.trim(); if (!t) return;
    try {
      const r = await fetch(BASE + '/rooms/' + ROOM + '/poll', { headers: { Authorization: 'Bearer ' + t } });
      if (r.status === 401) { document.getElementById('gate-err').textContent = 'Invalid token'; return; }
      if (!r.ok) { document.getElementById('gate-err').textContent = 'Error: ' + r.status; return; }
      token = t; sessionStorage.setItem('sync_tok_' + ROOM, t); data = await r.json(); renderDash(); startPolling();
    } catch (err) { document.getElementById('gate-err').textContent = err.message; }
  });
}

// ── Poll ──
async function poll() {
  try {
    const r = await fetch(BASE + '/rooms/' + ROOM + '/poll?audit_limit=50', { headers: { Authorization: 'Bearer ' + token } });
    if (r.status === 401) { stopPolling(); token = null; sessionStorage.removeItem('sync_tok_' + ROOM); renderGate(); return; }
    if (!r.ok) { updSt('error'); return; }
    data = await r.json();
    const agent = viewAsAgent || (tokenKind() === 'agent' && data.salience?.[0]?.agent ? data.salience[0].agent : null);
    if (agent) await fetchSalience(agent);
    else if (data.salience?.length) salienceData = { entries: data.salience, agent: data.salience[0]?.agent || '?', weights: {} };
    else salienceData = null;
    if (!document.getElementById('surfaces')) renderDash();
    updSt('live'); renderContent();
  } catch { updSt('error'); }
}
function startPolling() { poll(); if (pollTimer) clearInterval(pollTimer); pollTimer = setInterval(poll, POLL_MS); }
function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }
function updSt(s) { const el = document.getElementById('poll-dot'); if (el) el.className = 'status ' + s; const t = document.getElementById('poll-txt'); if (t) t.textContent = s; }

// ── Main layout ──
function renderDash() {
  app.innerHTML =
    '<div id="header-row"><div><h1><a href="/">sync</a> <span class="sub">v8</span></h1><div class="sub">' + ROOM + '</div></div>' +
    '<div id="poll-info"><span id="poll-dot" class="status connecting"></span><span id="poll-txt">connecting</span> · <a href="#" id="logout-btn" style="color:var(--dim);font-size:11px">disconnect</a></div></div>' +
    '<div id="identity-bar"></div>' +
    '<div id="surfaces"></div>' +
    '<button class="debug-toggle" id="debug-toggle"><span id="debug-arrow" style="font-size:10px;display:inline-block;transition:transform 0.15s">▶</span> debug · <span id="debug-stats"></span></button>' +
    '<div id="debug-section" style="display:none"><div id="tabs" class="tabs"></div><div id="content"></div></div>';
  document.getElementById('logout-btn').onclick = e => { e.preventDefault(); stopPolling(); token = null; sessionStorage.removeItem('sync_tok_' + ROOM); renderGate(); };
  document.getElementById('debug-toggle').onclick = () => { debugOpen = !debugOpen; document.getElementById('debug-section').style.display = debugOpen ? 'block' : 'none'; document.getElementById('debug-arrow').style.transform = debugOpen ? 'rotate(90deg)' : ''; };
  renderContent();
}

function renderContent() {
  if (!data) return;
  renderIdentityBar();
  renderSurfaces();
  renderDebugStats();
  if (debugOpen) { renderTabs(); renderActivePanel(); }
}

// ── Identity bar ──
function renderIdentityBar() {
  const el = document.getElementById('identity-bar'); if (!el) return;
  const kind = tokenKind();
  const agents = (data.state || []).filter(e => e.scope === '_agents');
  const kindLabel = kind === 'room' ? 'room admin' : kind === 'view' ? 'observer' : 'agent';
  const kindColor = kind === 'room' ? 'var(--orange)' : kind === 'view' ? 'var(--purple)' : 'var(--accent)';
  let html = '<div class="id-bar"><span class="sub">identity:</span> <span style="color:' + kindColor + ';font-weight:600">' + kindLabel + '</span>';
  if (kind === 'room' || kind === 'view') {
    html += ' · <span class="sub">view as:</span> <select id="agent-select"><option value="">— select agent —</option>';
    for (const a of agents) { const v = typeof a.value === 'string' ? JSON.parse(a.value) : a.value; html += '<option value="' + esc(a.key) + '"' + (viewAsAgent === a.key ? ' selected' : '') + '>' + esc(v.name || a.key) + ' (' + esc(v.role || 'agent') + ')</option>'; }
    html += '</select>';
  }
  if (salienceData?.agent) html += ' · <span style="color:var(--green);font-size:11px">salience: ' + esc(salienceData.agent) + '</span>';
  html += '</div>'; el.innerHTML = html;
  const sel = document.getElementById('agent-select');
  if (sel) sel.onchange = async () => { viewAsAgent = sel.value; if (viewAsAgent) await fetchSalience(viewAsAgent); else salienceData = null; renderContent(); };
}

// ── Surfaces section ──
function renderSurfaces() {
  const el = document.getElementById('surfaces'); if (!el) return;
  const views = (data.state || []).filter(e => e.scope === '_views');
  const resolved = data.resolved || {};
  // Get surfaces: views with render hints, filtering out errors for non-hinted views
  const surfaceViews = [];
  for (const v of views) {
    const def = typeof v.value === 'string' ? JSON.parse(v.value) : v.value;
    const value = resolved[v.key];
    const isError = value && typeof value === 'object' && value._error;
    // Show as surface if has render hint (even if errored), or if value resolves successfully
    if (def.render) {
      surfaceViews.push({ id: v.key, def, value });
    } else if (value !== undefined && value !== null && !isError) {
      surfaceViews.push({ id: v.key, def, value });
    }
  }
  if (surfaceViews.length === 0) {
    el.innerHTML = '<div class="sub" style="padding:0.5rem 0">No views registered. Surfaces appear when agents register views with render hints.</div>';
    return;
  }
  // Sort by render.order, then by id
  surfaceViews.sort((a, b) => (a.def.render?.order ?? 999) - (b.def.render?.order ?? 999) || a.id.localeCompare(b.id));
  const cards = surfaceViews.map(v => renderSurfaceCard(v.id, v.def, v.value));
  el.innerHTML = '<div class="surfaces">' + cards.map(c => c.html).join('') + '</div>';

  // Bind mode buttons
  el.querySelectorAll('.s-mode-btn').forEach(btn => {
    btn.onclick = () => {
      const cardId = btn.dataset.card, mode = btn.dataset.mode;
      if (!expandedModes[cardId]) expandedModes[cardId] = new Set();
      if (expandedModes[cardId].has(mode)) expandedModes[cardId].delete(mode); else expandedModes[cardId].add(mode);
      renderSurfaces();
    };
  });

  // Populate trace panels (async — fills placeholder divs)
  for (const card of cards) {
    const modes = expandedModes[card.cardId];
    if (!modes || !modes.has('trace')) continue;
    const sv = surfaceViews.find(v => v.id === card.viewId);
    if (!sv?.def?.deps?.length) continue;
    const dep = sv.def.deps[0];
    if (!dep.scope || !dep.key) continue;
    fetchHistory(dep.scope, dep.key, card.viewId).then(entries => {
      const traceEl = document.getElementById(card.cardId + '-trace');
      if (!traceEl) return;
      const numEntries = entries.filter(e => e.value !== null && e.value !== undefined);
      if (numEntries.length === 0) { traceEl.innerHTML = '<div class="sub">No history data for ' + esc(dep.scope + '.' + dep.key) + '</div>'; return; }
      // Render sparkline + timeline table
      const nums = numEntries.filter(e => typeof e.value === 'number').map(e => e.value);
      let html = '';
      if (nums.length >= 2) html += sparklineSvg(nums, 280, 32);
      html += '<table style="margin-top:6px"><tr><th>value</th><th>agent</th><th>time</th><th>seq</th></tr>';
      for (const e of [...numEntries].reverse().slice(0, 20)) {
        const ts = e.ts ? new Date(e.ts).toLocaleTimeString() : '';
        html += '<tr><td style="color:var(--fg);font-weight:600">' + fmtVal(e.value) + '</td><td class="agent">' + esc(e.agent || '') + '</td><td class="sub">' + ts + '</td><td class="sub">' + (e.seq ?? '') + '</td></tr>';
      }
      html += '</table>';
      if (numEntries.length > 20) html += '<div class="sub">' + (numEntries.length - 20) + ' more entries…</div>';
      traceEl.innerHTML = html;
    });
  }

  // Fetch sparklines for temporal views
  for (const card of cards) {
    if (!card.temporal) continue;
    const sv = surfaceViews.find(v => v.id === card.viewId);
    if (!sv?.def?.deps?.length) continue;
    const dep = sv.def.deps[0];
    if (dep.scope && dep.key) {
      fetchHistory(dep.scope, dep.key, card.viewId).then(entries => {
        const sparkEl = document.getElementById(card.cardId + '-spark');
        if (!sparkEl) return;
        // entries are already {value, ts, agent, seq} — filter to numeric values
        const numEntries = entries.filter(e => e.value !== null && e.value !== undefined && typeof e.value === 'number');
        if (numEntries.length < 2) {
          if (numEntries.length === 1) sparkEl.innerHTML = '<div class="sparkline-delta">' + numEntries.length + ' data point (need 2+ for trace)</div>';
          return;
        }
        const values = numEntries.map(e => e.value);
        const first = values[0], last = values[values.length - 1];
        const delta = last - first;
        sparkEl.innerHTML = sparklineSvg(values, 200, 24) +
          '<div class="sparkline-delta ' + (delta > 0 ? 'up' : delta < 0 ? 'down' : '') + '">' +
          (delta > 0 ? '+' : '') + delta + ' over ' + values.length + ' changes' +
          (numEntries[0]?.agent ? ' · first by ' + esc(numEntries[0].agent) : '') + '</div>';
      });
    }
  }
}

function renderDebugStats() {
  const el = document.getElementById('debug-stats'); if (!el || !data) return;
  const s = data.state || [];
  el.textContent = s.filter(e => e.scope === '_agents').length + ' agents · ' + s.length + ' keys · ' + (data.audit||[]).length + ' audit';
}

// ── Debug tabs (same as before) ──
const TABS = [{id:'state',label:'State'},{id:'agents',label:'Agents'},{id:'actions',label:'Actions'},{id:'views',label:'Views'},{id:'messages',label:'Messages'},{id:'salience',label:'Salience'},{id:'audit',label:'Audit'}];
function renderTabs() {
  const s = data.state || [];
  const sc = salienceData ? (salienceData.entries||[]).length : (data.salience||[]).length;
  const counts = { state: s.filter(e => !e.scope.startsWith('_') || e.scope === '_shared').length, agents: s.filter(e => e.scope === '_agents').length, actions: s.filter(e => e.scope === '_actions').length, views: s.filter(e => e.scope === '_views').length, messages: s.filter(e => e.scope === '_messages').length, salience: sc, audit: (data.audit||[]).length };
  document.getElementById('tabs').innerHTML = TABS.map(t => '<button class="tab' + (activeTab === t.id ? ' active' : '') + '" data-tab="' + t.id + '">' + t.label + '<span class="badge">' + (counts[t.id]??'') + '</span></button>').join('');
  document.querySelectorAll('#tabs .tab').forEach(el => { el.onclick = () => { activeTab = el.dataset.tab; renderTabs(); renderActivePanel(); }; });
}

function renderActivePanel() {
  const el = document.getElementById('content'); if (!el) return;
  const s = data.state || [];
  switch (activeTab) {
    case 'state': {
      const byScope = {};
      for (const e of s) { if (e.scope === '_audit') continue; (byScope[e.scope] = byScope[e.scope] || []).push(e); }
      let html = '';
      for (const [scope, entries] of Object.entries(byScope).sort((a,b) => a[0].localeCompare(b[0]))) {
        html += '<h3>' + esc(scope) + ' <span class="sub">(' + entries.length + ')</span></h3><table><tr><th>key</th><th>value</th><th style="width:50px">rev</th></tr>';
        for (const e of entries.sort((a,b) => String(a.key).localeCompare(String(b.key)))) html += '<tr><td class="key">' + esc(e.key) + '</td><td class="val">' + fmtVal(e.value) + '</td><td class="sub">' + (e.revision??'') + '</td></tr>';
        html += '</table>';
      }
      el.innerHTML = html || '<div class="sub">No state</div>'; break;
    }
    case 'agents': {
      let html = '<table><tr><th>id</th><th>name</th><th>role</th><th>status</th><th>heartbeat</th><th>last_seen</th></tr>';
      for (const a of s.filter(e => e.scope === '_agents')) { const v = typeof a.value === 'string' ? JSON.parse(a.value) : a.value; html += '<tr><td class="key">' + esc(a.key) + '</td><td>' + esc(v.name) + '</td><td class="sub">' + esc(v.role) + '</td><td><span class="tag ' + (v.status==='active'?'green':'yellow') + '">' + esc(v.status) + '</span></td><td class="sub">' + (v.last_heartbeat ? new Date(v.last_heartbeat).toLocaleTimeString() : '') + '</td><td class="sub">' + (v.last_seen_seq??'—') + '</td></tr>'; }
      el.innerHTML = html + '</table>'; break;
    }
    case 'actions': {
      const avail = data.available || {};
      let html = '<table><tr><th>id</th><th>description</th><th>scope</th><th>writes</th><th>status</th></tr>';
      for (const a of s.filter(e => e.scope === '_actions')) { const v = typeof a.value === 'string' ? JSON.parse(a.value) : a.value; const wt = (v.writes||[]).map(w => (w.scope||'_shared') + '.' + (w.key||'?')).join(', '); html += '<tr><td class="key">' + esc(a.key) + '</td><td>' + esc(v.description||'') + '</td><td class="scope">' + esc(v.scope||'_shared') + '</td><td class="sub" style="max-width:200px">' + esc(wt) + '</td><td><span class="tag ' + (a.key in avail ? 'green' : 'red') + '">' + (a.key in avail ? 'available' : 'unavailable') + '</span></td></tr>'; }
      el.innerHTML = html + '</table>'; break;
    }
    case 'views': {
      const resolved = data.resolved || {};
      let html = '<table><tr><th>id</th><th>expr</th><th>value</th><th>deps</th><th>render</th></tr>';
      for (const v of s.filter(e => e.scope === '_views')) { const def = typeof v.value === 'string' ? JSON.parse(v.value) : v.value; const val = resolved[v.key]; const rh = def.render ? (def.render.as||def.render.type||'—') : '—'; html += '<tr><td class="key">' + esc(v.key) + '</td><td class="sub" style="max-width:180px">' + esc(def.expr) + '</td><td class="val">' + fmtVal(val) + '</td><td class="sub">' + (def.deps?.map(d => (d.scope||'?') + '.' + (d.key||'*')).join(', ')||'—') + '</td><td><span class="tag purple">' + esc(rh) + '</span></td></tr>'; }
      el.innerHTML = html + '</table>'; break;
    }
    case 'messages': {
      const msgs = s.filter(e => e.scope === '_messages').sort((a,b) => (b.sort_key??0)-(a.sort_key??0));
      let html = '';
      for (const m of msgs) { const v = typeof m.value === 'string' ? JSON.parse(m.value) : m.value; html += '<div class="msg"><span class="from">' + esc(v.from||'?') + '</span> <span class="kind">' + esc(v.kind||'chat') + '</span>'; if (v.to) html += ' <span class="to">→ ' + esc(v.to.join(', ')) + '</span>'; html += '<div class="body">' + esc(v.body || (v.action ? v.action + '(' + JSON.stringify(v.params||{}) + ')' : JSON.stringify(v))) + '</div></div>'; }
      el.innerHTML = html || '<div class="sub">No messages</div>'; break;
    }
    case 'salience': {
      const entries = salienceData ? (salienceData.entries||[]) : (data.salience||[]);
      if (!entries.length) { el.innerHTML = '<div class="sub" style="padding:1rem">' + ((tokenKind()==='room'||tokenKind()==='view') ? 'Select an agent above to view their salience map' : 'No salience data') + '</div>'; break; }
      const agent = salienceData?.agent || viewAsAgent || '?';
      let html = '<div class="sub" style="margin-bottom:0.5rem">Salience for <span style="color:var(--orange);font-weight:600">' + esc(agent) + '</span></div><table><tr><th>scope</th><th>key</th><th>score</th><th style="width:100px"></th><th>signals</th></tr>';
      const mx = Math.max(...entries.map(e => e.score), 0.01);
      for (const e of entries) { let sigs = ''; if (Array.isArray(e.signals)) sigs = e.signals.join(', '); else if (e.signals && typeof e.signals === 'object') sigs = Object.entries(e.signals).filter(([k,v]) => v > 0.05).map(([k,v]) => k + '=' + v.toFixed(2)).join(', '); html += '<tr><td class="scope">' + esc(e.scope||'') + '</td><td class="key">' + esc(e.key||'') + '</td><td>' + e.score.toFixed(3) + '</td><td><div class="salience-bar" style="width:' + Math.round(e.score/mx*100) + '%"></div></td><td class="sub">' + esc(sigs) + '</td></tr>'; }
      el.innerHTML = html + '</table>'; break;
    }
    case 'audit': {
      let html = '<table><tr><th>seq</th><th>kind</th><th>agent</th><th>detail</th><th>time</th></tr>';
      for (const a of [...(data.audit||[])].reverse().slice(0, 100)) { const v = typeof a.value === 'string' ? JSON.parse(a.value) : a.value; const kind = v.kind||'invoke'; const detail = kind === 'invoke' ? (v.action||'') + (v.effect?.writes?.length ? ' → ' + v.effect.writes.length + ' writes' : '') : JSON.stringify(v.schema||{}).slice(0,80); html += '<tr><td>' + (a.seq??a.sort_key??'') + '</td><td><span class="tag blue">' + esc(kind) + '</span></td><td class="agent">' + esc(v.agent||'') + '</td><td class="sub">' + esc(detail) + '</td><td class="sub">' + (v.ts ? new Date(v.ts).toLocaleTimeString() : '') + '</td></tr>'; }
      el.innerHTML = html + '</table>'; break;
    }
  }
}

init();
</script>
</body>
</html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache, no-store" },
  });
}
