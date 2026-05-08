# Smoke Response Proof Timestamp Strategy

## Default mode: strict

Smoke response proof keeps strict timestamp gating enabled by default. A record must have a usable wall-clock proof timestamp and it must fall into the action window `[actionStartMs, actionStartMs + actionWindowMs]`.

`actionStartMs` must be captured from local desktop time (`Date.now()`) immediately before the click/action.

## Preferred record timestamp: `ingestedAt`

`ingestedAt` is the local desktop receive/write time produced by lab-addon export ingest. It is the preferred wall-clock timestamp for proofing action-window recency.

`observedAt` / `sourceObservedAt` may come from source/device-relative time. If `observedAtWallClockInvalid=true`, those fields are not usable as wall-clock proof timestamps.

## Read-time fallback (tail-only)

`readAt` / `__readAt` can be used as fallback only for action-after baseline tail reads (new appended records only), never for full-scan historical JSONL records.

When `readAt` fallback is used, runner should emit warnings:

- `response_proof_used_runner_read_at`
- `proof_time_is_read_time_not_ingest_time`

## Forbidden proof shortcuts

- Do not disable strict timestamp gating to force pass.
- Do not use post-hoc single `Date.now()` to retroactively timestamp all old records.
- Do not use JSONL file LastWriteTime as proof for individual record action window.

## Loose mode warning

If loose mode is enabled for temporary UI-chain checks, runner must warn:

- `response_proof_time_window_disabled`
- `proof_may_match_historical_jsonl_record`

Loose mode must not be the default acceptance mode.
