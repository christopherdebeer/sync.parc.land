/** @jsxImportSource https://esm.sh/react@18.2.0 */
import { useState, useCallback, useMemo } from "https://esm.sh/react@18.2.0";
import { styled, keyframes } from "../../styled.ts";
import { JsonView } from "../JsonView.tsx";
import { aname, rel, tryParseJson } from "../../utils.ts";
import { inferSurfaceType, inferArrayColumns, resolveColumns } from "../../renderInference.ts";
import type {
  Surface, SurfaceMetric, SurfaceViewGrid, SurfaceViewTable, SurfaceArrayTable,
  SurfaceActionBar, SurfaceActionForm, SurfaceActionChoice,
  SurfaceFeed, SurfaceWatch, SurfaceSection, SurfaceMarkdown,
  Action, View, RawMessage, StateRow, Agent, PollData,
} from "../../types.ts";

// ── Shared styles ───────────────────────────────────────────────────────────

const SurfaceWrap = styled.div`margin-bottom: 0.75rem;`;

const SectionWrap = styled.div`
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.75rem;
  margin-bottom: 0.75rem;
`;

const SectionLabel = styled.div`
  font-size: 11px;
  color: var(--dim);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.5rem;
  font-weight: 600;
`;

const SurfaceLabel = styled.div`
  font-size: 10px;
  color: var(--dim);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-bottom: 4px;
`;

// ── Metric ──────────────────────────────────────────────────────────────────

const MetricCard = styled.div`
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.75rem 1rem;
`;

const MetricValue = styled.div`
  font-size: 22px;
  font-weight: 700;
  color: var(--fg);
  word-break: break-word;
  line-height: 1.3;
`;

const MetricError = styled.span`color: var(--red); font-size: 13px;`;

function MetricSurface({ surface, views }: { surface: SurfaceMetric; views: View[] }) {
  const view = views.find(v => v.id === surface.view);
  if (!view) return null;

  const label = surface.label || view.description || view.id;
  let display: any;
  if (view.value && typeof view.value === "object" && view.value._error) {
    display = <MetricError>error</MetricError>;
  } else if (typeof view.value === "number" || typeof view.value === "boolean" || typeof view.value === "string") {
    display = String(view.value);
  } else {
    display = <JsonView value={view.value} path={`metric-${surface.id}`} />;
  }

  return (
    <SurfaceWrap>
      <MetricCard>
        <SurfaceLabel>{label}</SurfaceLabel>
        <MetricValue>{display}</MetricValue>
      </MetricCard>
    </SurfaceWrap>
  );
}

// ── View Grid ───────────────────────────────────────────────────────────────

const VGrid = styled.div`display: flex; gap: 0.5rem; flex-wrap: wrap;`;
const VGridCard = styled.div`
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.5rem 0.7rem;
  flex: 1 1 120px;
  min-width: 100px;
`;
const VGridLabel = styled.div`
  font-size: 10px;
  color: var(--dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;
const VGridValue = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: var(--fg);
  word-break: break-word;
`;

function ViewGridSurface({ surface, views }: { surface: SurfaceViewGrid; views: View[] }) {
  const viewMap = new Map(views.map(v => [v.id, v]));
  const resolved = surface.views.map(id => viewMap.get(id)).filter((v): v is View => !!v);
  if (!resolved.length) return null;

  return (
    <SurfaceWrap>
      {surface.label && <SurfaceLabel>{surface.label}</SurfaceLabel>}
      <VGrid>
        {resolved.map(v => (
          <VGridCard key={v.id}>
            <VGridLabel title={v.description || v.id}>{v.description || v.id}</VGridLabel>
            <VGridValue>
              {v.value && typeof v.value === "object" && v.value._error
                ? <span style={{ color: "var(--red)", fontSize: 11 }}>err</span>
                : typeof v.value === "number" || typeof v.value === "boolean" || typeof v.value === "string"
                  ? String(v.value)
                  : <JsonView value={v.value} path={`vgrid-${v.id}`} />
              }
            </VGridValue>
          </VGridCard>
        ))}
      </VGrid>
    </SurfaceWrap>
  );
}

// ── View Table ──────────────────────────────────────────────────────────────

const VTable = styled.div`
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
`;
const VTRow = styled.div`
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 0.5rem;
  padding: 0.35rem 0.6rem;
  font-size: 12px;
  border-bottom: 1px solid var(--border);
  &:last-child { border-bottom: none; }
  @media (max-width: 480px) {
    grid-template-columns: 1fr;
    gap: 2px;
  }
`;
const VTLabel = styled.div`color: var(--dim); font-size: 11px;`;
const VTValue = styled.div`color: var(--fg); font-weight: 500; word-break: break-word;`;

