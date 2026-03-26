# OpenShell Release Prep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Productize the current branch as the npm package `@junwu168/openshell` with CLI binary `openshell`, global OpenCode install/uninstall flows, and a reviewer-friendly pre-release repo surface.

**Architecture:** Keep the existing remote-tool runtime and OpenCode plugin behavior, but rebrand the package, add a first-class CLI, and implement install/uninstall lifecycle code around standard OpenShell config and data directories. Register the plugin in OpenCode through the global `plugin` config array and merged permission config, because current OpenCode npm-plugin support loads packages from `opencode.json` directly.

**Tech Stack:** TypeScript, Bun, OpenCode plugin SDK, `ssh2`, `env-paths`, Bun test

---

## File Map

- `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/package.json`
  Published package metadata, CLI bin wiring, npm-facing scripts, package identity.
- `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/src/index.ts`
  Public package exports for the OpenCode plugin under the `openshell` product surface.
- `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/src/core/paths.ts`
  OpenShell config/data path helpers, OpenCode global config path helpers, workspace `.open-code` helpers.
- `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/src/cli/openshell.ts`
  Top-level `openshell` CLI command dispatcher and shared user-facing help text.
- `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/scripts/openshell.ts`
  Bun entrypoint for local CLI execution during development.
- `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/src/cli/server-registry.ts`
  Existing interactive registry subcommands, updated to sit under the top-level CLI and workspace tracker.
- `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/src/product/workspace-tracker.ts`
  Persistent tracker for workspace `.open-code` directories created or managed by OpenShell.
- `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/src/product/opencode-config.ts`
  Read/merge/remove helpers for `~/.config/opencode/opencode.json`.
- `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/src/product/install.ts`
  `openshell install` orchestration: ensure directories, merge OpenCode config, initialize tracker.
- `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/src/product/uninstall.ts`
  `openshell uninstall` orchestration: remove OpenCode registration, remove tracked workspaces, delete OpenShell state.
- `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/README.md`
  Pre-release install/uninstall and first-run documentation.
- `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/examples/opencode-local/opencode.json`
  Example permission file aligned with the released OpenCode integration story.
- `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/examples/opencode-local/.opencode/package.json`
  Legacy local-plugin smoke artifact to delete if no longer aligned with the npm install path.
- `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/examples/opencode-local/.opencode/plugins/open-code.ts`
  Legacy local-plugin shim to delete or replace if still needed for reviewer docs.
- `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/unit/build-layout.test.ts`
  Package metadata and emitted layout assertions.
- `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/unit/release-docs.test.ts`
  README and example assertions that keep the public install story coherent.
- `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/unit/paths.test.ts`
  Runtime path and app-directory assertions for the renamed product.
- `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/unit/plugin-export.test.ts`
  Public package export assertions after the rename.
- `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/unit/server-registry-cli.test.ts`
  Existing registry CLI tests, expanded for nested CLI integration and workspace tracking.
- `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/unit/opencode-plugin.test.ts`
  OpenCode plugin export and runtime dependency tests after the package rename.
- `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/unit/openshell-cli.test.ts`
  New top-level CLI dispatch and help-text tests.
- `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/unit/workspace-tracker.test.ts`
  New workspace-tracker tests.
- `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/unit/opencode-config.test.ts`
  New OpenCode config merge/remove tests.
- `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/integration/install-lifecycle.test.ts`
  New end-to-end install/uninstall filesystem lifecycle test using temporary config/data roots.

### Task 1: Rebrand The Package Surface And Runtime Paths

**Files:**
- Modify: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/package.json`
- Modify: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/src/index.ts`
- Modify: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/src/core/paths.ts`
- Test: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/unit/build-layout.test.ts`
- Test: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/unit/paths.test.ts`
- Test: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/unit/plugin-export.test.ts`

- [ ] **Step 1: Write the failing package and path tests**

Add or update tests to lock the renamed product contract:

