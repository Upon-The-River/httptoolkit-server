# AGENTS.md

## Addon role

This directory contains external Android/headless/Qidian automation code extracted from the old working fork.

The addon should control official HTTP Toolkit externally where possible.

## Rules

1. Keep addon logic independent from official core.
2. Do not import from official `src/**` unless explicitly approved.
3. Prefer HTTP APIs, ADB commands, files, or a minimal bridge over direct core modification.
4. Do not copy whole official core files into the addon.
5. Do not apply patches from `../core-patches/` automatically.
6. Preserve Windows PowerShell compatibility.
7. Keep Qidian-specific rules inside addon config or addon modules.

## Preferred structure

* `src/android/` for ADB and Android network safety.
* `src/headless/` for headless process control.
* `src/session/` for session state and health.
* `src/export/` for live export logic.
* `src/qidian/` for Qidian traffic matching.
* `scripts/` for PowerShell entrypoints.
* `docs/` for runbooks.
* `patches/` for patch references only.

## Validation

When changing addon code, run the smallest relevant check available.

Prefer:

```powershell
npm run typecheck
npm test
```

If checks cannot run, report the exact reason.

## Final report

When done, report:

1. Files changed.
2. Imports adjusted.
3. Whether official core was touched.
4. Commands run.
5. Remaining blockers.