function ViewTableSurface({ surface, views }: { surface: SurfaceViewTable; views: View[] }) {
  const viewMap = new Map(views.map(v => [v.id, v]));
  const resolved = surface.views.map(id => viewMap.get(id)).filter((v): v is View => !!v);
  if (!resolved.length) return null;

  return (
    <SurfaceWrap>
      {surface.label && <SurfaceLabel>{surface.label}</SurfaceLabel>}
      <VTable>
        {resolved.map(v => (
          <VTRow key={v.id}>
            <VTLabel>{v.description || v.id}</VTLabel>
            <VTValue>
              {v.value && typeof v.value === "object" && v.value._error
                ? <span style={{ color: "var(--red)" }}>error</span>
                : typeof v.value === "number" || typeof v.value === "boolean" || typeof v.value === "string"
                  ? String(v.value)
                  : <JsonView value={v.value} path={`vtable-${v.id}`} />
              }
            </VTValue>
          </VTRow>
        ))}
      </VTable>
    </SurfaceWrap>
  );
}

// ── Action Bar ──────────────────────────────────────────────────────────────

const ABar = styled.div`
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
  align-items: flex-start;
`;

const ABarBtn = styled.button<{ $available: boolean; $active?: boolean }>`
  background: ${p => !p.$available ? "var(--border)" : p.$active ? "var(--accent)" : "var(--green)"};
  color: ${p => !p.$available ? "var(--dim)" : "var(--bg)"};
  border: none;
  border-radius: 5px;
  padding: 0.4rem 0.9rem;
  cursor: ${p => p.$available ? "pointer" : "not-allowed"};
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  &:hover { opacity: ${p => p.$available ? 0.85 : 1}; }
`;

const ABarFormWrap = styled.div`
  width: 100%;
  margin-top: 4px;
  padding: 8px 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
`;

const ABarParamRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-size: 11px;
`;

const ABarParamLabel = styled.label`color: var(--accent); font-weight: 600; min-width: 60px;`;
const ABarParamInput = styled.input`
  flex: 1;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 3px 6px;
  color: var(--fg);
  font-family: inherit;
  font-size: 11px;
  outline: none;
  min-width: 0;
  &:focus { border-color: var(--accent); }
`;
const ABarParamSelect = styled.select`
  flex: 1;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 3px 6px;
  color: var(--fg);
  font-family: inherit;
  font-size: 11px;
  outline: none;
  min-width: 0;
  &:focus { border-color: var(--accent); }
`;

const ABarActions = styled.div`display: flex; gap: 6px; margin-top: 6px;`;
const ABarSend = styled.button`
  background: var(--green); color: var(--bg); border: none; border-radius: 4px;
  padding: 3px 10px; cursor: pointer; font-family: inherit; font-size: 11px; font-weight: 600;
  &:hover { opacity: 0.85; }
  &:disabled { background: var(--border); color: var(--dim); cursor: not-allowed; }
`;
const ABarCancel = styled.button`
  background: none; border: 1px solid var(--border); border-radius: 4px;
  padding: 3px 8px; cursor: pointer; font-family: inherit; font-size: 11px; color: var(--dim);
  &:hover { color: var(--fg); }
`;

const flash = keyframes`from { background: rgba(63,185,80,0.15); } to { background: transparent; }`;
const ResultBox = styled.div<{ $error?: boolean }>`
  margin-top: 6px; padding: 4px 8px; border-radius: 3px; font-size: 11px;
  white-space: pre-wrap; word-break: break-word; max-height: 100px; overflow-y: auto;
  color: ${p => p.$error ? "var(--red)" : "var(--green)"};
  background: ${p => p.$error ? "rgba(248,81,73,0.08)" : "rgba(63,185,80,0.08)"};
  animation: ${flash} 0.5s ease-out;
`;

const ABarDesc = styled.div`
  font-size: 11px; color: var(--dim); padding: 2px 0; font-style: italic;
