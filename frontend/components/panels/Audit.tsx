/** @jsxImportSource https://esm.sh/react@18.2.0 */
import { useEffect, useRef } from "https://esm.sh/react@18.2.0";
import { styled } from "../../styled.ts";
import type { AuditRow, Agent } from "../../types.ts";
import { aname, tryParseJson } from "../../utils.ts";

const Log = styled.div`display: flex; flex-direction: column; gap: 1px; overflow-y: auto;`;

const Row = styled.div`
  display: grid;
  grid-template-columns: 90px 1fr auto;
  gap: 0.5rem;
  padding: 4px 8px;
  font-size: 12px;
  background: var(--surface);
  border-radius: 2px;
  &:hover { background: var(--surface2); }
  @media (max-width: 480px) {
    grid-template-columns: 1fr;
    gap: 2px;
    padding: 6px 8px;
  }
`;

const From = styled.div`
  color: var(--accent);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const Body = styled.div`color: var(--fg); word-break: break-word; min-width: 0;`;

const OkIcon = styled.span`color: var(--green); font-size: 10px;`;
const FailIcon = styled.span`color: var(--red); font-size: 10px;`;

const ActionTag = styled.span`
  display: inline-block;
  background: rgba(188,140,255,0.2);
  color: var(--purple);
  border-radius: 2px;
  padding: 0 4px;
  font-size: 10px;
  margin-right: 4px;
`;

const BuiltinLabel = styled.span`color: var(--dim); font-size: 10px; margin-left: 4px;`;
const LogMeta = styled.div`
  color: var(--dim);
  font-size: 11px;
  white-space: nowrap;
  text-align: right;
  @media (max-width: 480px) {
    text-align: left;
    font-size: 10px;
  }
`;
const Empty = styled.div`color: var(--dim); font-style: italic; padding: 1rem; text-align: center;`;

interface AuditPanelProps {
  audit: AuditRow[];
  agentMap: Record<string, Agent>;
}

export function AuditPanel({ audit, agentMap }: AuditPanelProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [audit.length]);

  if (!audit.length) return <Empty>no audit entries</Empty>;

  return (
    <Log>
      {audit.map(a => {
        let v = tryParseJson(a.value);
        if (typeof v !== "object" || v === null) v = { action: "?", agent: "?" };
        const action = v.action || "?";
        const agent = v.agent || "system";
        const ok = v.ok !== false;
        const ts = v.ts ? (v.ts.split("T")[1]?.slice(0, 8) || "") : "";
        const paramsStr = v.params
          ? Object.entries(v.params as Record<string, any>)
              .filter(([, val]) => val !== undefined && val !== null)
              .map(([k, val]) => `${k}=${typeof val === "string" ? val : JSON.stringify(val)}`)
              .join(", ")
          : "";
        const display = paramsStr.length > 300 ? paramsStr.slice(0, 300) + "…" : paramsStr;

        return (
          <Row key={a.sort_key}>
            <From title={agent}>
              {ok ? <OkIcon>✓</OkIcon> : <FailIcon>✗</FailIcon>}
              {" "}{aname(agent, agentMap)}
            </From>
            <Body>
              <ActionTag>{action}</ActionTag>
              {v.builtin && <BuiltinLabel>builtin</BuiltinLabel>}
              {" "}{display}
            </Body>
            <LogMeta>#{a.sort_key} · {ts}</LogMeta>
          </Row>
        );
      })}
      <div ref={bottomRef} />
    </Log>
  );
}
