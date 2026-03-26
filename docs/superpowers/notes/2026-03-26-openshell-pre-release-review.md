# OpenShell Pre-Release Review Note

Date: 2026-03-26
Branch: `registry-cli`

## Scope

This branch prepares the first pre-release review candidate for:

- npm package: `@junwu168/openshell`
- CLI binary: `openshell`
- supported host: `opencode`

It includes:

- renamed package and runtime paths under the `openshell` product namespace
- first-class CLI commands for `install`, `uninstall`, and `server-registry`
- global OpenCode registration through merged `~/.config/opencode/opencode.json`
- tracked-workspace cleanup for aggressive pre-release uninstall
- docs/examples aligned with the global npm install story

## Automated Verification

Verified on the final Task 5 head with:

```bash
~/.bun/bin/bun test
~/.bun/bin/bun run typecheck
~/.bun/bin/bun run build
```

Observed result:

- `bun test` -> `96 pass, 0 fail`
- `typecheck` -> pass
- `build` -> pass

## Isolated Install/Uninstall Smoke

Smoke-tested with a temporary `HOME` so the run did not touch the real user config:

```bash
HOME="$TMP_ROOT/home" ~/.bun/bin/bun run openshell install
HOME="$TMP_ROOT/home" ~/.bun/bin/bun run openshell uninstall
```

Then verified using runtime-resolved paths from `createRuntimePaths(process.cwd())`:

- OpenShell config directory existed after install
- OpenShell data directory existed after install
- OpenCode config file existed after install
- OpenCode config contained `@junwu168/openshell` after install
- OpenShell config and data directories were removed after uninstall
- OpenCode config still existed after uninstall
- OpenCode config no longer contained `@junwu168/openshell` after uninstall

Platform note:

- On this macOS machine, `env-paths` resolved under `HOME/Library/...`
- The XDG variables were not the controlling paths for this smoke run

## Review Path

Reviewer flow:

1. `npm install -g @junwu168/openshell`
2. `openshell install`
3. `openshell server-registry add`
4. Launch `opencode`
5. Exercise:
   - `list_servers`
   - safe `remote_exec`
   - approval-gated `remote_write_file`
6. `openshell uninstall`

## Important Fix During Verification

The first full verification pass exposed an uninstall bug that the earlier tests missed:

- if OpenCode config only contained `@junwu168/openshell`, uninstall preserved the plugin entry because the config writer spread `...current` back into the output when the filtered plugin list became empty

This is now covered by `tests/unit/opencode-config.test.ts` and fixed in `src/product/opencode-config.ts`.
