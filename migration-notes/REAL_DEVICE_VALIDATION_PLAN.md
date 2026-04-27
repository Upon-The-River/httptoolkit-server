# Real Device Validation Plan (Pre-Core-Hook Gate)

## Why validation happens before core-hook work

This migration keeps official HTTP Toolkit core files unchanged unless a minimal core hook is explicitly justified and approved.

Running addon-only real-environment validation first proves:

1. The addon can run in local operator environments.
2. Migrated addon capabilities work without touching official core.
3. Remaining gaps are isolated and evidence-backed.
4. Any future core-hook request is minimal, targeted, and necessary.

## Validation evidence requirement

A validation evidence report is required before any core-hook implementation work.

Minimum passing evidence before core hook consideration:

- Required addon endpoint gates pass (`/health`, `/migration/status`, `/qidian/match`, `/session/latest`, export endpoints).
- `POST /session/start` is optional in default addon-only smoke; include it only with `-IncludeSessionStart` when full session backend conditions are available.
- `POST /export/ingest` with `persist=true` writes JSONL (`exists=true` and `sizeBytes>0` from `/export/output-status`).
- Official core cleanliness passes (no forbidden dirty official paths).
- `/export/stream` still correctly reports `requires-core-hook`/stub (typically HTTP `501` pre-core-hook), and this is PASS evidence (not a failure) before core-hook work.

Use `lab-addon/scripts/validate-lab-addon.ps1` with `-ReportPath` and retain the generated report artifact.

## What must pass before proposing `/export/stream` core hook

All of the following should pass (or be explicitly skipped with reason where optional):

- `npm run typecheck` in `lab-addon`.
- `npm test` in `lab-addon`.
- Addon endpoints reachable and required gates passing.
- Optional `POST /session/start` included only when explicitly validating full session backend conditions.
- Export ingest and output status validation complete.
- `/export/stream` confirmed as `requires-core-hook`/stub behavior (HTTP `501` remains acceptable and expected before core hook work, including script fallback to `/migration/status` capability metadata).
- Official repo verified unchanged (read-only `git status --short`) when `-OfficialRoot` is provided.
- Optional Android checks (`/android/network/inspect`, `/android/network/rescue` dry-run) included when Android is available.

Android evidence rules:

- If Android is available, include inspect/rescue dry-run evidence in the report.
- If Android is unavailable, mark Android checks `SKIP` with explicit reason (not `FAIL`).

## Evidence to collect

Collect and attach the following evidence for review:

- Validation script report output from `lab-addon/scripts/validate-lab-addon.ps1`.
- Relevant addon logs from the validation run.
- `git -C <official-root> status --short` summary (when provided).
- JSONL output path/status from `/export/output-status` after `persist=true` ingest.
- Android inspect/rescue dry-run result snippets, if Android checks were included.

Use `migration-notes/VALIDATION_EVIDENCE_TEMPLATE.md` to standardize evidence capture.

## Criteria to move to minimal core-hook work

Proceed to minimal core-hook proposal only when:

1. Addon-only checks pass and behavior is stable.
2. Validation evidence report is complete and reviewed.
3. `/export/stream` remains the clearly documented blocker.
4. Evidence shows addon cannot provide live stream events without official core integration.
5. Proposed core change scope is minimal and limited to the exact official hook points needed.
6. Proposal includes rollback path and confirms no unrelated official-core behavior changes.
