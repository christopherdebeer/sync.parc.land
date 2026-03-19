/** @jsxImportSource https://esm.sh/react@18.2.0 */
import { useState, useRef, useMemo } from "https://esm.sh/react@18.2.0";
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
  grid-template-columns: 140px 1fr auto;
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

// ── v9: Meta annotations ──
const MetaRow = styled.div`
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 10px;
  color: var(--dim);
  margin-top: 2px;
  flex-wrap: wrap;
`;

const MetaWriter = styled.span`color: var(--orange);`;
const MetaVia = styled.span`color: var(--purple);`;
const MetaVelocity = styled.span<{ $high: boolean }>`
  color: ${p => p.$high ? "var(--yellow)" : "var(--dim)"};
`;

const ScoreBar = styled.div<{ $pct: number }>`
  display: inline-block;
  width: 40px;
  height: 4px;
  background: var(--border);
  border-radius: 2px;
  position: relative;
  overflow: hidden;
  &::after {
    content: '';
    position: absolute;
    left: 0;
    top: 0;
    height: 100%;
    width: ${p => p.$pct}%;
    background: var(--accent);
    border-radius: 2px;
    opacity: 0.7;
  }
`;

const RightCol = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 2px;
  min-width: 50px;
  @media (max-width: 480px) {
    flex-direction: row;
    align-items: center;
    gap: 6px;
  }
`;

const Version = styled.div`
  color: var(--dim);
  text-align: right;
  font-size: 11px;
`;

const ScoreText = styled.div`
  color: var(--dim);
  font-size: 9px;
  text-align: right;
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

  // Sort by score (high first) within scope if _meta available
  const sorted = useMemo(() => {
    return [...entries].sort((a, b) => {
      const sa = a._meta?.score ?? 0;
      const sb = b._meta?.score ?? 0;
      if (sb !== sa) return sb - sa;
      return String(a.key).localeCompare(String(b.key));
    });
  }, [entries]);

  return (
    <Wrap $dimmed={!visible}>
      <ScopeHeader $closed={collapsed} onClick={() => setCollapsed(c => !c)}>
        <Arrow $closed={collapsed}>▼</Arrow>
        <ScopeName $type={stype}>{scope}</ScopeName>
        <ScopeCount>({entries.length})</ScopeCount>
        {!visible && <PrivateLabel>🔒 private</PrivateLabel>}
      </ScopeHeader>
      <ScopeBody $hidden={collapsed}>
        {sorted.map(s => {
          const vk = `${scope}.${s.key}`;
          const changed = prevVersions.current[vk] !== undefined && prevVersions.current[vk] !== s.version;
          prevVersions.current[vk] = s.version;
          const m = s._meta;
          const scorePct = m ? Math.round(m.score * 100) : 0;

          return (
            <StateRowEl key={s.key} $flash={changed}>
              <div>
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
                {m && (m.writer || m.via || m.velocity > 0.1) && (
                  <MetaRow>
                    {m.writer && <MetaWriter>← {m.writer}</MetaWriter>}
                    {m.via && <MetaVia>via {m.via}</MetaVia>}
                    {m.velocity > 0.1 && <MetaVelocity $high={m.velocity > 0.3}>⚡ {m.velocity.toFixed(2)}</MetaVelocity>}
                    {m.writers && m.writers.length > 1 && (
                      <span title={m.writers.join(", ")}>{m.writers.length} writers</span>
                    )}
                  </MetaRow>
                )}
              </div>
              <JsonView value={s.value} path={vk} />
              <RightCol>
                <Version>r{s.version}</Version>
                {m && <ScoreBar $pct={scorePct} title={`score: ${m.score.toFixed(3)}`} />}
                {m && scorePct > 0 && <ScoreText>.{String(scorePct).padStart(2, '0')}</ScoreText>}
              </RightCol>
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