`;

function ActionBarSurface({ surface, actions, roomId, baseUrl, authHeaders }: {
  surface: SurfaceActionBar;
  actions: Action[];
  roomId: string;
  baseUrl: string;
  authHeaders: () => Record<string, string>;
}) {
  const actionMap = new Map(actions.map(a => [a.id, a]));
  const resolved = surface.actions.map(id => actionMap.get(id)).filter((a): a is Action => !!a && a.available !== false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const openForm = useCallback((action: Action) => {
    if (expandedId === action.id) {
      setExpandedId(null);
      return;
    }
    const defaults: Record<string, string> = {};
    for (const [k, def] of Object.entries(action.params || {})) {
      if (def.enum?.length) defaults[k] = String(def.enum[0]);
      else defaults[k] = "";
    }
    setParams(defaults);
    setResult(null);
    setExpandedId(action.id);
  }, [expandedId]);

  const doInvoke = useCallback(async (action: Action) => {
    setSending(true);
    setResult(null);
    try {
      const coerced: Record<string, any> = {};
      const paramDefs = action.params || {};
      for (const [k, v] of Object.entries(params)) {
        if (v === "" || v === undefined) continue;
        const def = paramDefs[k];
        if (def?.type === "number") { const n = Number(v); coerced[k] = isNaN(n) ? v : n; }
        else if (def?.type === "boolean") { coerced[k] = v === "true"; }
        else if (def?.type === "object" || def?.type === "array" || def?.type === "any") {
          try { coerced[k] = JSON.parse(v); } catch { coerced[k] = v; }
        } else { coerced[k] = v; }
      }
      const r = await fetch(`${baseUrl}/rooms/${roomId}/actions/${action.id}/invoke`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ params: coerced }),
      });
      const d = await r.json();
      if (d.error) {
        setResult({ ok: false, text: d.message || d.error + (d.detail ? `: ${d.detail}` : "") });
      } else {
        setResult({ ok: true, text: d.result !== undefined
          ? `✓ ${typeof d.result === "string" ? d.result : JSON.stringify(d.result, null, 2)}`
          : "✓ invoked" });
        // Auto-close on success for no-param actions
        if (!Object.keys(paramDefs).length) {
          setTimeout(() => { setExpandedId(null); setResult(null); }, 1200);
        }
      }
    } catch (e: any) {
      setResult({ ok: false, text: e.message });
    } finally {
      setSending(false);
    }
  }, [params, roomId, baseUrl, authHeaders]);

  if (!resolved.length) return null;

  const expandedAction = expandedId ? actionMap.get(expandedId) : null;

  return (
    <SurfaceWrap>
      {surface.label && <SurfaceLabel>{surface.label}</SurfaceLabel>}
      <ABar>
        {resolved.map(a => {
          const av = a.available !== false;
          const hasParams = Object.keys(a.params || {}).length > 0;
          return (
            <ABarBtn
              key={a.id}
              $available={av}
              $active={expandedId === a.id}
              title={a.description || a.id}
              onClick={() => {
                if (!av) return;
                if (hasParams) {
                  openForm(a);
                } else {
                  // Direct invoke for no-param actions
                  openForm(a);
                  // We'll invoke after form opens with empty params
                }
              }}
            >
              {a.description || a.id}
            </ABarBtn>
          );
        })}
      </ABar>
      {expandedAction && (() => {
        const paramDefs = expandedAction.params || {};
        const paramKeys = Object.keys(paramDefs);
        const hasParams = paramKeys.length > 0;
        return (
          <ABarFormWrap>
            {expandedAction.description && expandedId !== null && hasParams && (
              <ABarDesc>{expandedAction.description}</ABarDesc>
            )}
            {hasParams ? paramKeys.map(k => {
              const def = paramDefs[k];
              return (
                <ABarParamRow key={k}>
                  <ABarParamLabel>{k}</ABarParamLabel>
                  {def.enum ? (
                    <ABarParamSelect value={params[k] || ""} onChange={e => setParams(p => ({ ...p, [k]: e.target.value }))}>
                      {def.enum.map((v: any) => <option key={String(v)} value={String(v)}>{String(v)}</option>)}
                    </ABarParamSelect>
                  ) : (
                    <ABarParamInput
                      type="text"
                      placeholder={def.description || def.type || "value"}
                      value={params[k] || ""}
                      onChange={e => setParams(p => ({ ...p, [k]: e.target.value }))}
                      onKeyDown={e => e.key === "Enter" && doInvoke(expandedAction)}
                      spellCheck={false}
                    />
                  )}
                </ABarParamRow>
              );
            }) : null}
            <ABarActions>
              <ABarSend onClick={() => doInvoke(expandedAction)} disabled={sending}>
                {sending ? "…" : hasParams ? "send" : "confirm"}
              </ABarSend>
              <ABarCancel onClick={() => { setExpandedId(null); setResult(null); }}>cancel</ABarCancel>
            </ABarActions>
            {result && <ResultBox $error={!result.ok}>{result.text}</ResultBox>}
          </ABarFormWrap>
        );
      })()}
    </SurfaceWrap>
  );
}

// ── Action Form (single action, always expanded) ────────────────────────────

const AFormCard = styled.div`
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.75rem 1rem;
`;
const AFormTitle = styled.div`font-size: 13px; font-weight: 600; color: var(--green); margin-bottom: 2px;`;
const AFormDesc = styled.div`font-size: 11px; color: var(--dim); margin-bottom: 8px;`;
const AFormUnavail = styled.div`font-size: 11px; color: var(--dim); font-style: italic; padding: 0.5rem 0;`;

function ActionFormSurface({ surface, actions, roomId, baseUrl, authHeaders }: {
  surface: SurfaceActionForm;
  actions: Action[];
  roomId: string;
  baseUrl: string;
  authHeaders: () => Record<string, string>;
}) {
  const action = actions.find(a => a.id === surface.action);
  if (!action) return null;

  const av = action.available !== false;
  const paramDefs = action.params || {};
  const paramKeys = Object.keys(paramDefs);

  const [params, setParams] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    for (const [k, def] of Object.entries(paramDefs)) {
      if (def.enum?.length) defaults[k] = String(def.enum[0]);
      else defaults[k] = "";
    }
    return defaults;
  });
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const doInvoke = useCallback(async () => {
    setSending(true);
    setResult(null);
    try {
      const coerced: Record<string, any> = {};
      for (const [k, v] of Object.entries(params)) {
        if (v === "" || v === undefined) continue;
        const def = paramDefs[k];
        if (def?.type === "number") { const n = Number(v); coerced[k] = isNaN(n) ? v : n; }
        else if (def?.type === "boolean") { coerced[k] = v === "true"; }
        else if (def?.type === "object" || def?.type === "array" || def?.type === "any") {
          try { coerced[k] = JSON.parse(v); } catch { coerced[k] = v; }
        } else { coerced[k] = v; }
      }
      const r = await fetch(`${baseUrl}/rooms/${roomId}/actions/${action.id}/invoke`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ params: coerced }),
      });
      const d = await r.json();
      if (d.error) {
        setResult({ ok: false, text: d.message || d.error + (d.detail ? `: ${d.detail}` : "") });
      } else {
        setResult({ ok: true, text: d.result !== undefined
          ? `✓ ${typeof d.result === "string" ? d.result : JSON.stringify(d.result, null, 2)}`
          : "✓ invoked" });
        // Clear text inputs on success
        const cleared: Record<string, string> = {};
        for (const [k, def] of Object.entries(paramDefs)) {
          if (def.enum?.length) cleared[k] = String(def.enum[0]);
          else cleared[k] = "";
        }
        setParams(cleared);
      }
    } catch (e: any) {
      setResult({ ok: false, text: e.message });
    } finally {
      setSending(false);
    }
  }, [params, paramDefs, action.id, roomId, baseUrl, authHeaders]);

  const label = surface.label || action.description || action.id;

  return (
    <SurfaceWrap>
      <AFormCard>
        <AFormTitle>{label}</AFormTitle>
        {action.description && surface.label && <AFormDesc>{action.description}</AFormDesc>}
        {!av && <AFormUnavail>Currently unavailable</AFormUnavail>}
        {av && (
          <>
            {paramKeys.map(k => {
              const def = paramDefs[k];
              return (
                <ABarParamRow key={k}>
                  <ABarParamLabel>{k}</ABarParamLabel>
                  {def.enum ? (
                    <ABarParamSelect value={params[k] || ""} onChange={e => setParams(p => ({ ...p, [k]: e.target.value }))}>
                      {def.enum.map((v: any) => <option key={String(v)} value={String(v)}>{String(v)}</option>)}
                    </ABarParamSelect>
                  ) : (
                    <ABarParamInput
                      type="text"
                      placeholder={def.description || def.type || "value"}
                      value={params[k] || ""}
                      onChange={e => setParams(p => ({ ...p, [k]: e.target.value }))}
                      onKeyDown={e => e.key === "Enter" && doInvoke()}
                      spellCheck={false}
                    />
                  )}
                </ABarParamRow>
              );
            })}
            <ABarActions>
              <ABarSend onClick={doInvoke} disabled={sending}>
                {sending ? "…" : "send"}
              </ABarSend>
            </ABarActions>
          </>
        )}
        {result && <ResultBox $error={!result.ok}>{result.text}</ResultBox>}
      </AFormCard>
    </SurfaceWrap>
  );
}

// ── Action Choice (mutually exclusive buttons) ──────────────────────────────

const ChoiceWrap = styled.div`
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.6rem 0.8rem;
`;
const ChoiceRow = styled.div`display: flex; gap: 0.4rem; flex-wrap: wrap;`;
const ChoiceBtn = styled.button<{ $available: boolean }>`
  flex: 1 1 0;
  min-width: 80px;
  background: ${p => p.$available ? "var(--surface2)" : "var(--border)"};
  color: ${p => p.$available ? "var(--fg)" : "var(--dim)"};
  border: 1px solid ${p => p.$available ? "var(--accent)" : "var(--border)"};
  border-radius: 6px;
  padding: 0.5rem 0.75rem;
  cursor: ${p => p.$available ? "pointer" : "not-allowed"};
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  text-align: center;
  &:hover { background: ${p => p.$available ? "rgba(88,166,255,0.1)" : "var(--border)"}; }
