# CORE_HOOK_PROPOSAL_live_export

## Status update (April 27, 2026)

- **Implemented (minimal core hook):** official core can now forward observed HTTP request/response events to addon `POST /export/ingest` when explicitly enabled.
- **Still not implemented:** addon `GET /export/stream` remains a stub/capability endpoint (`requires-core-hook`) and does not yet provide a realtime subscriber stream.

## Context

The addon implements export target loading, rule matching, event ingestion, and runtime JSONL persistence under addon-owned routes. The minimal official-core bridge now feeds real observed traffic into this existing addon ingestion pipeline.

## Implemented core hook (minimal + generic)

Official core adds an isolated bridge module at:

- `src/export/live-export-addon-bridge.ts`

Behavior:

- Reads opt-in config from env vars.
- Listens to completed Mockttp request/response events.
- Normalizes generic observed HTTP event data.
- Best-effort `POST`s to `{baseUrl}/export/ingest`.
- Never adds Qidian-specific logic.
- Never writes JSONL in core.
- Never throws into the interception path on bridge failures.
- May request `persist=true`, but addon persistence is target-gated.

## Current delivery payload

```json
{
  "persist": true,
  "event": {
    "observedAt": "2026-04-27T00:00:00.000Z",
    "method": "GET",
    "url": "https://example.com/path",
    "statusCode": 200,
    "contentType": "application/json",
    "requestHeaders": {"accept": "*/*"},
    "responseHeaders": {"content-type": "application/json"},
    "bodyText": "{\"ok\":true}",
    "source": "official-core-hook"
  }
}
```

For non-text responses, core attempts `bodyBase64`; if unavailable, payload is metadata-only.

## Addon persistence semantics (target-gated default)

`POST /export/ingest` now enforces target matching before JSONL persistence:

- `persist=true` + matched target => write JSONL (`persisted=true`, `outputPath` returned).
- `persist=true` + unmatched target => no JSONL write (`persisted=false`, `skippedPersistenceReason="no-target-matched"`).
- unmatched events are still normalized and returned for observability/debugging.

This keeps official core generic while ensuring addon rules control which traffic is actually persisted.

## Remaining gaps

1. `/export/stream` is still a non-streaming stub and should continue to report `requires-core-hook`.
2. Body capture is best effort and content-type dependent.
3. Hook is process-local and opt-in via env flags.

## Rollback

Disable the hook by unsetting or setting:

- `HTK_LAB_ADDON_EXPORT_ENABLED=false`

This reverts behavior to addon synthetic/manual ingest only, without changing addon API contracts.
