/** @jsxImportSource https://esm.sh/react@18.2.0 */
import { styled } from "../../styled.ts";
import type { Agent } from "../../types.ts";
import { rel, hbc } from "../../utils.ts";

const Grid = styled.div`display: flex; flex-wrap: wrap; gap: 0.5rem;`;

const Card = styled.div<{ $viewing?: boolean }>`
  background: var(--surface);
  border: 1px solid ${p => p.$viewing ? "var(--accent)" : "var(--border)"};
  box-shadow: ${p => p.$viewing ? "0 0 0 1px var(--accent)" : "none"};
  border-radius: 6px;
  padding: 0.5rem 0.7rem;
  min-width: 160px;
  flex: 0 0 auto;
  @media (max-width: 480px) {
    flex: 1 1 100%;
    min-width: 0;
  }
`;

const STATUS_BG: Record<string, string> = {
  active: "rgba(63,185,80,0.15)", waiting: "rgba(210,153,34,0.15)",
  done: "rgba(88,166,255,0.15)",
};
const STATUS_FG: Record<string, string> = {
  active: "var(--green)", waiting: "var(--yellow)",
  done: "var(--accent)",
};

const Badge = styled.span<{ $status: string }>`
  display: inline-block;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  background: ${p => STATUS_BG[p.$status] ?? "rgba(248,81,73,0.15)"};
  color: ${p => STATUS_FG[p.$status] ?? "var(--red)"};
`;

const AgentName = styled.div`color: var(--accent); font-weight: 600; font-size: 12px;`;
const Sub = styled.div`color: var(--dim); font-size: 11px;`;
const WaitingOn = styled.div`color: var(--yellow); font-size: 11px;`;
const Grants = styled.div`font-size: 10px; color: var(--purple); margin-top: 2px;`;
const Heartbeat = styled.div<{ $cls: "" | "stale" | "dead" }>`
  font-size: 10px;
  margin-top: 2px;
  color: ${p => p.$cls === "stale" ? "var(--yellow)" : p.$cls === "dead" ? "var(--red)" : "var(--dim)"};
`;
const Empty = styled.div`color: var(--dim); font-style: italic; padding: 1rem; text-align: center;`;

interface AgentsPanelProps {
  agents: Agent[];
  viewingId?: string;
}

export function AgentsPanel({ agents, viewingId }: AgentsPanelProps) {
  if (!agents.length) return <Empty>no agents</Empty>;

  return (
    <Grid>
      {agents.map(a => {
        const sc = a.status || "active";
        const hbClass = hbc(a.last_heartbeat);
        let grants: string[] = [];
        try { grants = JSON.parse(a.grants || "[]"); } catch {}

        return (
          <Card key={a.id} $viewing={viewingId === a.id}>
            <div><Badge $status={sc}>{sc}</Badge></div>
            <AgentName>{a.name}</AgentName>
            <Sub>{a.role} · {a.id}</Sub>
            {a.waiting_on && <WaitingOn>⏳ {a.waiting_on}</WaitingOn>}
            {grants.length > 0 && <Grants>grants: {grants.join(", ")}</Grants>}
            <Heartbeat $cls={hbClass}>{rel(a.last_heartbeat)}</Heartbeat>
          </Card>
        );
      })}
    </Grid>
  );
}
