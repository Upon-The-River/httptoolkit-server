# Android automation route compatibility (addon migration)

## Summary

The old working fork exposed Android automation routes from official core (`src/api/rest-api.ts`).
This migration restores route compatibility in `lab-addon` instead, keeping official core unchanged.

## Old vs new route location

- Old working fork route location: official core REST API patch (reference only).
- New route location: addon server routes under `lab-addon/src/server.ts`.

Implemented addon routes:

- `POST /automation/android-adb/start-headless`
- `POST /automation/android-adb/stop-headless`
- `POST /automation/android-adb/recover-headless`
- `GET /automation/health`

## Compatibility response shape

`POST /automation/android-adb/start-headless` returns a compatibility payload including:

- `success`
- `deviceId`
- `proxyPort`
- `session` (`active`, `source`, `details`)
- `controlPlaneSuccess`
- `dataPlaneObserved`
- `targetTrafficObserved`
- `trafficValidated`
- `activationResult`
- `health`
- `errors`

## Behavior in this addon slice

- Parses requested automation options including `allowUnsafeStart` and traffic wait flags.
- Inspects Android network baseline with addon Android network safety service.
- Blocks start when warnings exist unless `allowUnsafeStart=true`.
- Uses a pluggable `AndroidActivationClient` abstraction for capture activation.
- Updates addon-owned `AutomationHealthStore` with latest automation state.
- Returns conservative safe-stub responses for stop/recover by default.

## Known gaps / future bridge needs

- Full parity with legacy core activation internals requires an approved bridge to official/mockttp control plane.
- Default activation client is safe/conservative; production activation logic must be explicitly wired.
- stop/recover remain intentionally conservative until a safe non-recursive implementation is approved.

## Safety constraints preserved

- No official core files modified.
- No wholesale application of old `rest-api.ts` or `adb-commands.ts` patches.
- No recursive endpoint self-calls.
- No arbitrary process kill behavior.
- No script invocation with `-UseAddonServer` from addon server internals.
