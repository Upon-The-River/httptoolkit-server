# AGENTS.md

This addon contains extracted Android/headless/Qidian lab features from a modified HTTP Toolkit server fork.

Safety rules:
- Do not modify the official HTTP Toolkit repository unless a task explicitly says so.
- Prefer external addon implementation over core patches.
- Keep Qidian-specific logic in `src/qidian` or config files.
- Keep Android recovery workflows in `src/android`.
- Do not copy large automation route blocks back into `src/api/rest-api.ts`.
- Use `core-patches/` as reference only; do not apply patches blindly.

Completion report must include: files changed, behavior preserved/changed, tests run, risks.
