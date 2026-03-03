/** @jsxImportSource https://esm.sh/react@18.2.0 */
import { useState, useCallback } from "https://esm.sh/react@18.2.0";
import { styled } from "../../styled.ts";

const Wrap = styled.div``;

const Console = styled.div`
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.75rem;
  margin-top: 0.5rem;
`;

const InputRow = styled.div`display: flex; gap: 0.5rem; @media (max-width: 480px) { flex-wrap: wrap; }`;

const CelInput = styled.input`
  flex: 1;
  min-width: 0;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.4rem 0.6rem;
  color: var(--fg);
  font-family: inherit;
  font-size: 12px;
  outline: none;
  &:focus { border-color: var(--accent); }
`;

const EvalBtn = styled.button`
  background: var(--accent);
  color: var(--bg);
  border: none;
  border-radius: 4px;
  padding: 0.4rem 0.8rem;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
`;

const CelOutput = styled.div<{ $status: "idle" | "loading" | "ok" | "error" }>`
  margin-top: 0.5rem;
  padding: 0.5rem;
  background: var(--bg);
  border-radius: 4px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
  display: ${p => p.$status === "idle" ? "none" : "block"};
  color: ${p => p.$status === "error" ? "var(--red)" : p.$status === "ok" ? "var(--green)" : "var(--dim)"};
`;

const History = styled.div`margin-top: 0.5rem; display: flex; flex-wrap: wrap; gap: 4px;`;

const HistBtn = styled.button`
  background: var(--border);
  border: none;
  border-radius: 3px;
  padding: 2px 6px;
  font-size: 10px;
  color: var(--dim);
  cursor: pointer;
  font-family: inherit;
  &:hover { color: var(--accent); }
`;

const QuickLinks = styled.div`margin-top: 0.6rem; color: var(--dim); font-size: 11px;`;
const QuickLink = styled.span<{ $purple?: boolean }>`
  cursor: pointer;
  color: ${p => p.$purple ? "var(--purple)" : "var(--accent)"};
`;

const QUICK = [
  { label: "_shared", expr: "state._shared" },
  { label: "views", expr: "views", purple: true },
  { label: "agents", expr: "agents" },
  { label: "messages", expr: "messages" },
  { label: "actions", expr: "actions" },
  { label: "all state", expr: "state" },
];

interface CelPanelProps {
  roomId: string;
  baseUrl: string;
  authHeaders: () => Record<string, string>;
}

type CelStatus = "idle" | "loading" | "ok" | "error";

export function CelPanel({ roomId, baseUrl, authHeaders }: CelPanelProps) {
  const [expr, setExpr] = useState("");
  const [output, setOutput] = useState("");
  const [status, setStatus] = useState<CelStatus>("idle");
  const [history, setHistory] = useState<string[]>([]);

  const runCel = useCallback(async (e?: string) => {
    const x = e || expr.trim();
    if (!x) return;
    if (e) setExpr(e);
    setStatus("loading");
    setOutput("evaluating…");
    try {
      const r = await fetch(`${baseUrl}/rooms/${roomId}/eval`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ expr: x }),
      });
      const d = await r.json();
      if (d.error) {
        setStatus("error");
        setOutput(d.detail || d.error);
      } else {
        setStatus("ok");
        setOutput(JSON.stringify(d.value, null, 2));
      }
      setHistory(h => [x, ...h.filter(i => i !== x)].slice(0, 12));
    } catch (err: any) {
      setStatus("error");
      setOutput("error: " + err.message);
    }
  }, [expr, roomId, baseUrl, authHeaders]);

  return (
    <Wrap>
      <Console>
        <InputRow>
          <CelInput
            value={expr}
            onChange={e => setExpr(e.target.value)}
            onKeyDown={e => e.key === "Enter" && runCel()}
            placeholder="state._shared.phase"
            spellCheck={false}
          />
          <EvalBtn onClick={() => runCel()}>Eval</EvalBtn>
        </InputRow>
        {history.length > 0 && (
          <History>
            {history.map(h => (
              <HistBtn key={h} title={h} onClick={() => runCel(h)}>
                {h.length > 35 ? h.slice(0, 35) + "…" : h}
              </HistBtn>
            ))}
          </History>
        )}
        <CelOutput $status={status}>{output}</CelOutput>
      </Console>
      <QuickLinks>
        <b>Quick:</b>{" "}
        {QUICK.map((q, i) => (
          <span key={q.label}>
            <QuickLink $purple={q.purple} onClick={() => runCel(q.expr)}>{q.label}</QuickLink>
            {i < QUICK.length - 1 && " · "}
          </span>
        ))}
      </QuickLinks>
    </Wrap>
  );
}
