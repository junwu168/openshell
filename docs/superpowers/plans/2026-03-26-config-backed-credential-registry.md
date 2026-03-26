# Config-Backed Credential Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current encrypted and keychain-backed credential registry with a layered workspace/global config model that stores plain-text passwords and path-only key or certificate references.

**Architecture:** Keep the existing orchestrator, policy, audit, and OpenCode tool surface intact while swapping only the credential-storage layer. The new backend reads and writes JSON config files from workspace and global scopes, resolves an effective server view with workspace override semantics, and normalizes path-based auth before building SSH connection options.

**Tech Stack:** TypeScript, Bun, OpenCode plugin SDK, `ssh2`, `env-paths`, Bun test

---

### Task 1: Replace Runtime Path And Registry Types

**Files:**
- Modify: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/src/core/paths.ts`
- Modify: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/src/core/registry/server-registry.ts`
- Delete: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/src/core/registry/crypto.ts`
- Delete: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/src/core/registry/keychain-provider.ts`
- Delete: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/src/core/registry/secret-provider.ts`
- Test: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/unit/paths.test.ts`
- Test: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/unit/server-registry.test.ts`

- [ ] **Step 1: Write the failing path and registry tests**

Add tests that define the new backend contract:

```ts
test("runtime paths expose global and workspace server config locations", () => {
  const runtime = createRuntimePaths("/repo")
  expect(runtime.globalRegistryFile.endsWith("servers.json")).toBe(true)
  expect(runtime.workspaceRegistryFile).toBe("/repo/.open-code/servers.json")
})

test("workspace records override global records by id", async () => {
  const registry = createServerRegistry({
    globalRegistryFile,
    workspaceRegistryFile,
    workspaceRoot,
  })

  expect(await registry.resolve("prod-a")).toMatchObject({
    id: "prod-a",
    scope: "workspace",
    shadowingGlobal: true,
  })
})
```

Also replace the old encryption-oriented tests with config-oriented expectations:

- plain-text password is written as plain JSON
- workspace and global scopes are loaded separately
- `list()` returns effective merged records with scope metadata
- `listRaw("workspace")` and `listRaw("global")` return unmerged records

- [ ] **Step 2: Run targeted tests to verify they fail**

Run:

```bash
~/.bun/bin/bun test tests/unit/paths.test.ts tests/unit/server-registry.test.ts
```

Expected:

- FAIL because `runtimePaths` still exposes `servers.enc.json`
- FAIL because `createServerRegistry()` still expects `secretProvider`
- FAIL because scope metadata and layered reads do not exist yet

- [ ] **Step 3: Implement the new path model and registry types**

Update `src/core/paths.ts` to expose:

```ts
export const runtimePaths = {
  configDir: paths.config,
  dataDir: paths.data,
  globalRegistryFile: `${paths.config}/servers.json`,
  auditLogFile: `${paths.data}/audit/actions.jsonl`,
  auditRepoDir: `${paths.data}/audit/repo`,
}

export const workspaceRegistryFile = (workspaceRoot: string) =>
  `${workspaceRoot}/.open-code/servers.json`
```

Replace the registry backend in `src/core/registry/server-registry.ts` with a JSON-file implementation:

- remove encryption and `SecretProvider`
- add scoped file loading for `global` and `workspace`
- add config schema types:
  - `PasswordAuthRecord` with `secret`
  - `PrivateKeyAuthRecord` with `privateKeyPath`
  - `CertificateAuthRecord` with `certificatePath` and `privateKeyPath`
- add scope-aware result types, for example:

```ts
export type RegistryScope = "global" | "workspace"

export type ResolvedServerRecord = ServerRecord & {
  scope: RegistryScope
  shadowingGlobal?: boolean
  workspaceRoot?: string
}
```

Add methods needed by the spec:

- `list()`
- `resolve(id)`
- `upsert(scope, record)`
- `remove(scope, id)`
- `listRaw(scope)`

Keep atomic write behavior with temp-file + rename. Keep per-file lock behavior only if still needed for concurrent writes; if retained, scope the lock to the target config file rather than an encrypted-registry assumption.

- [ ] **Step 4: Run targeted tests to verify they pass**

Run:

```bash
~/.bun/bin/bun test tests/unit/paths.test.ts tests/unit/server-registry.test.ts
```

Expected:

- PASS with config-path and scope-aware registry assertions green

- [ ] **Step 5: Commit**

```bash
git -C /Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli add \
  src/core/paths.ts \
  src/core/registry/server-registry.ts \
  tests/unit/paths.test.ts \
  tests/unit/server-registry.test.ts
git -C /Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli rm \
  src/core/registry/crypto.ts \
  src/core/registry/keychain-provider.ts \
  src/core/registry/secret-provider.ts
