# Extraction Report

Date: 2026-04-25 (UTC)
Source archive: `httptoolkit-lab-migration-package.zip`

## Actions performed

1. Extracted archive to a temporary directory.
2. Copied `lab-addon/` contents into repository `lab-addon/`.
3. Copied `core-patches/` into repository `core-patches/` as reference-only patch files.
4. Copied `inventory/` into `migration-notes/inventory/`.
5. Copied `codex-prompts/` into `migration-notes/codex-prompts/`.
6. Did not copy any files into official `src/**`.
7. Removed root archive `httptoolkit-lab-migration-package.zip` after successful extraction.

## Extracted top-level package structure observed

- `lab-addon/`
- `core-patches/`
- `inventory/`
- `codex-prompts/`
- `tools/`
- `MIGRATION_MANIFEST.json`
- `README_迁移包说明.md`
- `VALUE_ASSESSMENT.md`
- `MIGRATION_STEPS.md`

## Notes

- `core-patches/` files are included for manual reference only and were not applied.
- Official core source files under `src/**` were not modified by this migration extraction task.
