# Next Migration Steps

1. **Run runtime/device verification for uncertain patches (no core edits yet).**
   - Focus on `requires-runtime-verification` items from `CORE_PATCH_ADJUDICATION.md`:
     - Android ADB command/interceptor reliability deltas.
     - Windows launcher/runtime compatibility assumptions.
     - `fs.rm` vs `rimraf` compatibility on supported environments.
   - Output should be reproducible failure/success evidence, not patch application.

2. **Design and prototype a minimal live-export core hook (proposal only).**
   - Draft a tiny, generic core event emitter contract for observed HTTP traffic.
   - Keep payload transport-agnostic and bounded.
   - Keep Qidian logic strictly in addon matcher/config modules.
   - Validate with addon-side mocked emitter integration before any core patch request.

3. **Execute real-device end-to-end lab-addon validation.**
   - Validate start-headless/stop-headless/recover-headless/rescue-network workflows.
   - Validate session API + migration status registry updates.
   - Validate export match/ingest/file-sink behavior and current `/export/stream` limitation reporting.
   - Document residual risks and only escalate minimal core-hook request if addon-only remains insufficient.
