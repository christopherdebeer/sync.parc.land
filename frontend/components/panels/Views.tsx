/** @jsxImportSource https://esm.sh/react@18.2.0 */
import { styled } from "../../styled.ts";
import type { View } from "../../types.ts";
import { JsonView } from "../JsonView.tsx";

const Grid = styled.div`display: flex; flex-wrap: wrap; gap: 0.5rem;`;

const Card = styled.div`
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 0.6rem 0.8rem;
  min-width: 0;
  flex: 1 1 280px;
  max-width: 400px;
  @media (max-width: 480px) {
    flex: 1 1 100%;
    max-width: 100%;
  }
`;

const ViewName = styled.div`font-weight: 600; font-size: 13px; color: var(--purple); word-break: break-word;`;
const Desc = styled.div`color: var(--dim); font-size: 11px; margin-top: 2px;`;
const Expr = styled.div`font-size: 11px; color: var(--dim); margin-top: 3px; font-style: italic; word-break: break-word;`;
const ValBox = styled.div`
  margin-top: 4px;
  padding: 4px 6px;
  background: var(--bg);
  border-radius: 3px;
  font-size: 12px;
  overflow-x: auto;
`;
const ErrorText = styled.span`color: var(--red);`;
const Meta = styled.div`font-size: 10px; color: var(--dim); margin-top: 4px; word-break: break-word;`;
const Empty = styled.div`color: var(--dim); font-style: italic; padding: 1rem; text-align: center;`;

const RenderBadge = styled.span`
  display: inline-block;
  background: rgba(88,166,255,0.12);
  color: var(--accent);
  border: 1px solid rgba(88,166,255,0.25);
  border-radius: 3px;
  padding: 0 5px;
  font-size: 10px;
  font-weight: 600;
  margin-left: 5px;
  vertical-align: middle;
  letter-spacing: 0.02em;
`;

const RenderHintRow = styled.div`
  margin-top: 4px;
  font-size: 10px;
  color: var(--dim);
  display: flex;
  flex-wrap: wrap;
  gap: 3px 6px;
`;

const RenderProp = styled.span`
  color: var(--accent);
`;

interface ViewsPanelProps {
  views: View[];
}

export function ViewsPanel({ views }: ViewsPanelProps) {
  if (!views.length) return <Empty>no views registered</Empty>;

  return (
    <Grid>
      {views.map(v => (
        <Card key={v.id}>
          <ViewName>
            {v.id}
            {v.render && <RenderBadge>{v.render.type}</RenderBadge>}
          </ViewName>
          {v.description && <Desc>{v.description}</Desc>}
          <Expr>{v.expr}</Expr>
          <ValBox>
            → {v.value && typeof v.value === "object" && v.value._error
              ? <ErrorText>error: {v.value._error}</ErrorText>
              : <JsonView value={v.value} path={`view-${v.id}`} />
            }
          </ValBox>
          {v.render && (
            <RenderHintRow>
              {v.render.label && <span>label: <RenderProp>{v.render.label}</RenderProp></span>}
              {v.render.order !== undefined && <span>order: <RenderProp>{v.render.order}</RenderProp></span>}
              {v.render.group && <span>group: <RenderProp>{v.render.group}</RenderProp></span>}
              {v.render.type === "array-table" && v.render.columns && (
                <span>cols: <RenderProp>{v.render.columns.map(c => c.label ?? c.key).join(", ")}</RenderProp></span>
              )}
              {v.render.type === "metric" && v.render.unit && (
                <span>unit: <RenderProp>{v.render.unit}</RenderProp></span>
              )}
            </RenderHintRow>
          )}
          <Meta>
            scope: {v.scope} · v{v.version}
            {v.registered_by && ` · by ${v.registered_by}`}
          </Meta>
        </Card>
      ))}
    </Grid>
  );
}
