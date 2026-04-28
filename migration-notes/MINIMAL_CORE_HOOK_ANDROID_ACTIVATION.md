# Minimal core hook: Android activation bridge

## Why addon-only was insufficient

`lab-addon` can send Android ACTIVATE intents, but addon-only mode cannot prove official interceptor/session readiness without an official bridge endpoint.

## Port split

- `45456` = Mockttp admin API. It will not host `/automation/*` routes.
- `45457` = official REST/GraphQL API + `lab-addon` compatibility routes.
- `45458` = dedicated official Android activation bridge (local-only, opt-in).

Using a dedicated bridge port avoids the previous route/port confusion where `/automation/*` logic was added to `src/api/rest-api.ts` even though consumers were checking `45456`.

## Official files changed

- `src/api/rest-api.ts`
  - Removed `/automation/*` bridge routes from the REST API surface.
- `src/automation/android-activation-bridge-server.ts`
  - Added dedicated bridge server on `127.0.0.1`.
  - Routes:
    - `GET /automation/health`
    - `POST /automation/android-adb/start-headless`
  - Uses `apiModel.getInterceptorMetadata()` and `apiModel.activateInterceptor('android-adb', ...)`.
  - Ensures/creates proxy port via Mockttp admin (`45456`) only when needed.
- `src/api/api-server.ts`
  - Exposes `getApiModel()` for minimal bridge startup wiring.
- `src/index.ts`
  - Starts bridge only when `HTK_ANDROID_ACTIVATION_BRIDGE_ENABLED=true`.
  - Port controlled by `HTK_ANDROID_ACTIVATION_BRIDGE_PORT` (default `45458`).
  - Server continues unchanged when disabled.
- `test/unit/rest-api-automation-bridge.spec.ts`
  - Tests disabled-by-default behavior, enabled health route, activation call path, localhost binding, failure structure, and no-Qidian guard.

## Addon files changed

- `lab-addon/src/automation/adb-android-activation-client.ts`
  - Default official bridge URL changed to `http://127.0.0.1:45458`.
  - `LAB_ADDON_OFFICIAL_ADMIN_BASE_URL` still overrides.
- `lab-addon/test/adb-android-activation-client.spec.ts`
  - Updated defaults and assertions so client does not call `45456` or `45457` by default.
- `lab-addon/README.md`
  - Updated port mapping and bridge validation examples.

## Bridge env vars

- `HTK_ANDROID_ACTIVATION_BRIDGE_ENABLED=true` (required to start the bridge)
- `HTK_ANDROID_ACTIVATION_BRIDGE_PORT` (optional, default `45458`)
- `LAB_ADDON_OFFICIAL_ADMIN_BASE_URL` (addon override for bridge base URL)

## Validation commands

```bash
curl http://127.0.0.1:45458/automation/health
curl -X POST http://127.0.0.1:45457/automation/android-adb/start-headless \
  -H 'content-type: application/json' \
  -d '{"deviceId":"<id>","proxyPort":8000,"enableSocks":false,"allowUnsafeStart":true}'
```


## Real-device bootstrap validation issue (April 27, 2026)

Observed real-device behavior before this fix:

1. `lab-addon` called the official bridge successfully.
2. Android app received the ACTIVATE URL.
3. Proxy validation probes failed (`10.0.2.2`, `10.0.3.2`, LAN timeout; `127.0.0.1:8000` returned `503`).
4. Local check confirmed plain proxy response was `503` without Android bootstrap rules.

Fix implemented in official bridge flow:

- Added `src/automation/android-bootstrap-rules.ts`.
- Before `apiModel.activateInterceptor('android-adb', ...)`, bridge now prepares minimal Android bootstrap rules:
  - `http://android.httptoolkit.tech/config` -> JSON certificate payload.
  - `http://amiusing.httptoolkit.tech/certificate` -> PEM certificate response.
  - minimal pass-through fallback rule.
- Bridge response now includes:
  - `bootstrapRulesApplied`
  - `bootstrapResult`
  - warning: `VPN/data-plane success must be verified separately.`

If bootstrap preparation fails, bridge returns structured failure with error code:

- `android-bootstrap-rules-failed`