```ts
test("package metadata publishes openshell with a bin entry", async () => {
  expect(packageJson.name).toBe("@junwu168/openshell")
  expect(packageJson.bin.openshell).toBe("./dist/cli/openshell.js")
  expect(packageJson.private).not.toBe(true)
})

test("runtime paths use openshell app directories", () => {
  const runtime = createRuntimePaths("/repo")
  expect(runtime.configDir).toContain("openshell")
  expect(runtime.dataDir).toContain("openshell")
  expect(runtime.workspaceRegistryFile).toBe("/repo/.open-code/servers.json")
})

test("package entry exports the OpenShell plugin", async () => {
  expect(typeof OpenShellPlugin).toBe("function")
})
```

Keep the current `dist/index.js` package entry expectation, but update it to assert the new package identity and CLI bin layout.

- [ ] **Step 2: Run targeted tests to verify they fail**

Run:

```bash
~/.bun/bin/bun test \
  tests/unit/build-layout.test.ts \
  tests/unit/paths.test.ts \
  tests/unit/plugin-export.test.ts
```

Expected:

- FAIL because `package.json` still says `open-code`
- FAIL because there is no `openshell` bin entry yet
- FAIL because `env-paths` still resolves `open-code`
- FAIL because the package entry still exports only `OpenCodePlugin`

- [ ] **Step 3: Implement the renamed package and path contract**

In `package.json`:

- set `"name": "@junwu168/openshell"`
- remove `"private": true`
- add:

```json
"bin": {
  "openshell": "./dist/cli/openshell.js"
}
```

- keep the package root export pointed at `./dist/index.js`
- add a development script for the top-level CLI, for example:

```json
"scripts": {
  "openshell": "$npm_execpath scripts/openshell.ts"
}
```

In `src/core/paths.ts`:

- switch `envPaths("open-code", ...)` to `envPaths("openshell", ...)`
- expose OpenCode global config helpers alongside the existing registry/audit helpers, for example:

```ts
const openShellPaths = envPaths("openshell", { suffix: "" })
const openCodePaths = envPaths("opencode", { suffix: "" })

opencodeConfigDir: openCodePaths.config,
opencodeConfigFile: `${openCodePaths.config}/opencode.json`,
workspaceRegistryDir: `${workspaceRoot}/.open-code`,
workspaceRegistryFile: `${workspaceRoot}/.open-code/servers.json`,
```

Do not rename the workspace `.open-code` directory in this pass.

In `src/index.ts`:

- export a product-facing plugin symbol:

```ts
export { OpenCodePlugin as OpenShellPlugin, OpenCodePlugin } from "./opencode/plugin"
export { OpenCodePlugin as default } from "./opencode/plugin"
```

Keep current compatibility exports unless a test proves they are unnecessary.

- [ ] **Step 4: Run targeted tests to verify they pass**

Run:

```bash
~/.bun/bin/bun test \
  tests/unit/build-layout.test.ts \
  tests/unit/paths.test.ts \
  tests/unit/plugin-export.test.ts
```

Expected:

- PASS with the renamed package, CLI bin, and runtime path assertions green

- [ ] **Step 5: Commit**

```bash
git -C /Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli add \
  package.json \
  src/index.ts \
  src/core/paths.ts \
  tests/unit/build-layout.test.ts \
  tests/unit/paths.test.ts \
  tests/unit/plugin-export.test.ts
git -C /Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli commit -m "refactor: rename package surface to openshell"
```

### Task 2: Add The First-Class OpenShell CLI And Workspace Tracker

**Files:**
- Create: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/src/cli/openshell.ts`
- Create: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/scripts/openshell.ts`
- Create: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/src/product/workspace-tracker.ts`
- Modify: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/src/cli/server-registry.ts`
- Test: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/unit/openshell-cli.test.ts`
- Test: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/unit/workspace-tracker.test.ts`
- Test: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/unit/server-registry-cli.test.ts`

- [ ] **Step 1: Write the failing CLI and tracker tests**

Add tests for the product CLI contract:

```ts
test("openshell routes server-registry subcommands", async () => {
  const exitCode = await runOpenShellCli(["server-registry", "list"], deps)
  expect(exitCode).toBe(0)
  expect(serverRegistryCalls).toEqual([["list"]])
})

