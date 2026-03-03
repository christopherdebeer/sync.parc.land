/** @jsxImportSource https://esm.sh/react@18.2.0 */
import { useState } from "https://esm.sh/react@18.2.0";
import { styled } from "../styled.ts";
import { tryParseJson } from "../utils.ts";

const Wrap = styled.span`cursor: default;`;
const Str = styled.span`color: #a5d6ff;`;
const Num = styled.span`color: #79c0ff;`;
const Bool = styled.span`color: var(--orange);`;
const Null = styled.span`color: var(--dim); font-style: italic;`;
const Key = styled.span`color: #7ee787;`;
const Brace = styled.span`color: var(--dim);`;
const Children = styled.div`padding-left: 16px;`;
const Collapsed = styled.span`color: var(--dim); font-style: italic; font-size: 11px;`;
const Toggle = styled.span`
  cursor: pointer;
  user-select: none;
  display: inline;
  &:hover { color: var(--accent); }
`;

interface JsonViewProps {
  value: any;
  depth?: number;
  path?: string;
}

export function JsonView({ value, depth = 0, path = "r" }: JsonViewProps) {
  const v = depth === 0 && typeof value === "string" ? tryParseJson(value) : value;
  return <Wrap>{renderValue(v, depth, path)}</Wrap>;
}

function CollapsibleNode({ keys, getValue, depth, path, brackets: [b0, b1] }: {
  keys: string[];
  getValue: (k: string) => any;
  depth: number;
  path: string;
  brackets: [string, string];
}) {
  const [open, setOpen] = useState(depth === 0 && keys.length <= 4);
  if (!keys.length) return <Brace>{b0}{b1}</Brace>;
  const isObj = b0 === "{";
  return (
    <>
      <Toggle onClick={() => setOpen(o => !o)}>
        <Brace>{b0}</Brace>
        {!open && <Collapsed> {keys.length} {isObj ? "keys" : "items"} </Collapsed>}
        {!open && <Brace>{b1}</Brace>}
      </Toggle>
      {open && (
        <>
          <Children>
            {keys.map((k, i) => (
              <div key={k}>
                {isObj && <><Key>{k}</Key>{": "}</>}
                <InlineValue value={getValue(k)} depth={depth + 1} path={`${path}.${k}`} />
                {i < keys.length - 1 && ","}
              </div>
            ))}
          </Children>
          <Brace>{b1}</Brace>
        </>
      )}
    </>
  );
}

function InlineValue({ value, depth, path }: { value: any; depth: number; path: string }) {
  const v = depth < 3 && typeof value === "string" ? tryParseJson(value) : value;
  return <>{renderValue(v, depth, path)}</>;
}

function renderValue(v: any, depth: number, path: string): React.ReactNode {
  if (v === null) return <Null>null</Null>;
  if (v === undefined) return <Null>undef</Null>;
  if (typeof v === "boolean") return <Bool>{String(v)}</Bool>;
  if (typeof v === "number" || typeof v === "bigint") return <Num>{String(v)}</Num>;
  if (typeof v === "string") {
    const display = v.length > 100 ? v.slice(0, 100) + "…" : v;
    return <Str>"{display}"</Str>;
  }
  if (Array.isArray(v)) {
    return <CollapsibleNode keys={v.map((_, i) => String(i))} getValue={k => v[Number(k)]} depth={depth} path={path} brackets={["[", "]"]} />;
  }
  if (typeof v === "object") {
    const keys = Object.keys(v);
    return <CollapsibleNode keys={keys} getValue={k => v[k]} depth={depth} path={path} brackets={["{", "}"]} />;
  }
  return <span>{String(v)}</span>;
}
