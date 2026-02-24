#!/usr/bin/env -S deno run -A
/**
 * Deploy script: syncs source files from the repo into a vt-managed project
 * directory and pushes to Val Town.
 *
 * Usage:
 *   VAL_TOWN_API_KEY=vtk_... deno task deploy
 *
 * What it does:
 *   1. Runs `vt clone` into a temp directory (to get fresh .vt metadata)
 *   2. Copies source files from ./src/ over the cloned files
 *   3. Runs `vt push` to deploy
 */

const VAL_PROJECT = "c15r/agent-sync";
const SOURCE_DIR = "src";
const DEPLOY_DIR = ".vt-deploy"; // transient, gitignored

async function run(cmd: string[], opts?: { cwd?: string }) {
  const p = new Deno.Command(cmd[0], {
    args: cmd.slice(1),
    cwd: opts?.cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  const { code } = await p.output();
  if (code !== 0) {
    console.error(`Command failed (exit ${code}): ${cmd.join(" ")}`);
    Deno.exit(1);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

// --- Main ---

if (!Deno.env.get("VAL_TOWN_API_KEY")) {
  console.error("Error: VAL_TOWN_API_KEY environment variable is required.");
  console.error("Generate one at: https://www.val.town/settings/api");
  Deno.exit(1);
}

// Clean previous deploy dir
if (await exists(DEPLOY_DIR)) {
  await Deno.remove(DEPLOY_DIR, { recursive: true });
}

console.log(`\n=> Cloning ${VAL_PROJECT} into ${DEPLOY_DIR}...`);
await run(["deno", "run", "-A", "jsr:@valtown/vt", "clone", VAL_PROJECT, DEPLOY_DIR]);

// Copy source files over the cloned project
console.log(`\n=> Syncing ${SOURCE_DIR}/ -> ${DEPLOY_DIR}/...`);
const sourceDir = SOURCE_DIR;
if (!(await exists(sourceDir))) {
  console.error(`Error: Source directory '${sourceDir}' not found.`);
  console.error("Place your Val Town source files in ./src/");
  Deno.exit(1);
}

// Walk source dir and copy each file into deploy dir
for await (const entry of Deno.readDir(sourceDir)) {
  const srcPath = `${sourceDir}/${entry.name}`;
  const destPath = `${DEPLOY_DIR}/${entry.name}`;

  if (entry.isDirectory) {
    await copyDir(srcPath, destPath);
  } else {
    await Deno.copyFile(srcPath, destPath);
  }
}

console.log(`\n=> Pushing to Val Town...`);
await run(["deno", "run", "-A", "jsr:@valtown/vt", "push"], { cwd: DEPLOY_DIR });

console.log(`\n=> Deploy complete! Live at https://sync.parc.land/`);

// --- Helpers ---

async function copyDir(src: string, dest: string) {
  await Deno.mkdir(dest, { recursive: true });
  for await (const entry of Deno.readDir(src)) {
    const srcPath = `${src}/${entry.name}`;
    const destPath = `${dest}/${entry.name}`;
    if (entry.isDirectory) {
      await copyDir(srcPath, destPath);
    } else {
      await Deno.copyFile(srcPath, destPath);
    }
  }
}
