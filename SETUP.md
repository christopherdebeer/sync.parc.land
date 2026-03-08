# Session Setup: Deno & Val Town CLI

Reproducible steps for installing Deno and the Val Town CLI (`vt`) in a
fresh Claude Code session, so you can `vt pull` / `vt push` to sync with
the canonical Val Town project.

## 1. Install Deno

```bash
curl -fsSL https://deno.land/install.sh | sh
export PATH="/root/.deno/bin:$PATH"
```

## 2. Install the Val Town CLI (`vt`)

The `vt` CLI is published on **JSR** (not npm). Use `DENO_TLS_CA_STORE=system`
to avoid certificate errors in sandboxed environments:

```bash
DENO_TLS_CA_STORE=system deno install -grAf --name=vt jsr:@valtown/vt
```

## 3. Authenticate

`vt` uses the `VAL_TOWN_API_KEY` environment variable for non-interactive auth.
Generate a key at https://www.val.town/settings/api, then:

```bash
export VAL_TOWN_API_KEY="vtwn_..."
```

## 4. Pull latest from Val Town

```bash
export DENO_TLS_CA_STORE=system
echo "y" | vt pull --force
```

The `--force` flag is needed when local files have diverged from the Val Town
version. The `echo "y"` pipe confirms the overwrite prompt.

## 5. Commit & push to GitHub

```bash
git add -A
git commit -m "sync: pull latest from Val Town"
git push -u origin <branch-name>
```

## Environment notes

- Deno installs to `/root/.deno/bin/` — add to PATH each session
- `DENO_TLS_CA_STORE=system` is required for both `deno install` and `vt` commands
  in environments where Deno's built-in CA bundle doesn't trust the npm/JSR registries
- The `.vt/state.json` file tracks the Val Town project ID and branch version
- Config can also be set via: `vt config set apiKey YOUR_API_KEY`