git -C /Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli commit -m "refactor: replace encrypted registry with layered config backend"
```

### Task 2: Update Orchestrator And Plugin Runtime For Path-Based Auth

**Files:**
- Modify: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/src/core/orchestrator.ts`
- Modify: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/src/opencode/plugin.ts`
- Modify: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/src/core/contracts.ts`
- Test: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/integration/orchestrator.test.ts`
- Test: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/unit/opencode-plugin.test.ts`

- [ ] **Step 1: Write the failing orchestrator and plugin tests**

Add tests that cover:

- path-based auth records are converted into `ssh2` connect config by reading file contents at runtime
- missing key or certificate files return structured validation errors before SSH execution
- plugin runtime dependencies no longer construct a Keychain-backed registry

Example test shape:

```ts
test("remote_exec reads privateKeyPath from workspace-scoped server records", async () => {
  await writeFile(join(workspaceRoot, "keys/id_rsa"), "PRIVATE KEY")

  const result = await orchestrator.remoteExec({
    server: "prod-a",
    command: "cat /etc/hosts",
  })

  expect(fakeSsh.execCalls[0]?.connection.privateKey).toContain("PRIVATE KEY")
})

test("missing private key path returns KEY_PATH_NOT_FOUND", async () => {
  expect(result).toMatchObject({
    status: "error",
    code: "KEY_PATH_NOT_FOUND",
    execution: { attempted: false, completed: false },
  })
})
```

- [ ] **Step 2: Run targeted tests to verify they fail**

Run:

```bash
~/.bun/bin/bun test tests/integration/orchestrator.test.ts tests/unit/opencode-plugin.test.ts
```

Expected:

- FAIL because `toConnectConfig()` still expects in-memory key material
- FAIL because plugin still imports `createKeychainSecretProvider()`

- [ ] **Step 3: Implement scope-aware auth normalization in the orchestrator and plugin**

In `src/core/orchestrator.ts`:

- add a helper that turns a resolved server record into `ConnectConfig`
- for `password`, pass the plain `secret`
- for `privateKey`, read `privateKeyPath` from disk
- for `certificate`, read `privateKeyPath` and validate `certificatePath` exists even if `ssh2` does not need separate certificate material for the current flow
- resolve relative paths only for workspace-scoped records
- reject relative paths in global records
- return structured errors such as:
  - `AUTH_PATH_INVALID`
  - `KEY_PATH_NOT_FOUND`
  - `CERTIFICATE_PATH_NOT_FOUND`
  - `AUTH_PATH_UNREADABLE`

In `src/opencode/plugin.ts`:

- remove `createKeychainSecretProvider`
- construct the registry with global and workspace config paths derived from the current working directory
- keep the tool surface and approval behavior unchanged

Update any contracts if result payload types need new error codes.

- [ ] **Step 4: Run targeted tests to verify they pass**

Run:

```bash
~/.bun/bin/bun test tests/integration/orchestrator.test.ts tests/unit/opencode-plugin.test.ts
```

Expected:

- PASS with path-based auth and plugin wiring assertions green

- [ ] **Step 5: Commit**

```bash
git -C /Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli add \
  src/core/orchestrator.ts \
  src/opencode/plugin.ts \
  src/core/contracts.ts \
  tests/integration/orchestrator.test.ts \
  tests/unit/opencode-plugin.test.ts
git -C /Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli commit -m "feat: resolve ssh auth from layered config files"
```

### Task 3: Rework The Registry CLI For Scope Selection And Auth Modes

**Files:**
- Modify: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/src/cli/server-registry.ts`
- Modify: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/scripts/server-registry.ts`
- Test: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/unit/server-registry-cli.test.ts`

- [ ] **Step 1: Write the failing CLI tests**

Add tests for:

- defaulting to workspace scope when a workspace config already exists
- defaulting to global when no workspace config exists
- prompting for auth kind: `password`, `privateKey`, `certificate`
- warning before storing a plain-text password
- warning when a workspace `id` overrides a global `id`
- prompting which scope to remove from when both contain the same `id`
- listing source scope and shadowing status

Example:

```ts
test("add warns when a workspace record overrides a global record", async () => {
  expect(stdout.toString()).toContain("will override global entry")
})

