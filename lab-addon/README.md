# httptoolkit-lab-addon

This is a migration-stage external addon for local Android/headless/Qidian tooling that was previously embedded inside a modified HTTP Toolkit server fork.

## Structure

- **Runnable skeleton (`src/`)**
  - Standalone addon code that is expected to compile now.
  - Current entrypoint: `src/server.ts`.
  - Current normalized feature module: `src/qidian/qidian-traffic-matcher.ts`.
- **Migration assets (`migration-assets/`)**
  - Legacy files copied from the working fork and preserved for incremental normalization.
  - These may still import old in-core HTTP Toolkit paths.
  - They are intentionally excluded from standalone typechecking.
- **Reference patches (`core-patches/`)**
  - Reference material only.
  - Do not apply automatically to official core files.

Target principle:

```text
official HTTP Toolkit server = clean capture base
httptoolkit-lab-addon = Android control, network recovery, Qidian matching, live export, operational scripts
core patches = optional and manually reviewed only
```

## Run the standalone skeleton

```powershell
cd httptoolkit-lab-addon
npm install
npm run typecheck
npm run start
```

Health check:

```powershell
curl http://127.0.0.1:45457/health
```
