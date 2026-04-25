# Migration notes

This directory contains Codex task prompts and migration notes for extracting Android/headless/Qidian functionality into `lab-addon/`.

Default rule:

* Do not modify official HTTP Toolkit core files.
* Keep migration work under `lab-addon/**`.
* Use `core-patches/` only as a reference area.
* Apply official core patches only after explicit approval.

Validation:
After this task, run:

```powershell
git status
git diff --stat
git diff --name-only
```

Expected changed files:

* AGENTS.md
* lab-addon/AGENTS.md
* migration-notes/CODEX_FIRST_TASK.txt
* migration-notes/README.md

If any official core file changed, revert that change before finishing.

Return:

1. Files created or updated.
2. Confirmation that no official core files were modified.
3. Validation commands run.
4. Any risks or assumptions.