PowerShell validation command:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000
```

Expected outcome after bootstrap preparation: Android bootstrap/certificate validation path should be handled by configured rules (not a raw default `503`).

Control-plane success still does **not** prove VPN/data-plane success; verify Android traffic separately.

## Mockttp admin 403 during bridge session preparation (April 27, 2026)

Observed bridge failure after introducing dedicated bridge port `45458`:

- Bridge route responded from `45458` correctly.
- Internal session preparation attempted `http://127.0.0.1:45456/start?port=8000`.
- Mockttp admin returned HTTP `403`.
- Bridge reported:
  - `controlPlaneSuccess=false`
  - `bootstrapRulesApplied=false`
  - `certificateAvailable=false`
  - `errors=["activation-bridge-internal-error"]`

### Root cause

The bridge used `mockttp.getRemote({ adminServerUrl: "http://127.0.0.1:45456" })` without the trusted browser-style `Origin` header required by Mockttp admin CORS-gate policy.

### Fix

- Updated bridge session preparation to create remote Mockttp clients with:
  - `Origin: https://app.httptoolkit.tech`
- Updated bootstrap fallback session creation with the same trusted Origin.
- Added explicit bridge status fields:
  - `proxySessionPrepared` (true/false)
  - structured `proxySessionError` details (`code`, `message`, `statusCode`) when session preparation fails.
- Added explicit failure code:
  - `errors=["proxy-session-preparation-failed"]`
- Bridge now avoids activation attempts when proxy session preparation or bootstrap setup fails.

### Validation command

The raw admin endpoint can be checked directly (expected `403` without trusted Origin, success with trusted Origin):

```bash
curl -i -X POST "http://127.0.0.1:45456/start?port=8000"
curl -i -X POST "http://127.0.0.1:45456/start?port=8000" \
  -H "origin: https://app.httptoolkit.tech"
```

## Session-preparation alignment with old working-fork (April 28, 2026)

### Why pure addon mode was still insufficient

Addon-only activation could trigger control endpoints, but it could not guarantee that official core state for `proxyPort` was actually prepared (config + certificate + bootstrap rules on the same proxy session).

### Why `45456/start` HTTP `200` is not enough

A successful `POST /start` on Mockttp admin (`45456`) only confirms a start request response. It does **not** guarantee Android activation readiness. The bridge must still verify official config/certificate availability through `apiModel.getConfig(proxyPort)` before attempting interceptor activation.

### Minimal behavior restored from old implementation

A focused official helper (`src/automation/android-session-manager.ts`) now restores the minimum old `startSessionIfNeeded` readiness pattern:

1. Try `apiModel.getConfig(proxyPort)` first (reuse path).
2. If unavailable, call `POST http://127.0.0.1:45456/start?port=<proxyPort>` with `Origin: https://app.httptoolkit.tech`.
3. Re-check `apiModel.getConfig(proxyPort)`.
4. Require certificate content before continuing.
5. Return structured readiness diagnostics (`source`, `configAvailable`, `certificateAvailable`, `errors`, `warnings`).

Bridge ordering is now explicit and strict:

1. Prepare/reuse proxy session config.
2. Apply Android bootstrap rules to that proxy port.
3. Activate `android-adb` interceptor.
4. Report control-plane success only when both bootstrap and activation succeed.
5. Keep `dataPlaneObserved=false` unless real traffic is observed.

### What is still intentionally not restored

- No wholesale restore of old `src/api/rest-api.ts` automation block.
- No Qidian-specific behavior in official core bridge/session helper.
- No JSONL/live-export persistence introduced into Android activation path.
- No real-device dependency in unit tests.

### Validation commands

```bash
npm run build:src
npm run test:unit
cd lab-addon
npm run typecheck
npm test
```

## Android bridge session lifecycle fix (April 28, 2026)

Issue observed in the April 27 package:

1. Session preparation called Mockttp admin `POST /start?port=<proxyPort>`.
2. Bridge then created a second remote session and called `session.start(proxyPort)` again.
3. Duplicate start could trigger `EADDRINUSE` and unstable setup.
4. Bridge finally block stopped the managed session immediately after bootstrap rules, which could tear down proxy readiness before Android validation finished.

Lifecycle fix applied:

