/**
 * device.ts — OAuth Device Authorization (RFC 8628) for sync.
 *
 * Flow:
 *   1. CLI calls POST /auth/device → gets device_code + user_code + verification_uri
 *   2. User opens verification_uri in browser
 *   3. Browser page shows user_code, triggers WebAuthn passkey auth
 *   4. After passkey → redirects to /auth/consent?mode=device for scope selection
 *   5. Unified consent page handles room picker + approve/deny
 *   6. CLI polls POST /auth/device/token → gets access_token + refresh_token
 */

import * as db from "./db.ts";
import { getRpId } from "./webauthn.ts";

function jsonResp(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Cache-Control": "no-store",
    },
  });
}

function getOrigin(req: Request): string {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

const ACCESS_TOKEN_EXPIRY = 3600;

// ═══════════════════════════════════════════════════════════════════
// POST /auth/device — CLI initiates device auth
// ═══════════════════════════════════════════════════════════════════

export async function handleDeviceStart(req: Request): Promise<Response> {
  let body: Record<string, any> = {};
  try { body = await req.json(); } catch {}
  const scope = body.scope ?? "rooms:* create_rooms";
  const clientId = body.client_id ?? null;
  const { deviceCode, userCode } = await db.createDeviceCode(scope, clientId);
  const origin = getOrigin(req);
  return jsonResp({
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: `${origin}/auth/device`,
    verification_uri_complete: `${origin}/auth/device?code=${userCode}`,
    expires_in: 900,
    interval: 5,
  });
}

// ═══════════════════════════════════════════════════════════════════
// GET /auth/device — Code entry + passkey auth page (minimal)
// After passkey auth, redirects to /auth/consent?mode=device
// ═══════════════════════════════════════════════════════════════════

export async function handleDevicePage(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code") ?? "";
  const origin = getOrigin(req);
  const rpId = getRpId(req);
  return new Response(renderDeviceAuthPage(origin, rpId, code), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderDeviceAuthPage(origin: string, rpId: string, prefillCode: string): string {
  // Minimal page: code entry → passkey auth → redirect to unified consent
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize Device — sync</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;background:#0d1117;color:#c9d1d9;min-height:100vh;display:flex;align-items:center;justify-content:center}
  .container{width:100%;max-width:420px;padding:1rem}
  .card{background:#161b22;border:1px solid #21262d;border-radius:12px;padding:2rem}
  h1{font-size:1.4rem;margin-bottom:0.5rem;color:#f0f6fc}
  h1 .dim{color:#484f58;font-weight:400}
  .sub{color:#8b949e;font-size:0.9rem;margin-bottom:1.5rem}
  .code{text-align:center;font-size:2rem;font-family:monospace;letter-spacing:0.15em;font-weight:700;color:#58a6ff;background:#0d1117;border:1px solid #30363d;border-radius:8px;padding:1rem;margin-bottom:1.5rem}
  .step{display:none}.step.active{display:block}
  .ig{margin-bottom:1rem}.ig label{display:block;font-size:0.85rem;color:#8b949e;margin-bottom:0.4rem}
  .ig input{width:100%;padding:0.7rem;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#f0f6fc;font-size:1.1rem;text-align:center;letter-spacing:0.1em;text-transform:uppercase}
  .ig input:focus{outline:none;border-color:#58a6ff}
  button{width:100%;padding:0.75rem;border:none;border-radius:6px;font-size:0.95rem;font-weight:600;cursor:pointer;font-family:inherit}
  .bp{background:#238636;color:#fff}.bp:hover{background:#2ea043}
  .bd{background:#da3633;color:#fff;margin-top:0.5rem}
  .bs{background:#21262d;color:#c9d1d9;margin-top:0.5rem}
  .st{text-align:center;padding:1rem 0}
  .st .icon{font-size:3rem;margin-bottom:0.5rem}
  .st.ok{color:#3fb950}.st.err{color:#f85149}
  .scope-info{background:#0d1117;border:1px solid #30363d;border-radius:6px;padding:0.5rem 0.75rem;font-size:0.8rem;color:#8b949e;margin-bottom:1rem}
  .scope-info strong{color:#c9d1d9}
</style>
</head>
<body>
<div class="container"><div class="card">
  <div class="step active" id="s-code">
    <h1>sync<span class="dim">·device</span></h1>
    <p class="sub">A device is requesting access to your sync account.</p>
    <div id="entry" style="${prefillCode ? "display:none" : ""}">
      <div class="ig"><label>Enter the code shown on your device</label>
      <input type="text" id="code-in" placeholder="XXXX-XXXX" maxlength="9" autocomplete="off" value="${esc(prefillCode)}"></div>
      <button class="bp" onclick="lookup()">Continue</button>
    </div>
    <div id="confirm" style="${prefillCode ? "" : "display:none"}">
      <div class="code" id="code-show">${esc(prefillCode)}</div>
      <div class="scope-info" id="scope-info" style="display:none"><strong>Requesting:</strong> <span id="scope-text"></span></div>
      <button class="bp" onclick="auth()">Authenticate with passkey</button>
      <button class="bd" onclick="doDeny()">Deny</button>
    </div>
  </div>
  <div class="step" id="s-auth"><div class="st"><div class="icon">🔐</div><p>Waiting for passkey...</p></div></div>
  <div class="step" id="s-err"><div class="st err"><div class="icon">✗</div><h1>Failed</h1><p id="err-msg" style="margin-top:0.5rem"></p></div><button class="bs" onclick="show('s-code')">Try Again</button></div>
  <div class="step" id="s-denied"><div class="st"><div class="icon">🚫</div><h1>Access Denied</h1><p style="margin-top:0.5rem;color:#8b949e">The device will be notified.</p></div></div>
</div></div>
<script type="module">
import{startAuthentication}from"https://esm.sh/@simplewebauthn/browser@13";
const O=${JSON.stringify(origin)},RP=${JSON.stringify(rpId)};
let dc=null,scope="";
function show(id){document.querySelectorAll(".step").forEach(s=>s.classList.remove("active"));document.getElementById(id).classList.add("active")}
function desc(s){return s.split(/\\s+/).filter(Boolean).map(i=>{
  if(i==="create_rooms")return"Create rooms";if(i==="rooms:*")return"All rooms";
  if(i.includes(":agent:"))return"Agent "+i.split(":")[3]+" in "+i.split(":")[1];
  if(i.endsWith(":read"))return i.split(":")[1]+" (read)";
  if(i.startsWith("rooms:"))return i.split(":")[1];return i}).join(", ")}
window.lookup=async function(){
  const inp=document.getElementById("code-in"),c=inp.value.trim().toUpperCase();
  if(!c||c.length<8){inp.style.borderColor="#f85149";return}
  try{const r=await fetch(O+"/auth/device/lookup",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({user_code:c})});
  const d=await r.json();if(d.error){inp.style.borderColor="#f85149";return}
  dc=d.device_code;scope=d.scope;document.getElementById("code-show").textContent=c;
  document.getElementById("scope-text").textContent=desc(scope);document.getElementById("scope-info").style.display="block";
  document.getElementById("entry").style.display="none";document.getElementById("confirm").style.display="block";
  }catch{inp.style.borderColor="#f85149"}}
if(${JSON.stringify(!!prefillCode)}){(async()=>{try{const r=await fetch(O+"/auth/device/lookup",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({user_code:${JSON.stringify(prefillCode)}})});const d=await r.json();if(!d.error){dc=d.device_code;scope=d.scope;document.getElementById("scope-text").textContent=desc(scope);document.getElementById("scope-info").style.display="block"}}catch{}})()}
window.auth=async function(){if(!dc)return;show("s-auth");try{
  const or=await fetch(O+"/webauthn/authenticate/options",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({rpId:RP})});
  const od=await or.json();if(od.error)throw new Error(od.error);
  const ar=await startAuthentication({optionsJSON:od.options});
  const vr=await fetch(O+"/webauthn/authenticate/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({challengeId:od.challengeId,response:ar})});
  const vd=await vr.json();if(!vd.verified)throw new Error("Verification failed");
  // Redirect to unified consent page
  const u=new URL(O+"/auth/consent");u.searchParams.set("mode","device");u.searchParams.set("session_id",vd.sessionId);u.searchParams.set("device_code",dc);u.searchParams.set("scope",scope);
  window.location.href=u.toString();
}catch(e){document.getElementById("err-msg").textContent=e.message||"Authentication failed";show("s-err")}}
window.doDeny=async function(){if(dc){await fetch(O+"/auth/device/deny",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({device_code:dc})}).catch(()=>{})}show("s-denied")}
</script>
</body></html>`;
}

// ═══════════════════════════════════════════════════════════════════
// POST /auth/device/lookup
// ═══════════════════════════════════════════════════════════════════

export async function handleDeviceLookup(req: Request): Promise<Response> {
  const { user_code } = await req.json();
  if (!user_code) return jsonResp({ error: "user_code required" }, 400);
  const code = await db.getDeviceCodeByUserCode(user_code.toUpperCase());
  if (!code) return jsonResp({ error: "not_found" }, 404);
  if (code.status !== "pending") return jsonResp({ error: "already_used" }, 409);
  return jsonResp({ device_code: code.deviceCode, scope: code.scope, user_code: code.userCode });
}

// ═══════════════════════════════════════════════════════════════════
// POST /auth/device/approve (kept for backward compat — consent page uses /auth/consent/approve)
// ═══════════════════════════════════════════════════════════════════

export async function handleDeviceApprove(req: Request): Promise<Response> {
  const { device_code, session_id, user_code, scope: narrowedScope } = await req.json();
  if (!session_id) return jsonResp({ error: "session_id required" }, 400);
  const session = await db.validateSession(session_id);
  if (!session) return jsonResp({ error: "invalid_session" }, 401);
  let dc;
  if (device_code) dc = await db.getDeviceCode(device_code);
  else if (user_code) dc = await db.getDeviceCodeByUserCode(user_code);
  if (!dc) return jsonResp({ error: "not_found" }, 404);
  if (dc.status !== "pending") return jsonResp({ error: "already_processed" }, 409);
  if (narrowedScope && typeof narrowedScope === "string" && narrowedScope.trim()) {
    await db.updateDeviceCodeScope(dc.deviceCode, narrowedScope.trim());
  }
  const ok = await db.approveDeviceCode(dc.deviceCode, session.userId);
  if (!ok) return jsonResp({ error: "approval_failed" }, 500);
  await db.deleteSession(session_id);
  return jsonResp({ approved: true, device_code: dc.deviceCode });
}

// ═══════════════════════════════════════════════════════════════════
// POST /auth/device/deny
// ═══════════════════════════════════════════════════════════════════

export async function handleDeviceDeny(req: Request): Promise<Response> {
  const { device_code } = await req.json();
  if (!device_code) return jsonResp({ error: "device_code required" }, 400);
  await db.denyDeviceCode(device_code);
  return jsonResp({ denied: true });
}

// ═══════════════════════════════════════════════════════════════════
// POST /auth/device/token — CLI polls for token
// ═══════════════════════════════════════════════════════════════════

export async function handleDeviceToken(req: Request): Promise<Response> {
  let body: Record<string, any>;
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/x-www-form-urlencoded")) {
    body = Object.fromEntries(new URLSearchParams(await req.text()));
  } else {
    body = await req.json();
  }
  const deviceCode = body.device_code;
  if (!deviceCode) return jsonResp({ error: "invalid_request", error_description: "device_code required" }, 400);
  const dc = await db.getDeviceCode(deviceCode);
  if (!dc) return jsonResp({ error: "invalid_grant", error_description: "Unknown device code" }, 400);
  if (new Date(dc.expiresAt) < new Date()) return jsonResp({ error: "expired_token" }, 400);
  switch (dc.status) {
    case "pending": return jsonResp({ error: "authorization_pending" });
    case "denied": return jsonResp({ error: "access_denied" }, 403);
    case "consumed": return jsonResp({ error: "invalid_grant", error_description: "Already consumed" }, 400);
    case "approved": {
      const consumed = await db.consumeDeviceCode(deviceCode);
      if (!consumed) return jsonResp({ error: "server_error" }, 500);
      const result = await db.mintToken({
        userId: consumed.approvedBy, scope: consumed.scope,
        label: "Device auth", clientId: dc.clientId ?? "cli",
        expiresInSec: ACCESS_TOKEN_EXPIRY, withRefresh: true,
      });
      return jsonResp({
        access_token: result.token, token_type: "Bearer",
        expires_in: ACCESS_TOKEN_EXPIRY, refresh_token: result.refreshToken,
        scope: consumed.scope,
      });
    }
    default: return jsonResp({ error: "server_error" }, 500);
  }
}
