/** @jsxImportSource https://esm.sh/react@18.2.0 */
import { useState, useCallback } from "https://esm.sh/react@18.2.0";
import { styled, keyframes } from "../../styled.ts";
import type { Action } from "../../types.ts";

const Grid = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
`;

const Card = styled.div<{ $available: boolean }>`
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.6rem 0.8rem;
  min-width: 0;
  flex: 1 1 300px;
  max-width: 460px;
  opacity: ${p => p.$available ? 1 : 0.6};
  @media (max-width: 480px) {
    flex: 1 1 100%;
    max-width: 100%;
  }
`;

const ActionHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
`;

const ActionName = styled.div<{ $available: boolean }>`
  font-weight: 600;
  font-size: 13px;
  color: ${p => p.$available ? "var(--green)" : "var(--dim)"};
  word-break: break-word;
  min-width: 0;
`;

const InvokeBtn = styled.button<{ $disabled?: boolean }>`
  background: ${p => p.$disabled ? "var(--border)" : "var(--green)"};
  color: ${p => p.$disabled ? "var(--dim)" : "var(--bg)"};
  border: none;
  border-radius: 4px;
  padding: 2px 8px;
  cursor: ${p => p.$disabled ? "not-allowed" : "pointer"};
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
  &:hover {
    opacity: ${p => p.$disabled ? 1 : 0.85};
  }
`;

const Desc = styled.div`color: var(--dim); font-size: 11px; margin-top: 2px; word-break: break-word;`;
const IfExpr = styled.div`font-size: 11px; color: var(--purple); margin-top: 3px; font-style: italic; word-break: break-word;`;
const WritesInfo = styled.div`font-size: 11px; color: var(--green); margin-top: 3px; word-break: break-word;`;
const Meta = styled.div`font-size: 10px; color: var(--dim); margin-top: 4px; word-break: break-word;`;
const Empty = styled.div`color: var(--dim); font-style: italic; padding: 1rem; text-align: center;`;

// ── Invoke form ─────────────────────────────────────────────────────────────

const FormWrap = styled.div`
  margin-top: 6px;
  padding: 6px 8px;
  background: var(--bg);
  border-radius: 4px;
  border: 1px solid var(--border);
`;

const ParamRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  font-size: 11px;
  @media (max-width: 480px) {
    flex-wrap: wrap;
  }
`;

const ParamLabel = styled.label`
  color: var(--accent);
  font-weight: 600;
  min-width: 70px;
  white-space: nowrap;
  @media (max-width: 480px) {
    min-width: 0;
  }
`;

const ParamInput = styled.input`
  flex: 1;
  background: var(--surface);
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

const ParamSelect = styled.select`
  flex: 1;
  background: var(--surface);
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

const ParamHint = styled.span`
  color: var(--dim);
  font-size: 10px;
  white-space: nowrap;
`;

const FormActions = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
`;

const SendBtn = styled.button`
  background: var(--green);
  color: var(--bg);
  border: none;
  border-radius: 4px;
  padding: 3px 10px;
  cursor: pointer;
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  &:hover { opacity: 0.85; }
  &:disabled { background: var(--border); color: var(--dim); cursor: not-allowed; }
`;

const CancelBtn = styled.button`
  background: none;
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 3px 8px;
  cursor: pointer;
  font-family: inherit;
  font-size: 11px;
  color: var(--dim);
  &:hover { color: var(--fg); border-color: var(--dim); }
`;

const flash = keyframes`
  from { background: rgba(63,185,80,0.15); }
  to { background: transparent; }
`;

const ResultBox = styled.div<{ $error?: boolean }>`
  margin-top: 6px;
  padding: 4px 8px;
  border-radius: 3px;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 150px;
  overflow-y: auto;
  color: ${p => p.$error ? "var(--red)" : "var(--green)"};
  background: ${p => p.$error ? "rgba(248,81,73,0.08)" : "rgba(63,185,80,0.08)"};
  animation: ${flash} 0.5s ease-out;
`;

// ── Action Card Component ───────────────────────────────────────────────────

interface ActionCardProps {
  action: Action;
  roomId: string;
  baseUrl: string;
  authHeaders: () => Record<string, string>;
  readOnly?: boolean;
}