test("workspace tracker records and deduplicates managed workspaces", async () => {
  await tracker.record({ workspaceRoot: "/repo", managedPath: "/repo/.open-code" })
  await tracker.record({ workspaceRoot: "/repo", managedPath: "/repo/.open-code" })
  expect(await tracker.list()).toEqual([
    expect.objectContaining({ workspaceRoot: "/repo", managedPath: "/repo/.open-code" }),
  ])
})

test("adding a workspace-scoped server records the managed workspace path", async () => {
  await runServerRegistryCli(["add"], deps)
  expect(trackerCalls).toContainEqual({
    workspaceRoot,
    managedPath: `${workspaceRoot}/.open-code`,
  })
})
```

Also add help-text coverage:

- `openshell` with no args prints top-level usage
- unknown subcommands return a non-zero exit code

- [ ] **Step 2: Run targeted tests to verify they fail**

Run:

```bash
~/.bun/bin/bun test \
  tests/unit/openshell-cli.test.ts \
  tests/unit/workspace-tracker.test.ts \
  tests/unit/server-registry-cli.test.ts
```

Expected:

- FAIL because there is no top-level `openshell` CLI yet
- FAIL because no workspace tracker exists
- FAIL because `server-registry` is not wired to any tracker

- [ ] **Step 3: Implement the top-level CLI and tracker**

Create `src/cli/openshell.ts` with a dispatcher shaped like:

```ts
switch (argv[0]) {
  case "install":
    return runInstallCli(argv.slice(1), deps)
  case "uninstall":
    return runUninstallCli(argv.slice(1), deps)
  case "server-registry":
    return runServerRegistryCli(argv.slice(1), deps)
  default:
    stdout.write(usage)
    return argv.length === 0 ? 0 : 1
}
```

Create `src/product/workspace-tracker.ts` as a small JSON-backed store under the OpenShell data directory with methods like:

- `list()`
- `record({ workspaceRoot, managedPath })`
- `remove(workspaceRoot)`
- `clear()`

Update `src/cli/server-registry.ts` so that:

- workspace-scoped writes record `${workspaceRoot}/.open-code`
- workspace-scoped removals can remove tracker entries when the registry file no longer exists
- existing prompt/test seams stay injectable

Create `scripts/openshell.ts` as the Bun dev entrypoint:

```ts
import { main } from "../src/cli/openshell"
process.exitCode = await main(process.argv.slice(2))
```

- [ ] **Step 4: Run targeted tests to verify they pass**

Run:

```bash
~/.bun/bin/bun test \
  tests/unit/openshell-cli.test.ts \
  tests/unit/workspace-tracker.test.ts \
  tests/unit/server-registry-cli.test.ts
```

Expected:

- PASS with CLI dispatch, help text, and workspace tracking green

- [ ] **Step 5: Commit**

```bash
git -C /Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli add \
  src/cli/openshell.ts \
  scripts/openshell.ts \
  src/product/workspace-tracker.ts \
  src/cli/server-registry.ts \
  tests/unit/openshell-cli.test.ts \
  tests/unit/workspace-tracker.test.ts \
  tests/unit/server-registry-cli.test.ts
git -C /Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli commit -m "feat: add openshell cli and workspace tracking"
```

### Task 3: Implement OpenCode Install And Uninstall Lifecycle

**Files:**
- Create: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/src/product/opencode-config.ts`
- Create: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/src/product/install.ts`
- Create: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/src/product/uninstall.ts`
- Modify: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/src/cli/openshell.ts`
- Modify: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/src/core/paths.ts`
- Test: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/unit/opencode-config.test.ts`
- Test: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/unit/openshell-cli.test.ts`
- Test: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/integration/install-lifecycle.test.ts`

- [ ] **Step 1: Write the failing install/uninstall tests**

Add merge/remove tests around the actual OpenCode integration contract:

```ts
test("install merges openshell into the global OpenCode plugin list", async () => {
  await writeFile(opencodeConfigFile, JSON.stringify({
    plugin: ["existing-plugin"],
    permission: { edit: "ask" },
  }))

  await installOpenShell({ runtimePaths, cwd: "/repo" })

  expect(readMergedConfig()).toMatchObject({
    plugin: ["existing-plugin", "@junwu168/openshell"],
    permission: expect.objectContaining({
      edit: "ask",
      bash: expect.objectContaining({ "cat *": "allow" }),
    }),
  })
})

