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