`;
const ChoiceDesc = styled.div`font-size: 10px; color: var(--dim); margin-top: 2px;`;

function ActionChoiceSurface({ surface, actions, roomId, baseUrl, authHeaders }: {
  surface: SurfaceActionChoice;
  actions: Action[];
  roomId: string;
  baseUrl: string;
  authHeaders: () => Record<string, string>;
}) {
  const actionMap = new Map(actions.map(a => [a.id, a]));
  const resolved = surface.actions.map(id => actionMap.get(id)).filter((a): a is Action => !!a);
  const [sending, setSending] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const invoke = useCallback(async (action: Action) => {
    if (Object.keys(action.params || {}).length > 0) return; // Can't quick-invoke with params
    setSending(action.id);
    setResult(null);
    try {
      const r = await fetch(`${baseUrl}/rooms/${roomId}/actions/${action.id}/invoke`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ params: {} }),
      });
      const d = await r.json();
      if (d.error) setResult({ ok: false, text: d.message || d.error });
      else setResult({ ok: true, text: `✓ ${action.description || action.id}` });
    } catch (e: any) {
      setResult({ ok: false, text: e.message });
    } finally {
      setSending(null);
    }
  }, [roomId, baseUrl, authHeaders]);

  if (!resolved.length) return null;

  return (
    <SurfaceWrap>
      {surface.label && <SurfaceLabel>{surface.label}</SurfaceLabel>}
      <ChoiceWrap>
        <ChoiceRow>
          {resolved.map(a => (
            <ChoiceBtn
              key={a.id}
              $available={a.available !== false}
              onClick={() => a.available !== false && invoke(a)}
              disabled={sending !== null}
            >
              {sending === a.id ? "…" : (a.description || a.id)}
              {a.if && <ChoiceDesc>{a.available === false ? "locked" : ""}</ChoiceDesc>}
            </ChoiceBtn>
          ))}
        </ChoiceRow>
        {result && <ResultBox $error={!result.ok}>{result.text}</ResultBox>}
      </ChoiceWrap>
    </SurfaceWrap>
  );
}

// ── Feed (filtered messages + optional compose) ─────────────────────────────

const FeedWrap = styled.div`
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
`;
const FeedLog = styled.div`
  max-height: 300px;
  overflow-y: auto;
  padding: 2px 0;
