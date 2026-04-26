# CORE_HOOK_PROPOSAL_live_export

## Context

The addon now implements export target loading, rule matching, and synthetic event ingestion under addon-owned routes. This allows deterministic testing without requiring official core internals or real network traffic.

## Why addon-only cannot fully observe live traffic yet

- The addon process does not own the authoritative stream of completed HTTP exchanges from the official HTTP Toolkit interception pipeline.
- Live traffic events are generated inside official core interceptors/session components and are not currently emitted to external addon consumers.
- Without an official hook, `/export/stream` cannot provide true real-time HTTP Toolkit traffic, only synthetic/test traffic.

## Minimal official core hook needed

A minimal and non-domain-specific core hook should emit normalized traffic events from the official interception flow:

- Hook type: event emitter callback registration.
- Trigger: each completed request/response observation.
- Payload: transport-agnostic event object (no Qidian logic).
- Delivery: best-effort fire-and-forget to registered listeners.

Example proposal:

```ts
interface CoreObservedHttpEvent {
  observedAt: string;
  method: string;
  url: string;
  statusCode: number;
  responseHeaders: Record<string, string>;
  responseBodyBase64?: string;
}
```

## Why hook must stay generic (no Qidian-specific logic)

- Official HTTP Toolkit core must remain reusable and upstream-friendly.
- Qidian-specific matching/routing belongs in addon config and addon modules.
- Keeping the hook generic enables other addon use-cases and limits maintenance burden in core.

## How addon will consume the event

1. Core emits `CoreObservedHttpEvent`.
2. Addon bridge receives event.
3. Addon runs target matcher (`/export/match` logic).
4. Addon normalizes to JSONL-compatible record (`/export/ingest` logic).
5. Addon publishes to `/export/stream` subscribers and optional file sinks.

## Validation plan

- Phase 1 (done): synthetic ingestion tests and endpoint coverage in addon only.
- Phase 2 (future): integration test with a mocked core emitter (no real network).
- Phase 3 (future): controlled end-to-end smoke in lab environment.

## Rollback plan

- Keep core hook isolated behind a feature flag.
- If instability appears, disable the flag and return `/export/stream` to current `requires-core-hook` stub.
- Addon endpoints `/export/capabilities`, `/export/targets`, `/export/match`, and `/export/ingest` remain functional for synthetic testing regardless of hook availability.
