/** @jsxImportSource https://esm.sh/react@18.2.0 */
import { useState, useRef } from "https://esm.sh/react@18.2.0";
import { styled, keyframes } from "../../styled.ts";
import type { StateRow, Agent, TokenKind } from "../../types.ts";
import { JsonView } from "../JsonView.tsx";
import { rel } from "../../utils.ts";

const flash = keyframes`
  from { background: rgba(88,166,255,0.12); }
  to   { background: transparent; }
`;

const ScopeGroup = styled.div`margin-bottom: 0.75rem;`;

const ScopeHeader = styled.div<{ $closed: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  padding: 0.3rem 0.5rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: ${p => p.$closed ? "4px" : "4px 4px 0 0"};
  font-size: 12px;
  user-select: none;
`;

const Arrow = styled.span<{ $closed: boolean }>`
  font-size: 10px;
  color: var(--dim);
  display: inline-block;
  transition: transform 0.15s;
  transform: ${p => p.$closed ? "rotate(-90deg)" : "rotate(0deg)"};
`;

const ScopeName = styled.span<{ $type: "shared" | "system" | "agent" }>`
  font-weight: 600;
  color: ${p => p.$type === "shared" ? "var(--yellow)" : p.$type === "system" ? "var(--orange)" : "var(--accent)"};
`;

const ScopeCount = styled.span`color: var(--dim); font-size: 11px;`;
const PrivateLabel = styled.span`font-size: 10px; margin-left: auto; color: var(--red);`;

const ScopeBody = styled.div<{ $hidden: boolean }>`
  display: ${p => p.$hidden ? "none" : "block"};
  border: 1px solid var(--border);
  border-top: none;
  border-radius: 0 0 4px 4px;
  overflow: hidden;
`;

const StateRowEl = styled.div<{ $flash: boolean }>`
  display: grid;
  grid-template-columns: 140px 1fr 30px;
  gap: 0.5rem;
  padding: 0.3rem 0.5rem;
  font-size: 12px;
  border-bottom: 1px solid var(--border);
  align-items: start;
  animation: ${p => p.$flash ? flash : "none"} 0.6s ease-out;
  &:last-child { border-bottom: none; }
  @media (max-width: 480px) {
    grid-template-columns: 1fr;
    gap: 2px;
  }
`;

const StateKey = styled.div`color: var(--green); font-weight: 500; word-break: break-word;`;
const SortKey = styled.div`color: var(--dim); font-size: 10px;`;
const TimerInfo = styled.div<{ $purple?: boolean }>`
  font-size: 10px;
  color: ${p => p.$purple ? "var(--purple)" : "var(--orange)"};
  margin-top: 2px;
`;
const Version = styled.div`
  color: var(--dim);
  text-align: center;
  font-size: 11px;
  @media (max-width: 480px) {
    text-align: left;
    font-size: 10px;
  }
`;

const Empty = styled.div`color: var(--dim); font-style: italic; padding: 1rem; text-align: center;`;
const Wrap = styled.div<{ $dimmed?: boolean }>`
  opacity: ${p => p.$dimmed ? 0.4 : 1};
`;

function canSeeScope(scope: string, tokenKind: TokenKind | null, viewingId: string | undefined, agentMap: Record<string, Agent>): boolean {
  if (tokenKind === "room" && !viewingId) return true;
  const aid = viewingId;
  if (!aid) return true;
  if (scope.startsWith("_")) return true;
  if (scope === aid) return true;
  const ag = agentMap[aid];
  if (ag) {
    try {
      const g = JSON.parse(ag.grants || "[]");
      if (g.includes(scope) || g.includes("*")) return true;
    } catch {}
  }
  return false;
}

function ScopeGroupPanel({ scope, entries, visible, prevVersions }: {
  scope: string;
  entries: StateRow[];
  visible: boolean;
  prevVersions: React.MutableRefObject<Record<string, number>>;
}) {
  const stype = scope === "_shared" ? "shared" : scope.startsWith("_") ? "system" : "agent";
  const [collapsed, setCollapsed] = useState(!scope.startsWith("_") && scope !== "_shared");

  return (
    <Wrap $dimmed={!visible}>
      <ScopeHeader $closed={collapsed} onClick={() => setCollapsed(c => !c)}>
        <Arrow $closed={collapsed}>▼</Arrow>
        <ScopeName $type={stype}>{scope}</ScopeName>
        <ScopeCount>({entries.length})</ScopeCount>
        {!visible && <PrivateLabel>🔒 private</PrivateLabel>}
      </ScopeHeader>
      <ScopeBody $hidden={collapsed}>
        {entries.map(s => {
          const vk = `${scope}.${s.key}`;
          const changed = prevVersions.current[vk] !== undefined && prevVersions.current[vk] !== s.version;
          prevVersions.current[vk] = s.version;
          return (
            <StateRowEl key={s.key} $flash={changed}>
              <StateKey>
                {s.key}
                {s.sort_key != null && <SortKey>#{s.sort_key}</SortKey>}
                {s.timer_effect && (
                  <TimerInfo>
                    ⏱ {s.timer_effect}
                    {s.timer_expires_at ? ` · ${rel(s.timer_expires_at)}` : s.timer_ticks_left != null ? ` · ${s.timer_ticks_left} ticks` : ""}
                  </TimerInfo>
                )}
                {s.enabled_expr && <TimerInfo $purple>☑ {s.enabled_expr}</TimerInfo>}
              </StateKey>
              <JsonView value={s.value} path={vk} />
              <Version>v{s.version}</Version>
            </StateRowEl>
          );
        })}
      </ScopeBody>
    </Wrap>
  );
}

interface StatePanelProps {
  rows: StateRow[];
  agentMap: Record<string, Agent>;
  viewingId?: string;
  tokenKind: TokenKind | null;
}

export function StatePanel({ rows, agentMap, viewingId, tokenKind }: StatePanelProps) {
  const prevVersions = useRef<Record<string, number>>({});

  if (!rows.length) return <Empty>no state</Empty>;

  const scopes: Record<string, StateRow[]> = {};
  for (const s of rows) {
    if (!scopes[s.scope]) scopes[s.scope] = [];
    scopes[s.scope].push(s);
  }

  const order = Object.keys(scopes).sort((a, b) => {
    if (a === "_shared") return -1;
    if (b === "_shared") return 1;
    if (a.startsWith("_") && !b.startsWith("_")) return -1;
    if (!a.startsWith("_") && b.startsWith("_")) return 1;
    return a.localeCompare(b);
  });

  return (
    <div>
      {order.map(scope => (
        <ScopeGroupPanel
          key={scope}
          scope={scope}
          entries={scopes[scope]}
          visible={canSeeScope(scope, tokenKind, viewingId, agentMap)}
          prevVersions={prevVersions}
        />
      ))}
    </div>
  );
}
