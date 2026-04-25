# AGENTS.md

## Repository role

This repository should remain as close as possible to the official HTTP Toolkit server.

Local Android/Qidian/headless automation features must live under `lab-addon/` unless a task explicitly approves a minimal core patch.

## Default editable area

By default, only modify:

- `lab-addon/**`
- `docs/lab-addon/**`
- `migration-notes/**`

## Forbidden unless explicitly approved

Do not modify these paths unless the task explicitly says "apply a core patch":

- `src/api/rest-api.ts`
- `src/interceptors/android/adb-commands.ts`
- `src/interceptors/android/android-adb-interceptor.ts`
- `src/index.ts`
- `src/client/http-client.ts`
- `src/shutdown.ts`
- `src/util/fs.ts`
- `package.json`
- `package-lock.json`
- `bin/**`
- `.github/**`
- `nss/**`
- `overrides/**`
- `httptoolkit-android-main/**`

## Core patch rule

Do not apply files from `core-patches/` automatically.

If official core access is required:

1. Write a patch proposal first.
2. Explain why addon-only integration is insufficient.
3. List the exact official files that must change.
4. Do not apply the patch until explicitly approved.

## Migration rule

When migrating functionality from the old working fork:

1. Extract the capability into `lab-addon/`.
2. Keep official core unchanged.
3. Keep Qidian-specific logic inside addon config or addon modules.
4. Preserve Windows PowerShell compatibility.
5. Do not overwrite official files with working-fork files.

## Change discipline

- Do not run whole-repository formatting.
- Do not delete tests to make checks pass.
- Do not mix migration, refactor, and feature work in one task.
- Prefer small, reversible commits.

## Validation

For insertion-only tasks:

```powershell
git status
git diff --stat
````

For addon code tasks:

```powershell
cd lab-addon
npm run typecheck
npm test
```

For official core patches, run the smallest relevant official test command and report exactly what was run.

## Final report format

Every task must report:

1. Files changed.
2. Whether official core files were modified.
3. Behavior changed or preserved.
4. Tests or checks run.
5. Risks.
