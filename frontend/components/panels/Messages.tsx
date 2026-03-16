/** @jsxImportSource https://esm.sh/react@18.2.0 */
import { useEffect, useRef, useState, useCallback } from "https://esm.sh/react@18.2.0";
import { styled } from "../../styled.ts";
import type { RawMessage, Agent } from "../../types.ts";
import { aname, rel, relTo, tryParseJson } from "../../utils.ts";

const Wrap = styled.div`display: flex; flex-direction: column; gap: 0;`;
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

const KIND_COLOR: Record<string, string> = {
  task: "rgba(210,153,34,0.2)/var(--yellow)",
  action_invocation: "rgba(188,140,255,0.2)/var(--purple)",
  result: "rgba(63,185,80,0.2)/var(--green)",
};

const KindTag = styled.span<{ $kind: string }>`
  display: inline-block;
  background: ${p => (KIND_COLOR[p.$kind] ?? "var(--border)/var(--dim)").split("/")[0]};
  color: ${p => (KIND_COLOR[p.$kind] ?? "var(--border)/var(--dim)").split("/")[1]};
  border-radius: 2px;
  padding: 0 4px;
  font-size: 10px;
  margin-right: 4px;
`;

const ClaimedBy = styled.span`color: var(--green); font-size: 10px; margin-left: 4px;`;
const MdSpan = styled.span`display: inline;`;
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

// ── Send bar ────────────────────────────────────────────────────────────────

const SendBar = styled.div`
  display: flex;
  gap: 0.4rem;
  padding: 0.5rem 0;
  margin-top: 0.5rem;
  border-top: 1px solid var(--border);
  @media (max-width: 480px) {
    flex-wrap: wrap;
  }
`;

const MsgInput = styled.input`
  flex: 1;
  min-width: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.4rem 0.6rem;
  color: var(--fg);
  font-family: inherit;
  font-size: 12px;
  outline: none;
  &:focus { border-color: var(--accent); }
`;

const KindSelect = styled.select`
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  color: var(--dim);
  font-family: inherit;
  font-size: 11px;
  padding: 0 4px;
  outline: none;
  &:focus { border-color: var(--accent); }
`;

const SendBtn = styled.button`
  background: var(--accent);
  color: var(--bg);
  border: none;
  border-radius: 4px;
  padding: 0.4rem 0.8rem;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  &:hover { opacity: 0.85; }
  &:disabled { background: var(--border); color: var(--dim); cursor: not-allowed; }
`;

const SendError = styled.div`
  color: var(--red);
  font-size: 11px;
  padding: 2px 0;
`;

interface MessagesPanelProps {
  messages: RawMessage[];
  agentMap: Record<string, Agent>;
  roomId: string;
  baseUrl: string;
  authHeaders: () => Record<string, string>;
  /** When false, disables auto-scroll entirely (e.g. in replay mode). Default true. */
  autoScroll?: boolean;
  /** When true, hides the send bar (e.g. in replay mode). */
  readOnly?: boolean;
  /** When set, timestamps display as +Xs relative to this epoch instead of relative to now. */
  epochMs?: number;
}

// Threshold in px — if the user has scrolled up more than this, don't auto-scroll.
const SCROLL_THRESHOLD = 80;

export function MessagesPanel({ messages, agentMap, roomId, baseUrl, authHeaders, autoScroll = true, readOnly = false, epochMs }: MessagesPanelProps) {
  const logRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [msgText, setMsgText] = useState("");
  const [msgKind, setMsgKind] = useState("chat");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!autoScroll) return;
    const log = logRef.current;
    if (!log) return;
    // Only scroll if the user is already near the bottom
    const distanceFromBottom = log.scrollHeight - log.scrollTop - log.clientHeight;
    if (distanceFromBottom <= SCROLL_THRESHOLD) {
      bottomRef.current?.scrollIntoView({ behavior: "instant" });
    }
  }, [messages.length, autoScroll]);

  const sendMessage = useCallback(async () => {
    const body = msgText.trim();
    if (!body) return;
    setSending(true);
    setError("");
    try {
      const r = await fetch(`${baseUrl}/rooms/${roomId}/actions/_send_message/invoke`, {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ params: { body, kind: msgKind } }),
      });
      const d = await r.json();
      if (d.error) {
        setError(d.message || d.error);
      } else {
        setMsgText("");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSending(false);
    }
  }, [msgText, msgKind, roomId, baseUrl, authHeaders]);

  return (
    <Wrap>
      {!messages.length && <Empty>no messages</Empty>}
      {messages.length > 0 && (
        <Log ref={logRef}>
          {messages.map(m => {
            let v = tryParseJson(m.value);
            if (typeof v !== "object" || v === null) v = { body: String(m.value) };
            const kind = v.kind || "msg";
            const from = v.from || "system";
            const body = typeof v.body === "string" ? v.body : JSON.stringify(v.body || v);

            return (
              <Row key={m.sort_key}>
                <From title={from}>{aname(from, agentMap)}</From>
                <Body>
                  <KindTag $kind={kind}>{kind}</KindTag>
                  {v.claimed_by && <ClaimedBy>✓{aname(v.claimed_by, agentMap)}</ClaimedBy>}
                  {" "}
                  <MdSpan dangerouslySetInnerHTML={{ __html: renderMarkdown(body) }} />
                </Body>
                <LogMeta>#{m.sort_key} · {epochMs != null ? relTo(m.updated_at, epochMs) : rel(m.updated_at)}</LogMeta>
              </Row>
            );
          })}
          <div ref={bottomRef} />
        </Log>
      )}
      {!readOnly && (
        <SendBar>
          <KindSelect value={msgKind} onChange={e => setMsgKind(e.target.value)}>
            <option value="chat">chat</option>
            <option value="task">task</option>
            <option value="result">result</option>
            <option value="system">system</option>
          </KindSelect>
          <MsgInput
            type="text"
            placeholder="send a message…"
            value={msgText}
            onChange={e => setMsgText(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !sending && sendMessage()}
            spellCheck={false}
          />
          <SendBtn onClick={sendMessage} disabled={sending || !msgText.trim()}>
            {sending ? "…" : "send"}
          </SendBtn>
        </SendBar>
      )}
      {!readOnly && error && <SendError>{error}</SendError>}
    </Wrap>
  );
}

function renderMarkdown(text: string): string {
  if (typeof (globalThis as any).marked !== "undefined") {
    return (globalThis as any).marked.parse(text, { breaks: true, gfm: true });
  }
  // SSR-safe fallback: escape HTML without document.createElement
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}
