# OpenShell Release Prep Design

Date: 2026-03-26
Branch: `registry-cli`
Status: Approved for planning

## Summary

Prepare the current codebase for a first pre-release review as `@junwu168/openshell` with CLI binary `openshell`.

The release-prep pass will:

- rename the product-facing package and CLI identity from the current working name to `openshell`
- make install and uninstall first-class user workflows
- auto-register the OpenCode plugin globally by merging into `~/.config/opencode/opencode.json`
- track touched workspaces so uninstall can remove every `.open-code/` directory created by the product
- clean up user-facing docs, examples, and metadata so the repo reads like a reviewable pre-release product

This is a productization pass, not a runtime redesign.

## Goals

- Publish as npm package `@junwu168/openshell`
- Expose CLI command `openshell`
- Optimize for global install via npm
- Support only OpenCode as the host integration in v1
- Auto-register the plugin globally in OpenCode config
- Provide a complete uninstall for pre-release testing
- Use `openshell`-owned config/data paths rather than piggybacking on OpenCode for internal product state

## Non-Goals

- Supporting `codex` or `claude code` in this pass
- Stable-release uninstall semantics
- Cross-host plugin abstraction work
- Reworking the remote-tool runtime beyond what naming/install lifecycle requires

## Product Identity

Package name:

- `@junwu168/openshell`

CLI binary:

- `openshell`

Host integration target:

- `opencode`

This separation must stay explicit in docs and code:

- `openshell` is the installed product
- `opencode` is the host client it integrates with

## Product Paths

OpenShell global product state should live under its own namespace:

- config: `~/.config/openshell`
- data: `~/.local/share/openshell`

These paths should be resolved with standard OS-appropriate app-directory helpers, but the logical names stay `openshell`.

OpenCode config remains where OpenCode expects it:

- `~/.config/opencode/opencode.json`

OpenShell must not store its own internal state under `~/.config/opencode` except for the plugin integration artifacts that OpenCode itself needs.

## Install Behavior

`openshell install` should be global-first and mostly non-interactive.

Responsibilities:

1. ensure `openshell` config/data directories exist
2. install or refresh the OpenCode plugin files in the global OpenCode area
3. read `~/.config/opencode/opencode.json` if it exists
4. merge in:
   - the `openshell` plugin registration
   - the required permission rules for the explicit remote toolset
5. write the merged config back safely
6. initialize the workspace-tracker file if missing
7. print a concise summary of installed artifacts

Important rules:

- merge existing OpenCode config, do not replace it
- preserve unrelated plugins, providers, agents, and user settings
- if OpenCode config does not exist yet, create the minimal valid config needed for `openshell`

## Uninstall Behavior

`openshell uninstall` should be aggressively clean during pre-release.

Responsibilities:

1. remove the `openshell` plugin registration from `~/.config/opencode/opencode.json`
2. remove global OpenCode plugin files installed by `openshell`
3. read the tracked workspace list from `~/.local/share/openshell`
4. delete each tracked workspace `.open-code/` directory if it still exists
5. remove `~/.config/openshell`
6. remove `~/.local/share/openshell`
7. print a cleanup summary including failures

For this unstable phase, uninstall should attempt a complete cleanup rather than a conservative partial one.

## Workspace Tracking

OpenShell should maintain its own registry of touched workspaces under its data directory.

Tracked information:

- workspace root path
- managed `.open-code/` path
- optional timestamp of first/last touch

Usage:

- install/bootstrap flows append the current workspace when OpenShell creates or manages its local plugin/runtime artifacts
- uninstall reads the tracker and removes all tracked workspace `.open-code/` directories

This avoids filesystem-wide scanning and makes cleanup deterministic.

## OpenCode Integration

V1 supports only OpenCode.

OpenShell should install a global OpenCode integration by:

- writing the OpenShell plugin files where global OpenCode config can reference them
- merging the plugin entry into `~/.config/opencode/opencode.json`
- ensuring the required permissions are present for the explicit remote tools

The integration should remain explicit. OpenShell is not replacing OpenCode behavior; it is registering an additional plugin/toolset into it.

## CLI Surface

The release-prep pass should make the CLI feel productized.

Minimum first-class commands:

- `openshell install`
- `openshell uninstall`
- `openshell server-registry add`
- `openshell server-registry list`
- `openshell server-registry remove`

The existing registry functionality remains, but it should now live under the `openshell` product surface rather than being a Bun-script-centric workflow.

## Repository Cleanup For Pre-Release Review

This pass should make the repo review-ready by cleaning up product-facing artifacts:

- rename package metadata and user-facing strings to `openshell`
- remove stale `open-code` or keychain-era wording from README/examples/installation docs
- ensure examples and checked-in smoke files match the released install story
- reduce obvious implementation-era leftovers where they confuse reviewers

This is not a generic refactor. Cleanup should be driven by release-readiness and user comprehension.

## Verification Requirements

The finished release-prep pass should be reviewable with a concrete path:

1. install globally from the package
2. confirm global OpenCode registration was merged successfully
3. register a server via `openshell server-registry add`
4. run OpenCode and verify:
   - `list_servers`
   - safe `remote_exec`
   - approval-gated `remote_write_file`
5. run `openshell uninstall`
6. verify:
   - global OpenShell config/data removed
   - OpenCode plugin registration removed
   - tracked workspace `.open-code/` directories removed

## Risks

- Auto-merging OpenCode config can accidentally duplicate entries unless matching rules are careful.
- Full uninstall can remove more than intended if ownership boundaries are sloppy.
- Naming cleanup can miss small user-facing leftovers and create review friction.

These risks are acceptable, but the implementation must make ownership and merge behavior explicit.

## Recommendation

Implement this as a focused productization pass on top of the current runtime:

- do not redesign the remote execution core again
- do build proper install/uninstall lifecycle
- do make naming, docs, and examples coherent for a pre-release reviewer

That is the shortest path from “working branch” to “npm-installable, reviewable first version candidate.”