`;
const FeedRow = styled.div`
  display: grid;
  grid-template-columns: 80px 1fr auto;
  gap: 0.4rem;
  padding: 3px 8px;
  font-size: 12px;
  &:hover { background: var(--surface2); }
  @media (max-width: 480px) {
    grid-template-columns: 1fr;
    gap: 2px;
    padding: 4px 8px;
  }
`;
const FeedFrom = styled.div`color: var(--accent); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`;
const FeedBody = styled.div`color: var(--fg); word-break: break-word; min-width: 0;`;
const FeedMeta = styled.div`color: var(--dim); font-size: 10px; white-space: nowrap; text-align: right;`;
const FeedKind = styled.span<{ $kind: string }>`
  display: inline-block;
  background: ${p => p.$kind === "task" ? "rgba(210,153,34,0.2)" : p.$kind === "result" ? "rgba(63,185,80,0.2)" : "var(--border)"};
  color: ${p => p.$kind === "task" ? "var(--yellow)" : p.$kind === "result" ? "var(--green)" : "var(--dim)"};
  border-radius: 2px; padding: 0 4px; font-size: 10px; margin-right: 4px;
`;
const FeedEmpty = styled.div`color: var(--dim); font-style: italic; padding: 0.75rem; text-align: center; font-size: 12px;`;
const FeedCompose = styled.div`
  display: flex; gap: 0.4rem; padding: 0.4rem 0.5rem;
  border-top: 1px solid var(--border);
`;
const FeedInput = styled.input`
  flex: 1; min-width: 0;
  background: var(--bg); border: 1px solid var(--border); border-radius: 4px;
  padding: 0.3rem 0.5rem; color: var(--fg); font-family: inherit; font-size: 12px; outline: none;
  &:focus { border-color: var(--accent); }
