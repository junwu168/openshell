# openshell

## Development

Install dependencies with `bun install`, run the test suite with `bun test`, and build with `bun run build`.

Integration tests rely on Docker because `tests/integration/fake-ssh-server.ts` uses `testcontainers`.

## Manual OpenCode Smoke Test

1. Run `bun run build`.
2. Change into `examples/opencode-local`.
3. Start `opencode`.
4. Ask for `list_servers`.
5. Ask for `remote_exec` with `cat /etc/hosts`.
6. Ask for `remote_write_file` and confirm that the approval prompt appears.