function ActionCard({ action, roomId, baseUrl, authHeaders, readOnly }: ActionCardProps) {
  const av = action.available !== false;
  const paramDefs = action.params || {};
  const paramKeys = Object.keys(paramDefs);
  const writes = action.writes || [];
  const isBuiltin = action.id.startsWith("_") || action.id === "help";

  const [expanded, setExpanded] = useState(false);
  const [params, setParams] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const setParam = useCallback((key: string, val: string) => {
    setParams(p => ({ ...p, [key]: val }));
  }, []);

  const doInvoke = useCallback(async () => {
    setSending(true);
    setResult(null);
    try {
      // Coerce param values based on type hints
      const coerced: Record<string, any> = {};
      for (const [k, v] of Object.entries(params)) {
        if (v === "" || v === undefined) continue;
        const def = paramDefs[k];
        if (def?.type === "number") {
          const n = Number(v);
          coerced[k] = isNaN(n) ? v : n;
        } else if (def?.type === "boolean") {
          coerced[k] = v === "true";
        } else {
          // Try JSON parse for object/array types
          if (def?.type === "object" || def?.type === "array" || def?.type === "any") {
            try { coerced[k] = JSON.parse(v); } catch { coerced[k] = v; }
          } else {
            coerced[k] = v;
          }
        }
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
        const text = d.result !== undefined
          ? `✓ ${typeof d.result === "string" ? d.result : JSON.stringify(d.result, null, 2)}`
          : "✓ invoked";
        setResult({ ok: true, text });
      }
    } catch (e: any) {
      setResult({ ok: false, text: e.message });
    } finally {
      setSending(false);
    }
  }, [params, paramDefs, action.id, roomId, baseUrl, authHeaders]);

  const toggleForm = useCallback(() => {
    if (!expanded) {
      // Initialize defaults
      const defaults: Record<string, string> = {};
      for (const [k, def] of Object.entries(paramDefs)) {
        if (def.enum?.length) defaults[k] = String(def.enum[0]);
        else defaults[k] = "";
      }
      setParams(defaults);
      setResult(null);
    }
    setExpanded(e => !e);
  }, [expanded, paramDefs]);

  return (
    <Card $available={av}>
      <ActionHeader>
        <ActionName $available={av}>
          {av ? "● " : "○ "}{action.id}
        </ActionName>
        {!isBuiltin && !readOnly && (
          <InvokeBtn $disabled={!av} onClick={av ? toggleForm : undefined}>
            {expanded ? "close" : "invoke"}
          </InvokeBtn>
        )}
      </ActionHeader>
      {action.description && <Desc>{action.description}</Desc>}
      {action.if && <IfExpr>if: {action.if}</IfExpr>}
      {paramKeys.length > 0 && !expanded && (
        <Desc>
          params: {paramKeys.map(p => `${p}(${paramDefs[p].type || "?"})`).join(", ")}
        </Desc>
      )}
      {writes.length > 0 && (
        <WritesInfo>
          → {writes.map(w => `${w.scope || "_shared"}${w.append ? "[+]" : w.merge ? "[~]" : ""}`).join(", ")}
        </WritesInfo>
      )}

      {expanded && (
        <FormWrap>
          {paramKeys.length > 0 ? paramKeys.map(k => {
            const def = paramDefs[k];
            return (
              <ParamRow key={k}>
                <ParamLabel>{k}</ParamLabel>
                {def.enum ? (
                  <ParamSelect
                    value={params[k] || ""}
                    onChange={e => setParam(k, e.target.value)}
                  >
                    {def.enum.map((v: any) => (
                      <option key={String(v)} value={String(v)}>{String(v)}</option>
                    ))}
                  </ParamSelect>
                ) : (
                  <ParamInput
                    type="text"
                    placeholder={def.description || def.type || "value"}
                    value={params[k] || ""}
                    onChange={e => setParam(k, e.target.value)}
                    onKeyDown={e => e.key === "Enter" && doInvoke()}
                    spellCheck={false}
                  />
                )}
                {def.type && <ParamHint>{def.type}</ParamHint>}
              </ParamRow>
            );
          }) : (
            <Desc style={{ margin: 0 }}>no parameters</Desc>
          )}
          <FormActions>
            <SendBtn onClick={doInvoke} disabled={sending}>
              {sending ? "…" : "send"}
            </SendBtn>
            <CancelBtn onClick={toggleForm}>cancel</CancelBtn>
          </FormActions>
          {result && (
            <ResultBox $error={!result.ok}>{result.text}</ResultBox>
          )}
        </FormWrap>
      )}

      <Meta>
        scope: {action.scope} · v{action.version}
        {action.registered_by && ` · by ${action.registered_by}`}
      </Meta>
    </Card>
  );
}

// ── Panel ───────────────────────────────────────────────────────────────────

interface ActionsPanelProps {
  actions: Action[];
  roomId: string;
  baseUrl: string;
  authHeaders: () => Record<string, string>;
  readOnly?: boolean;
}

export function ActionsPanel({ actions, roomId, baseUrl, authHeaders, readOnly }: ActionsPanelProps) {
  if (!actions.length) return <Empty>no actions registered</Empty>;

  // Sort: custom actions first, builtins after
  const sorted = [...actions].sort((a, b) => {
    const aBuiltin = a.id.startsWith("_") || a.id === "help" ? 1 : 0;
    const bBuiltin = b.id.startsWith("_") || b.id === "help" ? 1 : 0;
    if (aBuiltin !== bBuiltin) return aBuiltin - bBuiltin;
    return 0;
  });

  return (
    <Grid>
      {sorted.map(a => (
        <ActionCard
          key={a.id}
          action={a}
          roomId={roomId}
          baseUrl={baseUrl}
          authHeaders={authHeaders}
          readOnly={readOnly}
        />
      ))}
    </Grid>
  );
}
