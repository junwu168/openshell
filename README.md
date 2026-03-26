# openshell

## Development

Install dependencies with `bun install`, run the test suite with `bun test`, and build with `bun run build`.

Integration tests rely on Docker because `tests/integration/fake-ssh-server.ts` uses `testcontainers`.

## Server Registry CLI

Use the interactive registry helper to manage real test targets for the OpenCode plugin:

1. `bun run server-registry add`
2. `bun run server-registry list`
3. `bun run server-registry remove`

The helper now reads layered JSON config files instead of an encrypted registry or OS keychain.

- Workspace config: `<workspace>/.open-code/servers.json`
- Global config: the user config directory resolved by `env-paths` for `open-code` (for example `~/Library/Preferences/open-code/servers.json` on macOS, `~/.config/open-code/servers.json` on Linux, and `%AppData%/open-code/servers.json` on Windows)

Workspace entries override global entries with the same `id`.

Password auth is stored in plain text inside config. That is unsafe, but supported for convenience in trusted local setups.
Key and certificate auth store file paths only, not PEM contents or private key material.

Each config file is a top-level JSON array of server records.

Workspace example:

```json
[
  {
    "id": "local-dev",
    "host": "192.168.1.20",
    "port": 22,
    "username": "ubuntu",
    "auth": {
      "kind": "password",
      "secret": "plain-text-password"
    }
  ]
]
```

Global example:

```json
[
  {
    "id": "prod-a",
    "host": "10.0.0.5",
    "port": 22,
    "username": "ubuntu",
    "auth": {
      "kind": "privateKey",
      "privateKeyPath": "/Users/me/.ssh/prod-a.pem"
    }
  ]
]
```

## Manual OpenCode Smoke Test

1. Run `bun run server-registry add` and register a real password-based SSH target.
2. Optionally confirm it with `bun run server-registry list`.
3. Run `bun run build`.
4. Change into `examples/opencode-local`.
5. Start `opencode`.
6. Ask for `list_servers`.
7. Ask for `remote_exec` with `cat /etc/os-release`.
8. Ask for `remote_write_file` and confirm that the approval prompt appears.
