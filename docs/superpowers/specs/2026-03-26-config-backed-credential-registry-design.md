# Config-Backed Credential Registry Design

Date: 2026-03-26
Branch: `registry-cli`
Status: Approved for planning

## Summary

Replace the current encrypted registry plus OS keychain dependency with a simpler layered config model:

- Read server definitions from two config files: workspace first, then user-global.
- Let workspace entries override global entries with the same `id`.
- Store password auth in plain text, documented as unsafe.
- Store certificate and private-key auth as filesystem paths only.
- Remove reliance on macOS Keychain, `keytar`, or any other OS credential store.

This change optimizes for operational simplicity and predictable cross-platform behavior over secret-at-rest protection.

## Goals

- Eliminate the current OS keychain dependency.
- Keep the credential model easy to inspect and edit manually.
- Support repo-local and user-global server definitions.
- Never store PEM or private-key contents in plugin-managed config.
- Preserve the current explicit remote-tool model and SSH runtime shape.

## Non-Goals

- Secret management or secure password storage.
- Automatic migration from the current encrypted registry.
- Environment-variable interpolation in v1 of this config-backed model.
- Support for more than two config scopes.

## Current Problem

The current branch stores the registry payload encrypted at rest and uses a `SecretProvider` backed by `keytar` to read or create a master key in the OS credential store. That behavior is acceptable on macOS but creates avoidable complexity, prompts, and portability concerns.

The user preference is to simplify:

- Plain-text passwords are acceptable if clearly documented as unsafe.
- Key and certificate auth should reference files already managed by the user.
- The plugin should not attempt to manage or protect key material itself.

## Proposed Design

### Config Scopes

Two config scopes will be supported:

1. Workspace config
2. User-global config

Read order:

1. Read the user-global config if present.
2. Read the workspace config if present.
3. Merge entries by `id`.
4. When both scopes define the same `id`, the workspace entry wins.

When a workspace entry overrides a global entry, CLI output should make that explicit so users understand which effective server is active.

### File Locations

Global config should live under the existing user config directory resolved by `env-paths`, for example:

- macOS: `~/Library/Preferences/open-code/servers.json`
- Linux: `~/.config/open-code/servers.json`
- Windows: `%AppData%/open-code/servers.json`

Workspace config should live in the repo/workspace root:

- `<workspace>/.open-code/servers.json`

The runtime should treat the presence of a workspace file as opt-in local override behavior.

### Data Model

The config file should remain intentionally small and explicit:

```json
{
  "servers": [
    {
      "id": "prod-a",
      "host": "10.0.0.5",
      "port": 22,
      "username": "ubuntu",
      "labels": ["prod"],
      "groups": ["cluster-a"],
      "auth": {
        "kind": "privateKey",
        "privateKeyPath": "./keys/prod-a.pem"
      }
    }
  ]
}
```

Supported auth shapes:

- `password`
  - fields: `kind`, `secret`
- `privateKey`
  - fields: `kind`, `privateKeyPath`, optional `passphrase`
- `certificate`
  - fields: `kind`, `certificatePath`, `privateKeyPath`, optional `passphrase`

Notes:

- `password.secret` is stored in plain text.
- `privateKey` and `certificate` entries store paths only.
- No PEM, private key, or certificate contents are copied into config.

### Path Rules

Workspace config:

- may use relative key/cert paths
- relative paths resolve from workspace root

Global config:

- key/cert paths must be absolute
- relative paths in global config should be rejected as invalid

At runtime, the effective server record should be normalized before SSH use:

1. determine effective scope for the selected record
2. resolve relative workspace paths
3. validate that referenced files exist and are readable
4. pass normalized auth inputs to the SSH runtime

### Registry Backend Changes

The current encrypted registry backend should be replaced with a config-backed registry implementation.

That means:

- remove the `SecretProvider` dependency from the active registry path
- stop encrypting the server registry payload
- stop calling `keytar`

The registry abstraction can remain, but it should now operate on layered config files rather than an encrypted blob.

Recommended interfaces:

- `list()`: return effective records with scope metadata
- `resolve(id)`: return effective record with scope metadata
- `upsert(scope, record)`: write to the chosen scope
- `remove(scope, id)`: remove from the chosen scope
- `listRaw(scope)`: read one scope without merge logic when the CLI needs direct scope inspection

## CLI Design

The existing CLI entrypoint should remain:

- `bun run server-registry add`
- `bun run server-registry list`
- `bun run server-registry remove`

### Add

Prompt sequence:

1. choose target scope
2. enter server identity fields
3. choose auth kind
4. prompt for auth-specific fields
5. warn if storing a plain-text password

Default scope behavior:

- if workspace config exists, default to workspace
- otherwise default to global

If adding a workspace entry whose `id` already exists in global config:

- print that the workspace entry will override the global entry

### List

Listing should show effective records and source scope, for example:

- `workspace`
- `global`

If an entry is overridden, the effective list should show the workspace record and should indicate that it shadows a global record when relevant.

### Remove

Removal must be scope-aware.

If the same `id` exists in both scopes:

- prompt which scope to remove from
- never remove both implicitly

This keeps layered config behavior explicit and avoids destructive surprises.

## Runtime Flow

For remote tool execution:

1. resolve the requested server `id` from the layered config registry
2. determine whether the effective record came from workspace or global scope
3. normalize auth paths if needed
4. validate file existence and readability for path-based auth
5. construct SSH auth options
6. continue through the existing orchestrator, policy, SSH, and audit flow

This keeps policy, SSH execution, and auditing unchanged while simplifying only the credential-storage layer.

## Errors And Diagnostics

The new registry path should return structured errors for:

- missing config file when a write target is expected
- malformed JSON
- invalid schema
- duplicate or conflicting records within one file if validation disallows them
- relative key/cert path in global config
- missing key/cert file
- unreadable key/cert file
- missing required auth fields

Helpful CLI messaging matters here because users are now directly editing config.

## Migration

No automatic migration in this pass.

If the old encrypted registry exists, the new config-backed flow should ignore it. Documentation should state that the credential backend changed and that users need to define servers in config files going forward.

This avoids partial migration logic and keeps the new behavior obvious.

## Testing

Required test coverage:

- parse and load a global-only config
- parse and load a workspace-only config
- workspace overrides global by `id`
- workspace relative path resolution works
- global relative path rejection works
- path validation failures are surfaced cleanly
- password auth records round-trip correctly through the config registry
- `add` chooses the expected default scope
- `add` warns when workspace overrides global
- `list` reports source scope
- `remove` prompts for scope when both scopes contain the same `id`

Integration smoke coverage should continue to validate:

- `list_servers`
- safe `remote_exec`
- `remote_write_file` approval behavior

with at least one real SSH target, including the disposable Docker SSH path already used for manual smoke testing.

## Risks

- Plain-text passwords are intentionally weaker than the current encrypted model.
- Users may accidentally commit workspace config files if ignore rules are not clear.
- File path auth depends on the target machine having stable path layout and permissions.

These are acceptable tradeoffs for the requested simplicity, but they must be documented directly.

## Implementation Note

Task 4 removed `keytar` from package metadata and synchronized the README with the config-backed registry model. The runtime design above remains unchanged.

## Recommendation

Implement this as a clean replacement of the current encrypted/keychain-backed registry path. Do not keep both systems active in parallel. The simpler model is easier to understand, easier to operate, and more likely to behave consistently across macOS, Linux, and Windows.
