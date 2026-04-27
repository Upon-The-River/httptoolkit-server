# Real Device Validation Plan (Pre-Core-Hook Gate)

## Why validation happens before core-hook work

This migration keeps official HTTP Toolkit core files unchanged unless a minimal core hook is explicitly justified and approved.

Running addon-only real-environment validation first proves:

1. The addon can run in local operator environments.
2. Migrated addon capabilities work without touching official core.
3. Remaining gaps are isolated and evidence-backed.
4. Any future core-hook request is minimal, targeted, and necessary.

## What must pass before proposing `/export/stream` core hook

All of the following should pass (or be explicitly skipped with reason where optional):

- `npm run typecheck` in `lab-addon`.
- `npm test` in `lab-addon`.
- Addon endpoints reachable (`/health`, `/migration/status`, session/Qidian checks).
- Export dry-run path validated (`/export/match`, `/export/ingest`, `/export/output-status`).
- `/export/stream` confirmed as `requires-core-hook`/stub behavior.
- Optional Android checks (`/android/network/inspect`, `/android/network/rescue` dry-run) executed when device is available.
- Official repo verified unchanged (read-only `git status --short`).

## Evidence to collect

Collect and attach the following evidence for review:

- Validation script output from `lab-addon/scripts/validate-lab-addon.ps1`.
- Relevant addon logs from the validation run.
- `git -C <official-root> status --short` output.
- JSONL output path/status from `/export/output-status` (especially with `persist=true`), under `lab-addon/runtime/exports`.
- Android inspect report output, if Android checks were included.

## Criteria to move to minimal core-hook work

Proceed to minimal core-hook proposal only when:

1. Addon-only checks pass and behavior is stable.
2. `/export/stream` remains the clearly documented blocker.
3. Evidence shows addon cannot provide live stream events without official core integration.
4. Proposed core change scope is minimal and limited to the exact official hook points needed.
5. Proposal includes rollback path and confirms no unrelated official-core behavior changes.