`;
const FeedSendBtn = styled.button`
  background: var(--accent); color: var(--bg); border: none; border-radius: 4px;
  padding: 0.3rem 0.7rem; cursor: pointer; font-family: inherit; font-size: 12px; font-weight: 600;
  white-space: nowrap;
  &:hover { opacity: 0.85; }
  &:disabled { background: var(--border); color: var(--dim); cursor: not-allowed; }
`;

function FeedSurface({ surface, messages, agentMap, roomId, baseUrl, authHeaders }: {
  surface: SurfaceFeed;
  messages: RawMessage[];
  agentMap: Record<string, Agent>;
  roomId: string;
  baseUrl: string;
  authHeaders: () => Record<string, string>;
}) {
  const filtered = useMemo(() => {
    if (!surface.kinds?.length) return messages;
    const allowed = new Set(surface.kinds);
    return messages.filter(m => {
      let v = tryParseJson(m.value);
      if (typeof v !== "object" || v === null) v = { body: String(m.value) };
      return allowed.has(v.kind || "msg");
    });
  }, [messages, surface.kinds]);

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const send = useCallback(async () => {
    const body = text.trim();
    if (!body) return;
    setSending(true);
    try {
      await fetch(`${baseUrl}/rooms/${roomId}/actions/_send_message/invoke`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ params: { body, kind: surface.kinds?.[0] || "chat" } }),
      });
      setText("");
    } catch {}
    setSending(false);
  }, [text, roomId, baseUrl, authHeaders, surface.kinds]);

  return (
    <SurfaceWrap>
      {surface.label && <SurfaceLabel>{surface.label}</SurfaceLabel>}
      <FeedWrap>
        {!filtered.length && <FeedEmpty>no messages</FeedEmpty>}
        {filtered.length > 0 && (
          <FeedLog>
            {filtered.map(m => {
              let v = tryParseJson(m.value);
              if (typeof v !== "object" || v === null) v = { body: String(m.value) };
              const kind = v.kind || "msg";
              const from = v.from || "system";
              const body = typeof v.body === "string" ? v.body : JSON.stringify(v.body || v);
              return (
                <FeedRow key={m.sort_key}>
                  <FeedFrom title={from}>{aname(from, agentMap)}</FeedFrom>
                  <FeedBody>
                    <FeedKind $kind={kind}>{kind}</FeedKind>
                    <span dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
                  </FeedBody>
                  <FeedMeta>{rel(m.updated_at)}</FeedMeta>
                </FeedRow>
              );
            })}
          </FeedLog>
        )}
        {surface.compose !== false && (
          <FeedCompose>
            <FeedInput
              type="text"
              placeholder={`send ${surface.kinds?.[0] || "message"}…`}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => e.key === "Enter" && !sending && send()}
              spellCheck={false}
            />
            <FeedSendBtn onClick={send} disabled={sending || !text.trim()}>
              {sending ? "…" : "send"}
            </FeedSendBtn>
          </FeedCompose>
        )}
      </FeedWrap>
    </SurfaceWrap>
  );
}

function renderMarkdown(text: string): string {
  if (typeof (globalThis as any).marked !== "undefined") {
    return (globalThis as any).marked.parse(text, { breaks: true, gfm: true });
  }
  const d = document.createElement("div");
  d.textContent = text;
  return d.innerHTML.replace(/\n/g, "<br>");
}

// ── Watch (specific state keys) ─────────────────────────────────────────────

const WatchWrap = styled.div`
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
`;
const WatchRow = styled.div`
  display: grid;
  grid-template-columns: 120px 1fr;
  gap: 0.5rem;
  padding: 0.3rem 0.5rem;
  font-size: 12px;
  border-bottom: 1px solid var(--border);
  &:last-child { border-bottom: none; }