test("remove prompts for scope when the same id exists in both configs", async () => {
  expect(promptCalls).toContainEqual(
    expect.objectContaining({ message: expect.stringContaining("Remove from which scope") }),
  )
})
```

- [ ] **Step 2: Run targeted tests to verify they fail**

Run:

```bash
~/.bun/bin/bun test tests/unit/server-registry-cli.test.ts
```

Expected:

- FAIL because CLI currently assumes one registry file
- FAIL because only password auth is supported
- FAIL because scope-aware list/remove flows do not exist

- [ ] **Step 3: Implement the CLI changes**

In `src/cli/server-registry.ts`:

- inject workspace root and scoped registry methods into CLI deps
- add scope selection prompt with defaults:
  - workspace if workspace config exists
  - otherwise global
- add auth-kind selection prompt
- support these persisted shapes:

```ts
auth: { kind: "password", secret: "plain-text" }
auth: { kind: "privateKey", privateKeyPath: "./keys/id_rsa", passphrase?: "..." }
auth: {
  kind: "certificate",
  certificatePath: "./keys/client.pem",
  privateKeyPath: "./keys/client-key.pem",
  passphrase?: "...",
}
```

- warn before plain-text password storage
- for `list`, print scope and shadowing markers
- for `remove`, resolve scope explicitly before deleting

Keep the script entrypoint unchanged so `bun run server-registry` still works.

- [ ] **Step 4: Run targeted tests to verify they pass**

Run:

```bash
~/.bun/bin/bun test tests/unit/server-registry-cli.test.ts
```

Expected:

- PASS with new scope and auth prompt behavior covered

- [ ] **Step 5: Commit**

```bash
git -C /Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli add \
  src/cli/server-registry.ts \
  scripts/server-registry.ts \
  tests/unit/server-registry-cli.test.ts
git -C /Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli commit -m "feat: add layered config flows to server registry cli"
```

### Task 4: Remove Keychain Dependency From Build And Docs

**Files:**
- Modify: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/package.json`
- Modify: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/README.md`
- Modify: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/docs/superpowers/specs/2026-03-26-config-backed-credential-registry-design.md`
- Test: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/unit/build-layout.test.ts`

- [ ] **Step 1: Write the failing dependency and docs assertions**

Add or update a lightweight test to assert the published build no longer depends on `keytar` or deleted registry modules where practical.

Example:

```ts
test("package metadata no longer declares keytar", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"))
  expect(pkg.dependencies.keytar).toBeUndefined()
})
```

- [ ] **Step 2: Run targeted tests to verify they fail**

Run:

```bash
~/.bun/bin/bun test tests/unit/build-layout.test.ts
```

Expected:

- FAIL because `package.json` still includes `keytar`

- [ ] **Step 3: Remove obsolete dependencies and update docs**

In `package.json`:

- remove `keytar`

In `README.md`:

- document the new config file locations
- document that plain-text password storage is unsafe but supported
- document that key/cert auth stores file paths only
- include a short example for both workspace and global configs

If the spec doc needs a brief implementation note after planning, keep it synchronized.

- [ ] **Step 4: Run targeted tests to verify they pass**

Run:

```bash
~/.bun/bin/bun test tests/unit/build-layout.test.ts
~/.bun/bin/bun run typecheck
~/.bun/bin/bun run build
```

Expected:

- PASS
- build succeeds without `keytar`

- [ ] **Step 5: Commit**

```bash
git -C /Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli add \
  package.json \
  README.md \
  tests/unit/build-layout.test.ts
git -C /Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli commit -m "chore: remove keychain dependency from credential registry"
```

### Task 5: Run Full Verification And Realistic Smoke Coverage

**Files:**
- Modify if needed: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/examples/opencode-local/opencode.json`
- Modify if needed: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/examples/opencode-local/.opencode/package.json`
- Test: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/integration/orchestrator.test.ts`
- Test: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/integration/ssh-runtime.test.ts`
- Test: `/Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli/tests/unit/*.test.ts`

- [ ] **Step 1: Run the full automated test suite**

Run:

```bash
~/.bun/bin/bun test
```

Expected:

- PASS across unit and integration coverage

- [ ] **Step 2: Run typecheck and build**

Run:

```bash
~/.bun/bin/bun run typecheck
~/.bun/bin/bun run build
```

Expected:

- PASS

- [ ] **Step 3: Run manual Docker smoke test against the new config model**

Use the disposable SSH container flow:

```bash
docker run -d --name open-code-smoke-ssh \
  -e USER_NAME=open \
  -e USER_PASSWORD=openpass \
  -e PASSWORD_ACCESS=true \
  -e SUDO_ACCESS=false \
  -p 22222:2222 \
  linuxserver/openssh-server:10.2_p1-r0-ls219
```

Create a workspace or global `servers.json` matching the new schema, then validate:

- `bun run server-registry list`
- `opencode` -> `list_servers`
- `remote_exec` with `cat /tmp/open-code/hosts`
- `remote_write_file` still prompts for approval

Expected:

- config-backed server appears in `list_servers`
- safe `remote_exec` succeeds without approval prompt
- write tool still requires approval

- [ ] **Step 4: Clean up smoke artifacts**

Run:

```bash
docker rm -f open-code-smoke-ssh
```

Delete any temporary test configs created during the smoke run.

- [ ] **Step 5: Commit follow-up fixes if verification required any**

```bash
git -C /Users/wujunming/Documents/experimental/openshell/.worktrees/registry-cli status -sb
```

If no code changes were needed, do not create an empty commit.

