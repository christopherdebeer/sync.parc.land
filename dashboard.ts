export function dashboardHTML(roomId: string, baseUrl: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<script src="https://cdn.jsdelivr.net/npm/marked@12/marked.min.js"></script>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>sync · ${roomId.slice(0, 12)}</title>
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
    max-width: 1100px; margin: 0 auto;
  }

  /* Auth gate */
  .auth-gate { max-width: 420px; margin: 15vh auto; text-align: center; }
  .auth-gate h2 { color: var(--accent); font-size: 16px; margin-bottom: 0.3rem; }
  .auth-gate .sub { color: var(--dim); font-size: 12px; margin-bottom: 1.2rem; }
  .auth-gate input {
    width: 100%; background: var(--surface); border: 1px solid var(--border);
    border-radius: 6px; padding: 0.6rem 0.8rem; color: var(--fg);
    font-family: inherit; font-size: 13px; outline: none; text-align: center;
  }
  .auth-gate input:focus { border-color: var(--accent); }
  .auth-gate input::placeholder { color: var(--dim); }
  .auth-gate .err { color: var(--red); font-size: 12px; margin-top: 0.5rem; display: none; }
  .auth-gate .hint { color: var(--dim); font-size: 11px; margin-top: 1rem; }

  /* Main UI */
  .main { display: none; }
  .headers { position: sticky; display: flex; flex-direction: column; top: 0; background-color: var(--bg); padding: 1em; }
  .header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 0.5rem; }
  h1, h1 > a { font-size: 14px; font-weight: 600; color: var(--accent); text-decoration: none; }
  .room-id { color: var(--dim); font-size: 11px; word-break: break-all; }
  .poll-info { color: var(--dim); font-size: 11px; display: flex; align-items: center; gap: 6px; }
  .dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--green); }
  .dot.error { background: var(--red); }

  /* Identity bar */
  .id-bar {
    display: flex; align-items: center; gap: 0.75rem; padding: 0.4rem 0.6rem;
    background: var(--surface); border: 1px solid var(--border); border-radius: 6px;
    margin-bottom: 0.5rem; font-size: 12px; flex-wrap: wrap;
  }
  .id-label { color: var(--dim); }
  .id-token-type { font-weight: 600; }
  .id-token-type.room { color: var(--orange); }
  .id-token-type.agent { color: var(--accent); }
  .id-bar select {
    background: var(--bg); border: 1px solid var(--border); border-radius: 4px;
    color: var(--fg); font-family: inherit; font-size: 12px; padding: 2px 6px; outline: none;
  }
  .id-bar select:focus { border-color: var(--accent); }
  .id-bar .logout { color: var(--dim); cursor: pointer; font-size: 11px; margin-left: auto; }
  .id-bar .logout:hover { color: var(--red); }

  .summary-bar { display: flex; gap: 1rem; padding: 0.4rem 0; font-size: 12px; color: var(--dim); flex-wrap: wrap; }
  .stat { display: flex; align-items: center; gap: 4px; }
  .stat .n { color: var(--fg); font-weight: 600; }

  .tabs { display: flex; gap: 0; border-bottom: 1px solid var(--border); margin: 0.5rem 0 0; }
  .tab {
    padding: 0.4rem 0.7rem; font-size: 12px; cursor: pointer;
    color: var(--dim); border-bottom: 2px solid transparent;
    background: none; border-top: none; border-left: none; border-right: none;
    font-family: inherit;
  }
  .tab:hover { color: var(--fg); }
  .tab.active { color: var(--accent); border-bottom-color: var(--accent); }
  .tab .b { display: inline-block; background: var(--border); border-radius: 8px; padding: 0 5px; font-size: 10px; margin-left: 3px; color: var(--dim); }
  .tab.active .b { background: rgba(88,166,255,0.15); color: var(--accent); }
  .panel { display: none; padding-top: 0.75rem; }
  .panel.active { display: block; }

  /* Cards */
  .card-grid { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 6px; padding: 0.5rem 0.7rem; min-width: 160px; flex: 0 0 auto;
  }
  .card.viewing { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  .card .name { color: var(--accent); font-weight: 600; font-size: 12px; }
  .card .sub { color: var(--dim); font-size: 11px; }
  .badge { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 3px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; }
  .bg-green { background: rgba(63,185,80,0.15); color: var(--green); }
  .bg-yellow { background: rgba(210,153,34,0.15); color: var(--yellow); }
  .bg-blue { background: rgba(88,166,255,0.15); color: var(--accent); }
  .bg-purple { background: rgba(188,140,255,0.15); color: var(--purple); }
  .bg-red { background: rgba(248,81,73,0.15); color: var(--red); }
  .hb { color: var(--dim); font-size: 10px; margin-top: 2px; }
  .hb.stale { color: var(--yellow); }
  .hb.dead { color: var(--red); }
  .grants-list { font-size: 10px; color: var(--purple); margin-top: 2px; }

  /* Log (messages) */
  .log { display: flex; flex-direction: column; gap: 1px; overflow-y: auto; }
  .log-row { display: grid; grid-template-columns: 90px 1fr auto; gap: 0.5rem; padding: 4px 8px; font-size: 12px; background: var(--surface); border-radius: 2px; }
  .log-row:hover { background: var(--surface2); }
  .log-from { color: var(--accent); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .log-body { color: var(--fg); word-break: break-word; min-width: 0; }
  .log-body .md { display: inline; }
  .log-body .md p { display: inline; margin: 0; }
  .log-body .md p + p { display: block; margin-top: 0.3rem; }
  .log-body .md code { background: var(--surface2); border-radius: 3px; padding: 1px 4px; font-family: inherit; font-size: 11px; color: var(--accent); }
  .log-body .md pre { background: var(--surface2); border-radius: 4px; padding: 0.4rem 0.6rem; margin-top: 0.3rem; overflow-x: auto; }
  .log-body .md pre code { background: none; padding: 0; color: var(--fg); }
  .log-body .md strong { color: var(--fg); font-weight: 700; }
  .log-body .md em { color: var(--dim); font-style: italic; }
  .log-body .md a { color: var(--accent); }
  .log-body .md ul, .log-body .md ol { padding-left: 1.2rem; margin-top: 0.2rem; }
  .log-body .md h1,.log-body .md h2,.log-body .md h3 { font-size: 13px; font-weight: 700; margin-top: 0.3rem; }
  .log-meta { color: var(--dim); font-size: 11px; white-space: nowrap; text-align: right; }
  .kind-tag { display: inline-block; background: var(--border); border-radius: 2px; padding: 0 4px; font-size: 10px; color: var(--dim); margin-right: 4px; }
  .kt-task { background: rgba(210,153,34,0.2); color: var(--yellow); }
  .kt-action_invocation { background: rgba(188,140,255,0.2); color: var(--purple); }
  .kt-result { background: rgba(63,185,80,0.2); color: var(--green); }

  /* Scope groups */
  .scope-group { margin-bottom: 0.75rem; }
  .scope-hd {
    display: flex; align-items: center; gap: 6px; cursor: pointer;
    padding: 0.3rem 0.5rem; background: var(--surface); border: 1px solid var(--border);
    border-radius: 4px 4px 0 0; font-size: 12px; user-select: none;
  }
  .scope-hd.closed { border-radius: 4px; }
  .scope-hd .arr { font-size: 10px; color: var(--dim); transition: transform 0.15s; display: inline-block; }
  .scope-hd.closed .arr { transform: rotate(-90deg); }
  .scope-hd .sn { font-weight: 600; }
  .sn-shared { color: var(--yellow); }
  .sn-system { color: var(--orange); }
  .sn-agent { color: var(--accent); }
  .scope-hd .cnt { color: var(--dim); font-size: 11px; }
  .scope-hd .scope-priv { font-size: 10px; margin-left: auto; }
  .scope-bd { border: 1px solid var(--border); border-top: none; border-radius: 0 0 4px 4px; overflow: hidden; }
  .scope-bd.hidden { display: none; }
  .s-row { display: grid; grid-template-columns: 140px 1fr 30px; gap: 0.5rem; padding: 0.3rem 0.5rem; font-size: 12px; border-bottom: 1px solid var(--border); align-items: start; }
  .s-row:last-child { border-bottom: none; }
  .s-key { color: var(--green); font-weight: 500; word-break: break-word; }
  .s-ver { color: var(--dim); text-align: center; font-size: 11px; }
  .s-sort { color: var(--dim); font-size: 10px; }
  .s-timer { font-size: 10px; color: var(--orange); margin-top: 2px; }

  /* JSON */
  .jv { cursor: default; }
  .js { color: #a5d6ff; } .jn { color: #79c0ff; } .jb { color: var(--orange); }
  .jnl { color: var(--dim); font-style: italic; } .jk { color: #7ee787; }
  .jbr { color: var(--dim); } .jch { padding-left: 16px; } .jch.hidden { display: none; }
  .jcol { color: var(--dim); font-style: italic; font-size: 11px; }
  .jtog { cursor: pointer; user-select: none; display: inline; }
  .jtog:hover { color: var(--accent); }

  /* Actions */
  .action-card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 6px;
    padding: 0.6rem 0.8rem; min-width: 200px; flex: 1 1 280px; max-width: 400px;
  }
  .action-card .a-name { font-weight: 600; font-size: 13px; }
  .action-card .a-name.available { color: var(--green); }
  .action-card .a-name.unavailable { color: var(--dim); }
  .action-card .a-desc { color: var(--dim); font-size: 11px; margin-top: 2px; }
  .action-card .a-meta { font-size: 10px; color: var(--dim); margin-top: 4px; }
  .action-card .a-if { font-size: 11px; color: var(--purple); margin-top: 3px; font-style: italic; }
  .action-card .a-params { font-size: 11px; color: var(--accent); margin-top: 3px; }
  .action-card .a-writes { font-size: 11px; color: var(--green); margin-top: 3px; }

  /* Views */
  .view-card {
    background: var(--surface); border: 1px solid var(--border); border-radius: 6px;
    padding: 0.6rem 0.8rem; min-width: 200px; flex: 1 1 280px; max-width: 400px;
  }
  .view-card .v-name { font-weight: 600; font-size: 13px; color: var(--purple); }
  .view-card .v-desc { color: var(--dim); font-size: 11px; margin-top: 2px; }
  .view-card .v-expr { font-size: 11px; color: var(--dim); margin-top: 3px; font-style: italic; }
  .view-card .v-val { margin-top: 4px; padding: 4px 6px; background: var(--bg); border-radius: 3px; font-size: 12px; }
  .view-card .v-meta { font-size: 10px; color: var(--dim); margin-top: 4px; }

  /* CEL Console */
  .cel { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: 0.75rem; margin-top: 0.5rem; }
  .cel-row { display: flex; gap: 0.5rem; }
  .cel-in { flex: 1; background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 0.4rem 0.6rem; color: var(--fg); font-family: inherit; font-size: 12px; outline: none; }
  .cel-in:focus { border-color: var(--accent); }
  .cel-go { background: var(--accent); color: var(--bg); border: none; border-radius: 4px; padding: 0.4rem 0.8rem; cursor: pointer; font-family: inherit; font-size: 12px; font-weight: 600; }
  .cel-out { margin-top: 0.5rem; padding: 0.5rem; background: var(--bg); border-radius: 4px; font-size: 12px; white-space: pre-wrap; word-break: break-word; display: none; max-height: 300px; overflow-y: auto; }
  .cel-out.vis { display: block; }
  .cel-out.err { color: var(--red); }
  .cel-out.ok { color: var(--green); }
  .cel-hist { margin-top: 0.5rem; display: flex; flex-wrap: wrap; gap: 4px; }
  .cel-hi { background: var(--border); border: none; border-radius: 3px; padding: 2px 6px; font-size: 10px; color: var(--dim); cursor: pointer; font-family: inherit; }
  .cel-hi:hover { color: var(--accent); }

  .flash { animation: fl 0.6s ease-out; }
  @keyframes fl { from { background: rgba(88,166,255,0.12); } to { background: transparent; } }
  .empty { color: var(--dim); font-style: italic; padding: 1rem; text-align: center; }
</style>
</head>
<body>

<!-- Auth gate -->
<div id="auth-gate" class="auth-gate">
  <h2>agent-sync</h2>
  <div class="sub">${roomId}</div>
  <input id="token-input" type="password" placeholder="paste room or agent token" autocomplete="off"
    onkeydown="if(event.key==='Enter')tryAuth()" onfocus="this.type='text'" onblur="if(!this.value)this.type='password'">
  <div class="err" id="auth-err"></div>
  <div class="hint">Token is stored in sessionStorage and sent via Authorization header only.<br>Never leaves the browser in the URL.</div>
</div>

<!-- Main dashboard (hidden until authed) -->
<div class="main" id="main">
<div class="headers">
  <div class="header">
    <div>
      <h1><a href="/">agent-sync</a> <span style="color:var(--dim);font-weight:400">v5</span></h1>
      <div class="room-id">${roomId}</div>
    </div>
    <div class="poll-info"><span class="dot" id="pulse"></span><span id="pstat">connecting…</span></div>
  </div>
  
  <div class="id-bar" id="id-bar">
    <span class="id-label">identity:</span>
    <span class="id-token-type" id="id-type"></span>
    <span id="id-agent-name"></span>
    <span id="id-perspective"></span>
    <span class="logout" id="logout" onclick="doLogout()">✕ disconnect</span>
  </div>
  
  <div class="summary-bar" id="summary"></div>
  
  <div class="tabs">
    <button class="tab active" data-t="agents">Agents <span class="b" id="c-agents">0</span></button>
    <button class="tab" data-t="state">State <span class="b" id="c-state">0</span></button>
    <button class="tab" data-t="messages">Messages <span class="b" id="c-msgs">0</span></button>
    <button class="tab" data-t="actions">Actions <span class="b" id="c-actions">0</span></button>
    <button class="tab" data-t="views">Views <span class="b" id="c-views">0</span></button>
    <button class="tab" data-t="audit">Audit <span class="b" id="c-audit">0</span></button>
    <button class="tab" data-t="cel">CEL</button>
  </div>
</div>

<div class="panel active" id="p-agents"><div id="agents" class="card-grid"><div class="empty">no agents</div></div></div>
<div class="panel" id="p-state"><div id="state"><div class="empty">no state</div></div></div>
<div class="panel" id="p-messages"><div id="messages" class="log"><div class="empty">no messages</div></div></div>
<div class="panel" id="p-actions"><div id="actions" class="card-grid"><div class="empty">no actions</div></div></div>
<div class="panel" id="p-views"><div id="views" class="card-grid"><div class="empty">no views</div></div></div>
<div class="panel" id="p-audit"><div id="audit" class="log"><div class="empty">no audit entries</div></div></div>

<div class="panel" id="p-cel">
  <div class="cel">
    <div class="cel-row">
      <input class="cel-in" id="cel-in" placeholder="state._shared.phase" spellcheck="false" onkeydown="if(event.key==='Enter')runCel()">
      <button class="cel-go" onclick="runCel()">Eval</button>
    </div>
    <div class="cel-hist" id="cel-hist"></div>
    <div class="cel-out" id="cel-out"></div>
  </div>
  <div style="margin-top:0.6rem;color:var(--dim);font-size:11px;">
    <b>Quick:</b>
    <span style="cursor:pointer;color:var(--accent)" onclick="qcel('state._shared')">_shared</span> ·
    <span style="cursor:pointer;color:var(--purple)" onclick="qcel('views')">views</span> ·
    <span style="cursor:pointer;color:var(--accent)" onclick="qcel('agents')">agents</span> ·
    <span style="cursor:pointer;color:var(--accent)" onclick="qcel('messages')">messages</span> ·
    <span style="cursor:pointer;color:var(--accent)" onclick="qcel('actions')">actions</span> ·
    <span style="cursor:pointer;color:var(--accent)" onclick="qcel('state')">all state</span>
  </div>
</div>
</div><!-- /main -->

<script>
const B="${baseUrl}", R="${roomId}", PM=2000;
const SK='sync_token_'+R;
let TOKEN=null, TOKEN_KIND=null, AUTH_AGENT=null;
let agentMap={}, agentList=[], collapsed=new Set(), expanded=new Set(), scopeInit=false, lastSt=null, prevVer={}, celH=[], pollTimer=null;

// ============ Auth ============

function getStoredToken(){
  // 1. hash fragment (one-time, then clear)
  const h=location.hash;
  if(h.includes('token=')){
    const t=new URLSearchParams(h.slice(1)).get('token');
    if(t){history.replaceState(null,'',location.pathname+location.search);sessionStorage.setItem(SK,t);return t;}
  }
  // 2. sessionStorage
  return sessionStorage.getItem(SK);
}

async function tryAuth(tok){
  const t=tok||document.getElementById('token-input').value.trim();
  if(!t)return;
  const err=document.getElementById('auth-err');
  err.style.display='none';
  // Validate token by making a poll request
  try{
    const r=await fetch(B+'/rooms/'+R+'/poll',{headers:{'Authorization':'Bearer '+t}});
    if(r.status===401){err.textContent='Invalid token for this room.';err.style.display='block';return;}
    if(!r.ok){err.textContent='Error: '+r.status;err.style.display='block';return;}
    sessionStorage.setItem(SK,t);
    TOKEN=t;
    const d=await r.json();
    initSession(d.agents||[]);
  }catch(e){err.textContent='Connection failed: '+e.message;err.style.display='block';}
}
window.tryAuth=tryAuth;

function initSession(agents){
  TOKEN_KIND=TOKEN.startsWith('room_')?'room':'agent';
  AUTH_AGENT=null;
  if(TOKEN_KIND==='agent'){
    // Determine which agent we are (server validated the token, so find by presence)
    // We'll discover on first poll via agents list + token match
  }
  document.getElementById('auth-gate').style.display='none';
  document.getElementById('main').style.display='block';
  updateIdBar(agents);
  const ht=new URLSearchParams(location.hash.slice(1)).get('tab');
  if(ht)switchTab(ht);
  poll();
  if(pollTimer)clearInterval(pollTimer);
  pollTimer=setInterval(poll,PM);
}

function updateIdBar(agents){
  const typeEl=document.getElementById('id-type');
  const nameEl=document.getElementById('id-agent-name');
  const persEl=document.getElementById('id-perspective');
  agentList=agents||[];

  if(TOKEN_KIND==='room'){
    typeEl.className='id-token-type room';
    typeEl.textContent='room admin';
    nameEl.textContent='';
    // Agent perspective selector
    let h='<select id="view-as" onchange="switchPerspective(this.value)" style="margin-left:8px">';
    h+='<option value="">admin (all scopes)</option>';
    for(const a of agentList)h+='<option value="'+esc(a.id)+'">view as: '+esc(a.name||a.id)+'</option>';
    h+='</select>';
    persEl.innerHTML=h;
  }else{
    typeEl.className='id-token-type agent';
    typeEl.textContent='agent';
    // Find our identity from the agents list (we know our token works)
    nameEl.textContent='';
    persEl.innerHTML='';
  }
}

function doLogout(){
  sessionStorage.removeItem(SK);
  TOKEN=null;TOKEN_KIND=null;AUTH_AGENT=null;
  if(pollTimer){clearInterval(pollTimer);pollTimer=null;}
  document.getElementById('main').style.display='none';
  document.getElementById('auth-gate').style.display='block';
  document.getElementById('token-input').value='';
}
window.doLogout=doLogout;

let viewAsAgent='';
function switchPerspective(agentId){viewAsAgent=agentId;scopeInit=false;poll();}
window.switchPerspective=switchPerspective;

// ============ Helpers ============

function esc(s){if(s==null)return'';const d=document.createElement('div');d.textContent=String(s);return d.innerHTML;}
const e=esc;
function authHeaders(){return{'Authorization':'Bearer '+TOKEN,'Content-Type':'application/json'};}
async function api(p){try{const r=await fetch(B+p,{headers:authHeaders()});if(!r.ok)return null;return r.json();}catch{return null;}}
function aname(id){if(!id)return'system';const a=agentMap[id];return a?a.name:id.length>12?id.slice(0,8)+'…':id;}
function rel(ts){if(!ts)return'';const d=new Date(ts.replace(' ','T')+(ts.includes('Z')||ts.includes('+')?'':'Z'));const s=Math.floor((Date.now()-d)/1000);if(s<5)return'now';if(s<60)return s+'s';const m=Math.floor(s/60);if(m<60)return m+'m';const h=Math.floor(m/60);if(h<24)return h+'h';return Math.floor(h/24)+'d';}
function hbc(ts){if(!ts)return'dead';const d=new Date(ts.replace(' ','T')+(ts.includes('Z')||ts.includes('+')?'':'Z'));const m=(Date.now()-d)/60000;if(m<2)return'';if(m<10)return'stale';return'dead';}

// Scope visibility check (client-side, for perspective highlighting)
function canSeeScope(scope){
  if(TOKEN_KIND==='room'&&!viewAsAgent)return true;
  const aid=viewAsAgent||AUTH_AGENT;
  if(!aid)return true;
  if(scope.startsWith('_'))return true; // system scopes
  if(scope===aid)return true;
  // check grants
  const ag=agentMap[aid];
  if(ag){try{const g=JSON.parse(ag.grants||'[]');if(g.includes(scope)||g.includes('*'))return true;}catch{}}
  return false;
}

// ============ Tabs ============

function switchTab(name){
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
  const t=document.querySelector('.tab[data-t="'+name+'"]');
  if(t){t.classList.add('active');document.getElementById('p-'+name).classList.add('active');location.hash='tab='+name;}
}
document.querySelectorAll('.tab').forEach(t=>t.addEventListener('click',()=>switchTab(t.dataset.t)));

// ============ JSON renderer ============

function jp(s){if(typeof s!=='string')return s;try{return JSON.parse(s);}catch{return undefined;}}
function jv(v,d,p){
  if(v===null)return'<span class="jnl">null</span>';
  if(v===undefined)return'<span class="jnl">undef</span>';
  if(typeof v==='boolean')return'<span class="jb">'+v+'</span>';
  if(typeof v==='number')return'<span class="jn">'+v+'</span>';
  if(typeof v==='string'){
    if(d<3&&(v[0]==='{'||v[0]==='[')){const i=jp(v);if(i!==undefined&&typeof i==='object')return jv(i,d,p);}
    const x=e(v);return'<span class="js">"'+(x.length>100?x.slice(0,100)+'…':x)+'"</span>';
  }
  if(Array.isArray(v)){
    if(!v.length)return'<span class="jbr">[]</span>';
    const id='j-'+p,o=expanded.has(id);
    let h='<span class="jtog" onclick="tj(\\''+id+'\\')"><span class="jbr">[</span>';
    if(!o)h+='<span class="jcol"> '+v.length+' items </span><span class="jbr">]</span>';
    h+='</span>';
    if(o){h+='<div class="jch">';v.forEach((x,i)=>{h+='<div>'+jv(x,d+1,p+'.'+i)+(i<v.length-1?',':'')+'</div>';});h+='</div><span class="jbr">]</span>';}
    return h;
  }
  if(typeof v==='object'){
    const k=Object.keys(v);if(!k.length)return'<span class="jbr">{}</span>';
    const id='j-'+p,def=d===0&&k.length<=4,o=expanded.has(id)||(def&&!expanded.has(id+':c'));
    let h='<span class="jtog" onclick="tj(\\''+id+'\\','+def+')"><span class="jbr">{</span>';
    if(!o){const pv=k.slice(0,3).map(e).join(', ');h+='<span class="jcol"> '+(k.length>3?pv+'… +'+(k.length-3):pv)+' </span><span class="jbr">}</span>';}
    h+='</span>';
    if(o){h+='<div class="jch">';k.forEach((x,i)=>{h+='<div><span class="jk">'+e(x)+'</span>: '+jv(v[x],d+1,p+'.'+x)+(i<k.length-1?',':'')+'</div>';});h+='</div><span class="jbr">}</span>';}
    return h;
  }
  return e(String(v));
}
function rv(raw,pk){const p=jp(raw);if(p!==undefined&&typeof p==='object'&&p!==null)return'<div class="jv">'+jv(p,0,pk)+'</div>';return'<div class="jv"><span>'+e(raw)+'</span></div>';}
window.tj=function(id,def){if(def){expanded.has(id+':c')?expanded.delete(id+':c'):expanded.add(id+':c');expanded.delete(id);}else{expanded.has(id)?expanded.delete(id):expanded.add(id);}if(lastSt)renderState(lastSt);};

// ============ Render: Agents ============

function renderAgents(a){
  const el=document.getElementById('agents'),c=document.getElementById('c-agents');
  if(!a||!a.length){el.innerHTML='<div class="empty">no agents</div>';c.textContent='0';return;}
  agentMap={};a.forEach(x=>agentMap[x.id]=x);c.textContent=a.length;
  const viewId=viewAsAgent||AUTH_AGENT;
  el.innerHTML=a.map(x=>{
    const sc=x.status||'active',hb=hbc(x.last_heartbeat);
    let grants='';try{const g=JSON.parse(x.grants||'[]');if(g.length)grants='<div class="grants-list">grants: '+g.map(e).join(', ')+'</div>';}catch{}
    const isViewing=viewId&&x.id===viewId;
    return'<div class="card'+(isViewing?' viewing':'')+'"><div><span class="badge bg-'+(sc==='active'?'green':sc==='waiting'?'yellow':sc==='done'?'blue':'red')+'">'+e(sc)+'</span></div>'+
      '<div class="name">'+e(x.name)+'</div><div class="sub">'+e(x.role)+' · '+e(x.id)+'</div>'+
      (x.waiting_on?'<div class="sub" style="color:var(--yellow)">⏳ '+e(x.waiting_on)+'</div>':'')+
      grants+
      '<div class="hb '+hb+'">'+e(rel(x.last_heartbeat))+'</div></div>';
  }).join('');
}

// ============ Render: State ============

function renderState(states){
  const el=document.getElementById('state'),c=document.getElementById('c-state');
  if(!states||!states.length){el.innerHTML='<div class="empty">no state</div>';c.textContent='0';return;}
  c.textContent=states.length;lastSt=states;
  const scopes={};for(const s of states){if(!scopes[s.scope])scopes[s.scope]=[];scopes[s.scope].push(s);}
  const order=Object.keys(scopes).sort((a,b)=>{if(a==='_shared')return-1;if(b==='_shared')return 1;if(a.startsWith('_')&&!b.startsWith('_'))return-1;if(!a.startsWith('_')&&b.startsWith('_'))return 1;return a.localeCompare(b);});
  if(!scopeInit){for(const s of order)if(!s.startsWith('_'))collapsed.add(s);scopeInit=true;}
  let h='';
  for(const scope of order){
    const entries=scopes[scope],ic=collapsed.has(scope);
    const stype=scope==='_shared'?'shared':scope.startsWith('_')?'system':'agent';
    const vis=canSeeScope(scope);
    const privBadge=!vis?'<span class="scope-priv" style="color:var(--red)">🔒 private</span>':'';
    h+='<div class="scope-group" style="'+(vis?'':'opacity:0.4')+'"><div class="scope-hd'+(ic?' closed':'')+'" onclick="ts(\\''+e(scope)+'\\')">'+
      '<span class="arr">▼</span> <span class="sn sn-'+stype+'">'+e(scope)+'</span> <span class="cnt">('+entries.length+')</span>'+privBadge+'</div>'+
      '<div class="scope-bd'+(ic?' hidden':'')+'">';
    for(const s of entries){
      const vk=scope+'.'+s.key,ch=prevVer[vk]!==undefined&&prevVer[vk]!==s.version;
      h+='<div class="s-row'+(ch?' flash':'')+'"><div class="s-key">'+e(s.key)+
        (s.sort_key!=null?'<div class="s-sort">#'+s.sort_key+'</div>':'')+
        (s.timer_effect?'<div class="s-timer">⏱ '+e(s.timer_effect)+(s.timer_expires_at?' · '+e(rel(s.timer_expires_at)):s.timer_ticks_left!=null?' · '+s.timer_ticks_left+' ticks':'')+'</div>':'')+
        (s.enabled_expr?'<div class="s-timer" style="color:var(--purple)">☑ '+e(s.enabled_expr)+'</div>':'')+
        '</div>'+rv(s.value,vk)+'<div class="s-ver">v'+s.version+'</div></div>';
      prevVer[vk]=s.version;
    }
    h+='</div></div>';
  }
  el.innerHTML=h;
}
window.ts=function(s){collapsed.has(s)?collapsed.delete(s):collapsed.add(s);if(lastSt)renderState(lastSt);};

// ============ Render: Messages ============

function renderMessages(msgs){
  const el=document.getElementById('messages'),c=document.getElementById('c-msgs');
  if(!msgs||!msgs.length){el.innerHTML='<div class="empty">no messages</div>';c.textContent='0';return;}
  c.textContent=msgs.length;
  el.innerHTML=msgs.map(m=>{
    let v=m.value;if(typeof v==='string')try{v=JSON.parse(v);}catch{}
    if(typeof v!=='object'||v===null)v={body:String(m.value)};
    const kind=v.kind||'msg',from=v.from||'system',body=typeof v.body==='string'?v.body:JSON.stringify(v.body||v);
    const display=body;
    const ktc=kind==='task'?'kt-task':kind==='action_invocation'?'kt-action_invocation':kind==='result'?'kt-result':'';
    const claimed=v.claimed_by?'<span style="color:var(--green);font-size:10px;margin-left:4px">✓'+e(aname(v.claimed_by))+'</span>':'';
    const mdBody=typeof marked!=='undefined'?marked.parse(display,{breaks:true,gfm:true}):e(display);
    return'<div class="log-row"><div class="log-from" title="'+e(from)+'">'+e(aname(from))+'</div>'+
      '<div class="log-body"><span class="kind-tag '+ktc+'">'+e(kind)+'</span>'+claimed+' <span class="md">'+mdBody+'</span></div>'+
      '<div class="log-meta">#'+e(m.sort_key)+' · '+e(rel(m.updated_at))+'</div></div>';
  }).join('');
  el.scrollTop=el.scrollHeight;
}

// ============ Render: Actions ============

function renderActions(acts){
  const el=document.getElementById('actions'),c=document.getElementById('c-actions');
  if(!acts||!acts.length){el.innerHTML='<div class="empty">no actions registered</div>';c.textContent='0';return;}
  c.textContent=acts.length;
  el.innerHTML=acts.map(a=>{
    const av=a.available!==false;
    let params='';if(a.params){const pk=Object.keys(a.params);if(pk.length)params='<div class="a-params">params: '+pk.map(p=>e(p)+'('+e(a.params[p].type||'?')+')').join(', ')+'</div>';}
    let writes='';if(a.writes&&a.writes.length)writes='<div class="a-writes">→ '+a.writes.map(w=>e(w.scope||'_shared')+(w.append?'[+]':w.merge?'[~]':'')).join(', ')+'</div>';
    return'<div class="action-card"><div class="a-name '+(av?'available':'unavailable')+'">'+
      (av?'● ':'○ ')+e(a.id)+'</div>'+
      (a.description?'<div class="a-desc">'+e(a.description)+'</div>':'')+
      (a.if?'<div class="a-if">if: '+e(a.if)+'</div>':'')+
      params+writes+
      '<div class="a-meta">scope: '+e(a.scope)+' · v'+a.version+(a.registered_by?' · by '+e(a.registered_by):'')+'</div></div>';
  }).join('');
}

// ============ Render: Views ============

function renderViews(vs){
  const el=document.getElementById('views'),c=document.getElementById('c-views');
  if(!vs||!vs.length){el.innerHTML='<div class="empty">no views registered</div>';c.textContent='0';return;}
  c.textContent=vs.length;
  el.innerHTML=vs.map(v=>{
    let valHtml;
    if(v.value&&typeof v.value==='object'&&v.value._error)valHtml='<span style="color:var(--red)">error: '+e(v.value._error)+'</span>';
    else valHtml=jv(v.value,0,'view-'+v.id);
    return'<div class="view-card"><div class="v-name">'+e(v.id)+'</div>'+
      (v.description?'<div class="v-desc">'+e(v.description)+'</div>':'')+
      '<div class="v-expr">'+e(v.expr)+'</div>'+
      '<div class="v-val">→ '+valHtml+'</div>'+
      '<div class="v-meta">scope: '+e(v.scope)+' · v'+v.version+(v.registered_by?' · by '+e(v.registered_by):'')+'</div></div>';
  }).join('');
}

// ============ Render: Audit ============

function renderAudit(entries){
  const el=document.getElementById('audit'),c=document.getElementById('c-audit');
  if(!entries||!entries.length){el.innerHTML='<div class="empty">no audit entries</div>';c.textContent='0';return;}
  c.textContent=entries.length;
  el.innerHTML=entries.map(a=>{
    let v=a.value;if(typeof v==='string')try{v=JSON.parse(v);}catch{}
    if(typeof v!=='object'||v===null)v={action:'?',agent:'?'};
    const action=v.action||'?',agent=v.agent||'system',ok=v.ok!==false;
    const bi=v.builtin?'<span style="color:var(--dim);font-size:10px;margin-left:4px">builtin</span>':'';
    const paramsStr=v.params?Object.entries(v.params).filter(([k,val])=>val!==undefined&&val!==null).map(([k,val])=>e(k)+'='+e(typeof val==='string'?val:JSON.stringify(val))).join(', '):'';
    const display=paramsStr.length>300?paramsStr.slice(0,300)+'…':paramsStr;
    const statusBadge=ok?'<span style="color:var(--green);font-size:10px">✓</span>':'<span style="color:var(--red);font-size:10px">✗</span>';
    const ts=v.ts?v.ts.split('T')[1]?.slice(0,8)||'':'';
    return'<div class="log-row"><div class="log-from" title="'+e(agent)+'">'+statusBadge+' '+e(aname(agent))+'</div>'+
      '<div class="log-body"><span class="kind-tag kt-action_invocation">'+e(action)+'</span>'+bi+' '+e(display)+'</div>'+
      '<div class="log-meta">#'+e(a.sort_key)+' · '+e(ts)+'</div></div>';
  }).join('');
  el.scrollTop=el.scrollHeight;
}

// ============ CEL Console ============

async function runCel(expr){
  const inp=document.getElementById('cel-in'),out=document.getElementById('cel-out');
  const x=expr||inp.value.trim();if(!x)return;inp.value=x;
  out.className='cel-out vis';out.textContent='evaluating…';out.style.color='var(--dim)';
  try{
    const r=await fetch(B+'/rooms/'+R+'/eval',{method:'POST',headers:authHeaders(),body:JSON.stringify({expr:x})});
    const d=await r.json();
    if(d.error){out.className='cel-out vis err';out.textContent=d.detail||d.error;}
    else{out.className='cel-out vis ok';out.textContent=JSON.stringify(d.value,null,2);}
    if(!celH.includes(x)){celH.unshift(x);if(celH.length>12)celH.pop();rch();}
  }catch(err){out.className='cel-out vis err';out.textContent='error: '+err.message;}
}
window.qcel=function(x){document.getElementById('cel-in').value=x;runCel(x);};
window.runCel=runCel;
function rch(){document.getElementById('cel-hist').innerHTML=celH.map(h=>'<button class="cel-hi" title="'+e(h)+'" onclick="qcel(this.title)">'+e(h.length>35?h.slice(0,35)+'…':h)+'</button>').join('');}

// ============ Summary ============

function renderSummary(agents,msgs,states,acts,vs,audit){
  const el=document.getElementById('summary');
  const aa=(agents||[]),ma=(msgs||[]),sa=(states||[]),ac=(acts||[]),vw=(vs||[]),au=(audit||[]);
  const active=aa.filter(a=>a.status==='active').length,waiting=aa.filter(a=>a.status==='waiting').length;
  const scopes=new Set(sa.map(s=>s.scope)).size;
  el.innerHTML=
    '<div class="stat"><span class="n">'+aa.length+'</span> agents</div>'+
    (active?'<div class="stat" style="color:var(--green)"><span class="n">'+active+'</span> active</div>':'')+
    (waiting?'<div class="stat" style="color:var(--yellow)"><span class="n">'+waiting+'</span> waiting</div>':'')+
    '<div class="stat"><span class="n">'+sa.length+'</span> keys / <span class="n">'+scopes+'</span> scopes</div>'+
    '<div class="stat"><span class="n">'+ma.length+'</span> msgs</div>'+
    '<div class="stat" style="color:var(--green)"><span class="n">'+ac.length+'</span> actions</div>'+
    '<div class="stat" style="color:var(--purple)"><span class="n">'+vw.length+'</span> views</div>'+
    (au.length?'<div class="stat" style="color:var(--orange)"><span class="n">'+au.length+'</span> audit</div>':'');
}

// ============ Poll ============

async function poll(){
  if(!TOKEN)return;
  const pu=document.getElementById('pulse'),ps=document.getElementById('pstat');
  try{
    const d=await api('/rooms/'+R+'/poll');
    if(!d)throw new Error('no data');
    const {agents,state,messages,actions,views,audit}=d;
    if(agents)updateIdBar(agents);
    renderAgents(agents);
    if(state)renderState(state);
    renderMessages(messages);
    renderActions(actions);
    renderViews(views);
    renderAudit(audit);
    renderSummary(agents,messages,state,actions,views,audit);
    pu.className='dot';ps.textContent='live';
  }catch(err){pu.className='dot error';ps.textContent='error';console.error(err);}
}

// ============ Boot ============

(async function boot(){
  const stored=getStoredToken();
  if(stored){
    TOKEN=stored;
    // Validate via poll
    try{
      const r=await fetch(B+'/rooms/'+R+'/poll',{headers:{'Authorization':'Bearer '+TOKEN}});
      if(r.ok){const d=await r.json();initSession(d.agents||[]);return;}
    }catch{}
    // Token invalid, clear and show gate
    sessionStorage.removeItem(SK);TOKEN=null;
  }
  // Show auth gate
  document.getElementById('auth-gate').style.display='block';
  document.getElementById('token-input').focus();
})();
</script>
</body>
</html>`;
}