test("uninstall removes openshell registration and tracked workspaces", async () => {
  await tracker.record({ workspaceRoot: "/repo", managedPath: "/repo/.open-code" })
  await uninstallOpenShell({ runtimePaths })
  expect(await exists("/repo/.open-code")).toBe(false)
  expect(await exists(runtimePaths.configDir)).toBe(false)
  expect(await exists(runtimePaths.dataDir)).toBe(false)
})
```

Also cover:

- install creates a minimal `opencode.json` when it does not exist
- install does not duplicate `@junwu168/openshell` in `plugin`
- uninstall preserves unrelated OpenCode plugins and permissions
- uninstall removes stale dev-only plugin shims under `~/.config/opencode/plugins/openshell.*` or `open-code.*` if present

- [ ] **Step 2: Run targeted tests to verify they fail**

Run:

```bash
~/.bun/bin/bun test \
  tests/unit/opencode-config.test.ts \
  tests/unit/openshell-cli.test.ts \
  tests/integration/install-lifecycle.test.ts
```

Expected:

- FAIL because no install/uninstall modules exist
- FAIL because `openshell install` and `openshell uninstall` are not wired
- FAIL because OpenCode config merge/remove logic does not exist

- [ ] **Step 3: Implement the lifecycle modules**

Create `src/product/opencode-config.ts` to own:

- loading `opencode.json` if present
- creating a minimal config if absent
- merging:

```json
{
  "plugin": ["@junwu168/openshell"],
  "permission": {
    "edit": "ask",
    "bash": {
      "*": "ask",
      "cat *": "allow",
      "grep *": "allow",
      "find *": "allow",
      "ls *": "allow",
      "pwd": "allow",
      "uname *": "allow",
      "df *": "allow",
      "free *": "allow",
      "ps *": "allow",
      "systemctl status *": "allow"
    }
  }
}
```

- removing only the `@junwu168/openshell` plugin entry and OpenShell-managed permission defaults during uninstall

Create `src/product/install.ts` to:

- ensure OpenShell config/data directories
- ensure the OpenCode config directory exists
- merge and write `opencode.json`
- initialize the workspace tracker
- print a concise summary

Create `src/product/uninstall.ts` to:

- remove OpenShell-managed OpenCode registration
- remove any tracked workspace `.open-code` directories
- delete OpenShell config and data directories
- print removal failures without hiding them

Wire these through `src/cli/openshell.ts`.

- [ ] **Step 4: Run targeted tests to verify they pass**

Run:

```bash
~/.bun/bin/bun test \
  tests/unit/opencode-config.test.ts \
  tests/unit/openshell-cli.test.ts \
  tests/integration/install-lifecycle.test.ts
```

Expected:

- PASS with config merge/remove and lifecycle cleanup assertions green

- [ ] **Step 5: Commit**

```bash
git -C /Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli add \
  src/product/opencode-config.ts \
  src/product/install.ts \
  src/product/uninstall.ts \
  src/cli/openshell.ts \
  src/core/paths.ts \
  tests/unit/opencode-config.test.ts \
  tests/unit/openshell-cli.test.ts \
  tests/integration/install-lifecycle.test.ts
git -C /Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli commit -m "feat: add openshell install and uninstall lifecycle"
```

### Task 4: Clean Docs, Examples, And User-Facing Review Artifacts

**Files:**
- Modify: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/README.md`
- Modify: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/examples/opencode-local/opencode.json`
- Delete: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/examples/opencode-local/.opencode/package.json`
- Delete: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/examples/opencode-local/.opencode/plugins/open-code.ts`
- Delete: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/examples/opencode-local/.opencode/.gitignore`
- Create: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/unit/release-docs.test.ts`

- [ ] **Step 1: Write the failing docs/example assertions**

Add lightweight checks that prevent the old developer-only install story from lingering:

```ts
test("README documents openshell install and uninstall", async () => {
  expect(readme).toContain("npm install -g @junwu168/openshell")
  expect(readme).toContain("openshell install")
  expect(readme).toContain("openshell uninstall")
})

