# openshell

## Development

Install dependencies with `bun install`, run the test suite with `bun test`, and build with `bun run build`.

Integration tests rely on Docker because `tests/integration/fake-ssh-server.ts` uses `testcontainers`.

## Server Registry CLI

Use the interactive registry helper to manage real test targets for the OpenCode plugin:

1. `bun run server-registry add`
2. `bun run server-registry list`
3. `bun run server-registry remove`

The helper stores server records in the existing encrypted local registry and uses the Keychain-backed master key flow already used by the plugin runtime.

## Manual OpenCode Smoke Test

1. Run `bun run server-registry add` and register a real password-based SSH target.
2. Optionally confirm it with `bun run server-registry list`.
3. Run `bun run build`.
4. Change into `examples/opencode-local`.
5. Start `opencode`.
6. Ask for `list_servers`.
7. Ask for `remote_exec` with `cat /etc/os-release`.
8. Ask for `remote_write_file` and confirm that the approval prompt appears.
