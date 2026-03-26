# openshell

`openshell` is an OpenCode plugin package for explicit remote SSH tools. It installs as the npm package `@junwu168/openshell` and exposes the CLI command `openshell`.

## Install

```bash
npm install -g @junwu168/openshell
openshell install
```

`openshell install` creates OpenShell state under the standard user paths and merges the global OpenCode integration into `~/.config/opencode/opencode.json`.

- OpenShell config: `~/.config/openshell`
- OpenShell data: `~/.local/share/openshell`
- Workspace registry override: `<workspace>/.open-code/servers.json`

## Add A Server

Use the first-class CLI to manage server entries:

```bash
openshell server-registry add
openshell server-registry list
openshell server-registry remove
```

The registry reads layered JSON config files:

- Workspace config: `<workspace>/.open-code/servers.json`
- Global config: the user config directory resolved by `env-paths` for `openshell`

Workspace entries override global entries with the same `id`.

Password auth is stored in plain text. That is intentionally simple for this pre-release and not recommended for long-term production use.

## Smoke Test In OpenCode

1. Run `openshell install`.
2. Run `openshell server-registry add` and register a reachable SSH target.
3. Start `opencode`.
4. Ask for `list_servers`.
5. Ask for `remote_exec` with `cat /etc/os-release`.
6. Ask for `remote_write_file` and confirm that the approval prompt appears.

## Uninstall

```bash
openshell uninstall
```

For this pre-release, uninstall is aggressive. It removes:

- the OpenShell registration from global OpenCode config
- `~/.config/openshell`
- `~/.local/share/openshell`
- tracked workspace `.open-code` directories created by OpenShell

## Development

Install dependencies with `bun install`, run the test suite with `bun test`, and build with `bun run build`.

Integration tests rely on Docker because `tests/integration/fake-ssh-server.ts` uses `testcontainers`.