test("legacy local plugin shim is no longer part of the release example", async () => {
  expect(await exists(exampleShimFile)).toBe(false)
})
```

Also update the current build-layout expectations if they still mention `open-code`.

- [ ] **Step 2: Run targeted tests to verify they fail**

Run:

```bash
~/.bun/bin/bun test tests/unit/release-docs.test.ts
```

Expected:

- FAIL because README and example files still describe the Bun-script/local-shim flow

- [ ] **Step 3: Rewrite the review-facing docs and examples**

Update `README.md` so the first screen a reviewer sees is:

1. install globally with npm
2. run `openshell install`
3. add a server with `openshell server-registry add`
4. start OpenCode and use the explicit remote tools
5. run `openshell uninstall` for full cleanup

Remove or rewrite stale wording:

- `open-code`
- encrypted registry / keychain references
- local `.opencode/plugins/open-code.ts` smoke setup as the primary story

Delete the example `.opencode` shim files if they are no longer part of the supported install path. Keep `examples/opencode-local/opencode.json` only if it still adds reviewer value as a permission example.

- [ ] **Step 4: Run targeted tests to verify they pass**

Run:

```bash
~/.bun/bin/bun test tests/unit/release-docs.test.ts
```

Expected:

- PASS with README and example assertions green

- [ ] **Step 5: Commit**

```bash
git -C /Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli add \
  README.md \
  examples/opencode-local/opencode.json \
  tests/unit/release-docs.test.ts
git -C /Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli rm \
  examples/opencode-local/.opencode/package.json \
  examples/opencode-local/.opencode/plugins/open-code.ts \
  examples/opencode-local/.opencode/.gitignore
git -C /Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli commit -m "docs: align examples and install story with openshell"
```

### Task 5: Final Verification And Pre-Release Smoke Evidence

**Files:**
- Modify: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/README.md`
- Create: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/docs/superpowers/notes/2026-03-26-openshell-pre-release-review.md`

- [ ] **Step 1: Run the full automated verification suite**

Run:

```bash
~/.bun/bin/bun test
~/.bun/bin/bun run typecheck
~/.bun/bin/bun run build
```

Expected:

- all unit and integration tests pass
- no type errors
- `dist/cli/openshell.js` is emitted for the published bin

- [ ] **Step 2: Run a fresh-install filesystem smoke in isolated config roots**

Run from the worktree root:

```bash
TMP_ROOT="$(mktemp -d)"
XDG_CONFIG_HOME="$TMP_ROOT/config" \
XDG_DATA_HOME="$TMP_ROOT/data" \
HOME="$TMP_ROOT/home" \
  ~/.bun/bin/bun run openshell install
```

Then verify:

```bash
test -f "$TMP_ROOT/config/opencode/opencode.json"
test -d "$TMP_ROOT/config/openshell"
test -d "$TMP_ROOT/data/openshell"
```

Expected:

- OpenCode global config exists and contains `@junwu168/openshell`
- OpenShell config/data roots exist

- [ ] **Step 3: Run a cleanup smoke in the same isolated roots**

Run:

```bash
XDG_CONFIG_HOME="$TMP_ROOT/config" \
XDG_DATA_HOME="$TMP_ROOT/data" \
HOME="$TMP_ROOT/home" \
  ~/.bun/bin/bun run openshell uninstall
```

Then verify:

```bash
test ! -e "$TMP_ROOT/config/openshell"
test ! -e "$TMP_ROOT/data/openshell"
```

Expected:

- OpenShell config/data are gone
- `@junwu168/openshell` has been removed from the OpenCode config

- [ ] **Step 4: Update the reviewer-facing checklist if any verification command changed**

If the README or review note still references stale commands or paths, update it so a reviewer can reproduce:

- global npm install
- `openshell install`
- `openshell server-registry add`
- OpenCode smoke prompts
- `openshell uninstall`

- [ ] **Step 5: Commit**

```bash
git -C /Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli add README.md docs/superpowers/notes/2026-03-26-openshell-pre-release-review.md
git -C /Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli commit -m "docs: finalize prerelease verification checklist"
```
