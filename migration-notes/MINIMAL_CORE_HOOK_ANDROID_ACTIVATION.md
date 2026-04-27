# Minimal core hook: Android activation bridge

## Why addon-only was insufficient

`lab-addon` can send the Android ACTIVATE intent, but addon-only mode cannot reliably confirm full official control-plane readiness when the official server does not expose a compatible activation bridge route.

To close that gap with the smallest possible core surface, this change adds a minimal official route bridge that:

- accepts addon/PowerShell-compatible automation route shapes
- reuses official interceptor activation (`apiModel.activateInterceptor('android-adb', ...)`)
- can allocate a proxy port by creating a Mockttp remote session only when needed

No Qidian/export/rescue/device-governance logic is moved into core.

## Official files changed

- `src/api/rest-api.ts`
  - Added `GET /automation/health`
  - Added `POST /automation/android-adb/start-headless`
  - Added a tiny `ensureProxyPort` hook (default: reuse request proxyPort or create a Mockttp remote session on 45456)
- `test/unit/rest-api-automation-bridge.spec.ts`
  - Bridge route success/failure/shape tests
  - Safety assertion that no Qidian text appears in the bridge module

## Addon files changed

- `lab-addon/src/automation/adb-android-activation-client.ts`
  - Tries official bridge first before ADB-intent-only fallback
  - Configurable official admin base URL:
    - `LAB_ADDON_OFFICIAL_ADMIN_BASE_URL`
    - default `http://127.0.0.1:45456`
  - Compatibility fallback: if default 45456 route is missing, also tries 45457 before partial fallback
- `lab-addon/test/adb-android-activation-client.spec.ts`
  - official bridge success path
  - 404 fallback path
  - structured bridge failure path
  - configurable admin base URL path
- `lab-addon/README.md`
  - documented official bridge-first behavior and environment variable

## Compatibility route shapes

- `GET /automation/health`
- `POST /automation/android-adb/start-headless`

Request body (bridge):

```json
{
  "deviceId": "device-serial",
  "proxyPort": 8000,
  "enableSocks": false,
  "allowUnsafeStart": true
}
```

Response shape (bridge):

```json
{
  "success": true,
  "deviceId": "device-serial",
  "proxyPort": 8000,
  "controlPlaneSuccess": true,
  "session": { "active": true, "created": false, "source": "requested" },
  "activationResult": { "success": true, "metadata": {} },
  "errors": []
}
```

## Old route compatibility result

- Core now exposes compatibility automation routes at the official REST API surface.
- Addon start-headless now delegates to official bridge first; when unavailable, it preserves previous partial ADB-intent fallback behavior.

## Rollback plan

1. Revert `src/api/rest-api.ts` bridge endpoints and helper.
2. Revert addon client bridge-first call path in `lab-addon/src/automation/adb-android-activation-client.ts`.
3. Keep addon fallback intent mode untouched.

Rollback impact: start-headless returns to previous partial behavior when no official bridge exists.

## Why Qidian/export/rescue logic stays out of core

This bridge intentionally handles only:

- proxy/session port resolution
- official Android ADB interceptor activation
- structured route compatibility response

It does **not** include:

- Qidian traffic matching
- JSONL/live export policy
- Android rescue or safety governance orchestration
- addon runtime file/process management

## Validation commands

```bash
npm run test:unit -- test/unit/rest-api-automation-bridge.spec.ts
cd lab-addon && npm run typecheck
cd lab-addon && npm test
```
