# OpenCode Remote Tools Handoff

Date: 2026-03-25
Execution mode: `subagent-driven-development`
Worktree: `.worktrees/opencode-v1`
Branch: `opencode-v1`

## Source Docs

- Spec: `docs/superpowers/specs/2026-03-25-opencode-remote-tools-design.md`
- Plan: `docs/superpowers/plans/2026-03-25-opencode-remote-tools.md`

## What Was Completed

- Tasks 1 through 9 from the implementation plan are complete.
- The OpenCode adapter now registers explicit remote tools:
  - `list_servers`
  - `remote_exec`
  - `remote_read_file`
  - `remote_write_file`
  - `remote_patch_file`
  - `remote_list_dir`
  - `remote_stat`
  - `remote_find`
- The local smoke fixture exists under `examples/opencode-local/`.
- Build output now aligns with package and smoke-fixture expectations by emitting `dist/index.js`.
- The plugin test no longer relies on checkout-specific absolute paths or global module-mock leakage.

## Final Verified State

Verified on the latest branch head after the approval-gap fix:

- `~/.bun/bin/bun test tests/unit/*.test.ts tests/integration/ssh-runtime.test.ts tests/integration/orchestrator.test.ts`
  - Result: `56 pass`, `0 fail`
- `~/.bun/bin/bun run typecheck`
  - Result: pass
- `~/.bun/bin/bun run build`
  - Result: pass

## Smoke-Test Evidence

- `examples/opencode-local/.opencode/plugins/open-code.ts` resolves successfully against the built package.
- `opencode run --print-logs "Call list_servers and print the raw tool result."` loaded the local plugin and executed `list_servers` successfully.
- OpenCode logs showed the custom tools were registered, including `list_servers`, `remote_exec`, `remote_read_file`, `remote_write_file`, `remote_patch_file`, `remote_list_dir`, `remote_stat`, and `remote_find`.
- Unit coverage now verifies the approval handoff path:
  - safe `remote_exec` does not call `context.ask(...)`
  - approval-required `remote_exec` calls `context.ask(...)` with built-in `bash` permission
  - `remote_write_file` calls `context.ask(...)` with built-in `edit` permission
  - the local example `opencode.json` is aligned to `bash` / `edit`, not custom tool ids

## Approval Gap Root Cause And Fix

- Root cause: OpenCode did not enforce `opencode.json` permission entries keyed by custom plugin tool names like `remote_write_file` or `remote_exec`.
- Evidence: interactive OpenCode allowed `remote_write_file` to run without a prompt and returned our structured `SERVER_NOT_FOUND` result.
- Fix: the adapter now explicitly requests approval through the plugin SDK `context.ask(...)` API before:
  - approval-required `remote_exec`
  - `remote_write_file`
  - `remote_patch_file`
- The adapter requests approval under OpenCode's built-in permission families:
  - `bash` for approval-required remote shell execution
  - `edit` for remote file mutations
- The example config now uses `bash` and `edit` permission keys accordingly.

## Residual Gap

- A fresh interactive manual re-check is still required on the latest head to confirm host-side prompt UX:
  - safe `remote_exec` must not prompt
  - `remote_write_file` must prompt before the tool returns `SERVER_NOT_FOUND` for a missing server
- The prior upstream OpenCode provider/certificate instability remains a possible source of noise for nontrivial end-to-end runs.

## Recommended Starting Point For The Next Session

- Start from the pushed `opencode-v1` branch.
- If the next session is feature design, begin from the shipped v1 boundary in the spec and treat this branch as the implementation baseline.
- If the next session is verification-focused, first re-run the manual OpenCode smoke flow on the latest head:
  1. `bun run build`
  2. `cd examples/opencode-local`
  3. `opencode`
  4. confirm `list_servers`
  5. confirm safe `remote_exec`
  6. confirm `remote_write_file` shows approval prompt
