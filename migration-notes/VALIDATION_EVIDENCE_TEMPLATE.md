# Validation Evidence Template (Pre-Core-Hook)

Use this template to capture addon-only validation evidence before any minimal core-hook proposal.

## Environment

- Windows version:
- Node version:
- npm version:
- Official repo path:
- Addon path:
- Android device ID (if used):

## Commands run

```powershell
# List exact commands run for this validation session.
```

## Validation script report path

- Report file:
- Report format (Markdown/JSON):

## Summary table

| Check | Status (PASS/FAIL/WARN/SKIP) | Required | Notes |
|---|---|---|---|
| addon server reachable |  | true |  |
| GET /health |  | true |  |
| GET /migration/status |  | true |  |
| POST /qidian/match |  | true |  |
| POST /session/start |  | true |  |
| GET /session/latest |  | true |  |
| POST /export/match |  | true |  |
| POST /export/ingest |  | true |  |
| GET /export/output-status |  | true |  |
| GET /export/stream (requires-core-hook) |  | true |  |
| export persistence verification (persist=true) |  | conditional | Required when `-PersistExportTest` used |
| official-core-cleanliness |  | false | Required for core-hook readiness |
| Android inspect/rescue (optional) |  | false | Include when Android available |
| Headless dry-run (optional) |  | false | Include when requested |

## Failed checks

- List each failed check and remediation plan.

## Warnings

- List each warning and why it does or does not block next steps.

## Export JSONL output path

- `jsonlPath`:
- `exists`:
- `sizeBytes`:

## Official repo git status

```text
# Paste git -C <official-root> status --short output or summary from report.
```

## Android inspect summary

- Included: yes/no
- Device availability/authorization notes:
- Inspect result summary:
- Rescue dry-run summary:

## Decision

- Proceed to core hook: yes/no
- Blockers:
- Notes:

