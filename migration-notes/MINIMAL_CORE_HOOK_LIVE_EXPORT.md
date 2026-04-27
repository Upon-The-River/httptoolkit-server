# Minimal Official-Core Live Export Hook

Date: 2026-04-27

Update: 2026-04-27 (persistence semantics)

## Exact files changed

Official core:
- `src/export/live-export-addon-bridge.ts`
- `src/index.ts`
- `test/unit/live-export-addon-bridge.spec.ts`

Addon/migration docs:
- `lab-addon/src/export/export-ingest-service.ts`
- `lab-addon/test/server.spec.ts`
- `lab-addon/test/export-ingest-service.spec.ts`
- `lab-addon/README.md`
- `lab-addon/docs/CORE_HOOK_PROPOSAL_live_export.md`
- `migration-notes/MINIMAL_CORE_HOOK_LIVE_EXPORT.md`

## Hook point chosen

Hook point: Mockttp completed request/response events per started mock session in `src/index.ts`.

- Request cache: `server.on('request')` records completed request metadata by id.
- Response completion: `server.on('response')` pairs with cached request, then emits a best-effort addon ingest POST.

Reasoning: minimal generic point with method/url/request headers from request and status/response headers/body access from response, with no REST API shape changes.

## Event shape emitted to addon `/export/ingest`

`POST {HTK_LAB_ADDON_BASE_URL}/export/ingest`

```json
{
  "persist": true,
  "event": {
    "observedAt": "ISO timestamp",
    "method": "GET",
    "url": "https://...",
    "statusCode": 200,
    "contentType": "application/json",
    "requestHeaders": {},
    "responseHeaders": {},
    "bodyText": "...",
    "bodyBase64": "...",
    "source": "official-core-hook"
  }
}
```

Body behavior:
- text-like content types => `bodyText` when available.
- non-text content => `bodyBase64` when available.
- unavailable body => metadata-only event.

## Environment variables

- `HTK_LAB_ADDON_EXPORT_ENABLED`
  - Hook enabled only when value is `1` or `true`.
  - Default: disabled.
- `HTK_LAB_ADDON_BASE_URL`
  - Default: `http://127.0.0.1:45457`.
- `HTK_LAB_ADDON_EXPORT_PERSIST`
  - Default: `true`.
- `HTK_LAB_ADDON_EXPORT_TIMEOUT_MS`
  - Default: `1000`.

## How to enable

```bash
HTK_LAB_ADDON_EXPORT_ENABLED=true \
HTK_LAB_ADDON_BASE_URL=http://127.0.0.1:45457 \
httptoolkit-server start
```

## How to disable

Unset `HTK_LAB_ADDON_EXPORT_ENABLED` (or set to `false`).

## Validation runbook

1. Start lab-addon server on `127.0.0.1:45457`.
2. Start official HTTP Toolkit server with:
   - `HTK_LAB_ADDON_EXPORT_ENABLED=true`
   - `HTK_LAB_ADDON_BASE_URL=http://127.0.0.1:45457`
3. Generate test HTTP traffic through HTTP Toolkit.
4. Check:
   - `GET http://127.0.0.1:45457/export/output-status`
   - `lab-addon/runtime/exports/session_hits.jsonl`

## Validation commands used for this patch

- `npm run build:src`
- `npm run test:unit -- --grep "LiveExportAddonBridge"`
- `cd lab-addon && npm run typecheck`
- `cd lab-addon && npm test`

## Rollback plan

1. Fast rollback (no code change): disable env flag `HTK_LAB_ADDON_EXPORT_ENABLED`.
2. Code rollback: revert commit touching core bridge module and index wiring.

## Why Qidian logic remains outside core

Core bridge only forwards generic HTTP observation metadata/body. Target matching and Qidian-specific traffic classification remains addon-owned (`lab-addon/src/qidian/**` and addon export match rules).

## Limitations

- Bridge is best-effort fire-and-forget and intentionally does not block request/response flow.
- Failures/timeouts do not crash core; events may be dropped if addon is unavailable.
- `/export/stream` remains non-streaming (`requires-core-hook`) in addon status endpoints.

## Persistence semantics (safety update)

Addon `/export/ingest` now gates persistence by export-target match:

- `persist=true` and event matches at least one configured target => JSONL append.
- `persist=true` and event does not match targets => no JSONL append, response includes:
  - `persisted: false`
  - `skippedPersistenceReason: "no-target-matched"`
- response always includes normalized `record` and `match` for debugging and traceability.

This means core can remain generic (including `persist=true` default) without causing full-traffic persistence. Actual persistence remains addon-owned and target-rule controlled.