`;
const WatchKey = styled.div`color: var(--green); font-weight: 500; word-break: break-word;`;
const WatchValue = styled.div`color: var(--fg); word-break: break-word;`;

function WatchSurface({ surface, state }: { surface: SurfaceWatch; state: StateRow[] }) {
  const resolved = surface.keys.map((k: any) => {
    const scope = typeof k === "string" ? "_shared" : k.scope;
    const key = typeof k === "string" ? k : k.key;
    return state.find(s => s.scope === scope && s.key === key);
  }).filter((s): s is StateRow => !!s);

  if (!resolved.length) return null;

  return (
    <SurfaceWrap>
      {surface.label && <SurfaceLabel>{surface.label}</SurfaceLabel>}
      <WatchWrap>
        {resolved.map(s => (
          <WatchRow key={`${s.scope}.${s.key}`}>
            <WatchKey>{s.scope === "_shared" ? s.key : `${s.scope}.${s.key}`}</WatchKey>
            <WatchValue><JsonView value={s.value} path={`watch-${s.scope}-${s.key}`} /></WatchValue>
          </WatchRow>
        ))}
      </WatchWrap>
    </SurfaceWrap>
  );
}

// ── Markdown (view rendered as markdown) ────────────────────────────────────

const MdCard = styled.div`
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.75rem 1rem;
  font-size: 13px;
  line-height: 1.6;
  color: var(--fg);
  word-break: break-word;
  a { color: var(--accent); }
  code { background: var(--bg); border-radius: 3px; padding: 1px 4px; font-size: 11px; color: var(--accent); }
  pre { background: var(--bg); border-radius: 4px; padding: 0.4rem 0.6rem; margin: 0.3rem 0; overflow-x: auto; }
  pre code { background: none; padding: 0; color: var(--fg); }
  strong { color: var(--fg); }
  em { color: var(--dim); }
  h1, h2, h3 { font-size: 14px; font-weight: 700; margin-top: 0.3rem; }
  ul, ol { padding-left: 1.2rem; margin: 0.2rem 0; }
  p + p { margin-top: 0.4rem; }
`;

function MarkdownSurface({ surface, views }: { surface: SurfaceMarkdown; views: View[] }) {
  const view = views.find(v => v.id === surface.view);
  if (!view) return null;
  const text = typeof view.value === "string" ? view.value : JSON.stringify(view.value);

  return (
    <SurfaceWrap>
      {surface.label && <SurfaceLabel>{surface.label}</SurfaceLabel>}
      <MdCard dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
    </SurfaceWrap>
  );
}

// ── Array Table (single view returning an array → data grid) ────────────────

const ATable = styled.div`
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
`;

const ATableScroll = styled.div`
  overflow-x: auto;
  max-height: 360px;
  overflow-y: auto;
`;

const ATableEl = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
`;

const ATHead = styled.thead`
  position: sticky;
  top: 0;
  background: var(--bg);
  z-index: 1;
`;

const ATH = styled.th<{ $width?: string }>`
  padding: 0.3rem 0.6rem;
  text-align: left;
  color: var(--dim);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  border-bottom: 1px solid var(--border);
  ${p => p.$width ? `width: ${p.$width};` : ""}
`;

const ATR = styled.tr`
  border-bottom: 1px solid var(--border);
  &:last-child { border-bottom: none; }
  &:hover { background: var(--surface2); }
`;

const ATD = styled.td`
  padding: 0.3rem 0.6rem;
  color: var(--fg);
  vertical-align: top;
  word-break: break-word;
  max-width: 280px;
`;

const ATEmpty = styled.div`
  color: var(--dim);
  font-style: italic;
  padding: 0.75rem;
  text-align: center;
  font-size: 12px;
`;

const ATMore = styled.div`
  color: var(--dim);
  font-size: 11px;
  padding: 0.35rem 0.6rem;
  border-top: 1px solid var(--border);
  text-align: right;
`;

const ATHetero = styled.div`
  color: var(--dim);
  font-size: 11px;
  padding: 0.5rem 0.6rem;
  font-style: italic;
`;

function renderCellValue(val: any, truncate: number): React.ReactNode {
  if (val === null || val === undefined) return <span style={{ color: "var(--dim)" }}>—</span>;
  if (typeof val === "boolean") return <span style={{ color: val ? "var(--green)" : "var(--red)" }}>{val ? "✓" : "✗"}</span>;
  if (typeof val === "number") return <span style={{ fontVariantNumeric: "tabular-nums" }}>{val}</span>;
  if (typeof val === "string") {
    if (val.length > truncate) return <span title={val}>{val.slice(0, truncate)}…</span>;
    return val;
  }
  if (Array.isArray(val)) return <span style={{ color: "var(--dim)", fontSize: 11 }}>[{val.length} items]</span>;
  return <JsonView value={val} path="cell" />;
}