1. Bridge now prepares proxy readiness and rule session in one step (`prepareAndroidProxySession`).
2. Start path uses one coherent lifecycle: `getRemote(...).start(proxyPort)` exactly once, then verifies `apiModel.getConfig(proxyPort)` and certificate availability.
3. Existing-config path does not call start; if a safe rule-session handle is unavailable, bridge returns `existing-config-without-rule-session-handle` and stops.
4. Bootstrap rules are applied to the exact session returned by preparation (no separate fallback session in the successful bridge path).
5. Bridge no longer stops the session in `start-headless`; proxy stays alive for Android app bootstrap and validation.
6. `controlPlaneSuccess=true` only when session prep succeeded, certificate was available, bootstrap rules were applied, and `activateInterceptor('android-adb', ...)` succeeded.

Raw admin `POST /start` remains documented as an experimental check, but it is not used in the successful bridge session path unless a future design can safely return the exact same rule-session handle without a second start.

## Stale existing-config recovery for Android activation bridge (April 28, 2026)

### Real failure observed

Bridge `start-headless` could return:

- `proxySessionSource="existing-config"`
- `configAvailable=true`
- `certificateAvailable=true`
- `errors=["existing-config-without-rule-session-handle"]`

This happened when `apiModel.getConfig(proxyPort)` still returned config/certificate data, but the actual proxy listener/rule-session handle for that port no longer existed.

### Root cause

Official config/certificate state can outlive the active Mockttp rule-session handle. Existing-config reuse was incorrectly treated as fully usable even when no session handle was available for Android bootstrap rule attachment.

### Recovery behavior now implemented

1. Detect stale existing config if:
   - initial config exists,
   - initial certificate exists,
   - existing rule session handle is unavailable.
2. Mark `staleExistingConfig=true`.
3. Run exactly one fresh remote start attempt (`getRemote().start(proxyPort)` via session helper start mode).
4. Re-read `apiModel.getConfig(proxyPort)` after successful start.
5. Require refreshed certificate content before continuing.
6. Apply Android bootstrap rules to the recovered fresh session handle.
7. Activate `android-adb` only after bootstrap succeeds.

### Structured failure outcomes

- Fresh start cannot provide a handle:
  - `errors=["stale-existing-config-without-proxy-session"]`
- Fresh start succeeds but config missing on re-read:
  - `errors=["stale-existing-config-recovery-config-unavailable"]`
- Fresh start succeeds but certificate missing on re-read:
  - `errors=["stale-existing-config-recovery-certificate-unavailable"]`

## Addon wrapper/health/data-plane alignment after core bridge success (April 28, 2026)

Real-device runs now confirm the official core bridge control-plane path is healthy on `45458` with:

- `success=true`
- `controlPlaneSuccess=true`
- `proxyPort=8000`
- `proxySessionSource="stale-existing-config-recovered-by-remote-start"`
- `bootstrapRulesApplied=true`
- `ruleSessionHandleAvailable=true`
- `errors=[]`

### What was fixed in addon wrapper behavior

1. Addon `POST /automation/android-adb/start-headless` now treats official bridge success as authoritative control-plane success.
2. Wrapper preserves bridge proxy port (e.g. `8000`) and avoids addon-side second-start allocation on `8001`.
3. Health now keeps both:
   - `lastStartHeadless` (latest attempt)
   - `lastSuccessfulStartHeadless` (last known good control-plane result)
4. Later failed/redundant attempts no longer erase the last successful bridge state.

### VPN recognition evidence hierarchy

Some devices return `Can't find service: vpn` for `dumpsys vpn` even while capture is active. Addon now treats that as warning evidence (`dumpsys-vpn-unavailable`) and computes `vpnLikelyActive` from combined signals, including:

- bridge control-plane success,
- HTTP Toolkit activity/runnable signals when available,
- connectivity VPN mentions,
- JSONL growth and target traffic observations.

### Data-plane validation improvement

Addon now uses export output status and persisted JSONL records as strong data-plane evidence:

- output-size growth across activation window,
- target traffic matcher hits in persisted records.

On this device, real Qidian JSONL growth is stronger proof of active capture than `dumpsys vpn` availability.

### Warning-only noise patterns

These log patterns are now classified as warnings and do not force control-plane failure by themselves:

- `docker-unavailable`
- `unsupported-su-root-syntax`
- `non-tls-client-on-tls-path`
- `upstream-dns-failure`
- `upstream-socket-hangup`
- `vpn-ipv6-packet-warning`
