# httptoolkit-lab-addon

This is a migration-stage external addon for local Android/headless/Qidian tooling that was previously embedded inside a modified HTTP Toolkit server fork.

## Service slice status

`lab-addon` now runs as a small standalone HTTP service. It focuses on migration-safe utility endpoints and **does not apply any HTTP Toolkit core patches**.

Migration material under `migration-assets/` is **reference-only** for incremental extraction and normalization. It is not wired into the running addon service.

## Available endpoints

- `GET /health`
  - Returns addon process health.
- `GET /migration/pending-routes`
  - Lists route groups still pending migration from the old fork.
- `POST /qidian/match`
  - JSON input: `{ "url": "..." }`
  - Returns whether the URL matches Qidian target traffic rules.
- `GET /session/latest`
  - Returns the latest `SessionManager` state snapshot.
- `POST /session/target-signal`
  - Optional JSON input: `{ "waitMs": 1000, "pollIntervalMs": 200 }`
  - Returns target traffic observation signal from `SessionManager`.

## Run locally

```powershell
cd httptoolkit-lab-addon
npm install
npm run typecheck
npm test
npm run start
```

Default bind: `http://127.0.0.1:45457`

## PowerShell curl examples

Health:

```powershell
curl http://127.0.0.1:45457/health
```

Pending migration routes:

```powershell
curl http://127.0.0.1:45457/migration/pending-routes
```

Qidian matcher:

```powershell
curl -Method POST -Uri http://127.0.0.1:45457/qidian/match `
  -ContentType 'application/json' `
  -Body '{"url":"https://www.qidian.com/book/1010868264/"}'
```

Session latest state:

```powershell
curl http://127.0.0.1:45457/session/latest
```

Session target signal:

```powershell
curl -Method POST -Uri http://127.0.0.1:45457/session/target-signal `
  -ContentType 'application/json' `
  -Body '{"waitMs":0,"pollIntervalMs":0}'
```