function ArrayTableSurface({ view }: { view: View }) {
  const arr = Array.isArray(view.value) ? view.value : [];
  const render = view.render;
  const maxRows = render?.max_rows ?? 100;
  const label = render?.label || view.description || view.id;

  // Infer or use explicit columns
  const { homogeneous, columns: inferredCols } = useMemo(() => inferArrayColumns(arr), [arr]);
  const resolved = useMemo(
    () => resolveColumns(inferredCols, render?.columns),
    [inferredCols, render?.columns]
  );

  const displayRows = arr.slice(0, maxRows);
  const overflow = arr.length - displayRows.length;

  return (
    <SurfaceWrap>
      <SurfaceLabel>{label}</SurfaceLabel>
      <ATable>
        {arr.length === 0 ? (
          <ATEmpty>no items</ATEmpty>
        ) : !homogeneous ? (
          <>
            <ATHetero>heterogeneous array — showing raw</ATHetero>
            <ATableScroll>
              <JsonView value={arr} path={`array-${view.id}`} />
            </ATableScroll>
          </>
        ) : (
          <>
            <ATableScroll>
              <ATableEl>
                {resolved.length > 0 && (
                  <ATHead>
                    <tr>
                      {resolved.map(col => (
                        <ATH key={col.key} $width={col.width}>{col.label}</ATH>
                      ))}
                    </tr>
                  </ATHead>
                )}
                <tbody>
                  {displayRows.map((row, i) => (
                    <ATR key={i}>
                      {resolved.length > 0 ? resolved.map(col => (
                        <ATD key={col.key}>
                          {renderCellValue(
                            typeof row === "object" && row !== null ? row[col.key] : row,
                            col.truncate
                          )}
                        </ATD>
                      )) : (
                        <ATD>{renderCellValue(row, 80)}</ATD>
                      )}
                    </ATR>
                  ))}
                </tbody>
              </ATableEl>
            </ATableScroll>
            {overflow > 0 && <ATMore>+{overflow} more rows</ATMore>}
          </>
        )}
      </ATable>
    </SurfaceWrap>
  );
}

// ── Section ─────────────────────────────────────────────────────────────────

function SectionSurface({ surface, ctx }: { surface: SurfaceSection; ctx: SurfaceContext }) {
  return (
    <SurfaceWrap>
      {surface.label && <SectionLabel>{surface.label}</SectionLabel>}
      <div>
        {surface.surfaces.map(s => (
          <SurfaceRenderer key={s.id} surface={s} ctx={ctx} />
        ))}
      </div>
    </SurfaceWrap>
  );
}

// ── Main renderer ───────────────────────────────────────────────────────────

export interface SurfaceContext {
  data: PollData;
  agentMap: Record<string, Agent>;
  roomId: string;
  baseUrl: string;
  authHeaders: () => Record<string, string>;
  evalCel: (expr: string) => boolean;
}

export function SurfaceRenderer({ surface, ctx }: { surface: Surface; ctx: SurfaceContext }) {
  // Check enabled expression
  if (surface.enabled && !ctx.evalCel(surface.enabled)) return null;

  switch (surface.type) {
    case "metric":
      return <MetricSurface surface={surface} views={ctx.data.views} />;
    case "view-grid":
      return <ViewGridSurface surface={surface} views={ctx.data.views} />;
    case "view-table":
      return <ViewTableSurface surface={surface} views={ctx.data.views} />;
    case "array-table": {
      const view = ctx.data.views.find(v => v.id === (surface as SurfaceArrayTable).view);
      return view ? <ArrayTableSurface view={{ ...view, render: { type: "array-table", label: surface.label, columns: (surface as SurfaceArrayTable).columns, max_rows: (surface as SurfaceArrayTable).max_rows } }} /> : null;
    }
    case "action-bar":
      return <ActionBarSurface surface={surface} actions={ctx.data.actions} roomId={ctx.roomId} baseUrl={ctx.baseUrl} authHeaders={ctx.authHeaders} />;
    case "action-form":
      return <ActionFormSurface surface={surface} actions={ctx.data.actions} roomId={ctx.roomId} baseUrl={ctx.baseUrl} authHeaders={ctx.authHeaders} />;
    case "action-choice":
      return <ActionChoiceSurface surface={surface} actions={ctx.data.actions} roomId={ctx.roomId} baseUrl={ctx.baseUrl} authHeaders={ctx.authHeaders} />;
    case "feed":
      return <FeedSurface surface={surface} messages={ctx.data.messages} agentMap={ctx.agentMap} roomId={ctx.roomId} baseUrl={ctx.baseUrl} authHeaders={ctx.authHeaders} />;
    case "watch":
      return <WatchSurface surface={surface} state={ctx.data.state} />;
    case "section":
      return <SectionSurface surface={surface} ctx={ctx} />;
    case "markdown":
      return <MarkdownSurface surface={surface} views={ctx.data.views} />;
    default:
      return null;
  }
}

export function SurfacesView({ surfaces, ctx }: { surfaces: Surface[]; ctx: SurfaceContext }) {
  return (
    <div style={{ padding: "0.5rem 1rem" }}>
      {surfaces.map(s => (
        <SurfaceRenderer key={s.id} surface={s} ctx={ctx} />
      ))}
    </div>
  );
}
