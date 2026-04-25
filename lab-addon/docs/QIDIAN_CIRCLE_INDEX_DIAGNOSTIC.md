# Qidian circleIndex Diagnostic

## Scope correction (must follow)

- `circleIndex` is **出圈指数 H5**.
- It is **not** 书友圈/discussion/community/forum.
- It is **not** `openDiscussArea` semantics.
- Do not use `discuss/community/forum` as primary diagnosis direction for circleIndex.

## Context correctness

- External Chrome opening HTML shell does **not** mean the data page is valid.
- Target runtime is QDReader internal `QDBrowserActivity` + WebView.

## Diagnostic status classes

- `external_chrome_context`
- `qdreader_webview_context`
- `h5_shell_loaded`
- `data_api_observed`
- `data_api_missing`
- `circleIndex_h5_webview_blank`
- `network_not_clean_skip_circle_diagnosis`

## `circleIndex_h5_webview_blank` criteria

Mark as `circleIndex_h5_webview_blank` only when all conditions are true:

1. Foreground activity is `com.qidian.QDReader/.ui.activity.QDBrowserActivity`.
2. WebView exists.
3. `browser_title` is empty or visible UI text is empty.
4. Within 30 seconds there is no related request containing keywords like:
   - `circleIndex`
   - `index`
   - `score`
   - `rank`
   - `booklevel`
   - `h5.if.qidian`
   - `qdfepccdn`

## Network gate before circle diagnosis

If doctor reports any of:

- `partial-connectivity`
- `route-broken`
- `dns-broken`

Then do **not** diagnose circleIndex page itself. Fix network first, then re-run circleIndex diagnostics.

## Main-flow isolation

circleIndex failure diagnosis must **not** block/poison detail-entry primary flow status.
