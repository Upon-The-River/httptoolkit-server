# lab-addon Business Chain and State Semantics

## 1. Layer boundary

official core / Mockttp only owns:
- proxy/admin/certificate/session baseline capabilities;
- Android activation bridge;
- request/response event observation;
- optional live export hook.

lab-addon owns:
- Android start/stop/recover orchestration;
- Qidian/target traffic matching;
- export ingest / JSONL persistence;
- connection health;
- watchdog-facing state model;
- experimental automation.

Forbidden:
- moving long-running Qidian/Android/session business flows back into official core;
- blindly applying `core-patches/` into official core;
- implementing business target matching in core files.

## 2. Evidence taxonomy

1. control-plane evidence
   - e.g. 45458 bridge health, 45456 admin reachability, proxy session registry.
   - indicates desktop control-plane readiness only, never mobile capture active on its own.

2. mobile-capture evidence
   - e.g. fresh VPN evidence, HTTP Toolkit activity evidence, ADB device online.
   - generic Android VPN/TUN/provider mentions (e.g. `activeNetworkMentionsVpn`, `VpnNetworkProvider`) are supportive only and are not HTK-specific capture proof.
   - `active` requires fresh HTK-specific mobile signals (e.g. HttpToolkit mentions/proxy runnable) or data-plane/target/probe evidence.
   - must include timestamp and expires after recency window.

3. passive data-plane evidence
   - e.g. JSONL growth, `/export/ingest` with `persisted=true`.
   - strong positive evidence that data-plane is alive.

4. target-traffic evidence
   - e.g. `targetMatched=true`, newly observed target records.
   - strong positive evidence that target business traffic is alive.

5. session-state evidence
   - start/stop/recover `observedAt`.
   - compare by timestamp recency; older stop must not override newer start/recover.

## 3. State semantics

active:
- can only be triggered by recent data-plane / target-traffic / active probe / fresh mobile-capture evidence.
- `controlPlaneAlive=true` alone cannot trigger active.

idle:
- control-plane available but no recent data-plane / target-traffic / mobile-capture active evidence.
- means desktop side is ready but mobile-side activity is not observed, not disconnected.

degraded:
- partial anomalies in control-plane/device/bridge/mobile evidence, without strong disconnection proof.

unknown:
- insufficient evidence to decide.

disconnected:
- only triggered by strong failure evidence sustained past threshold.
- JSONL not growing is not disconnection evidence.
- bridge unreachable alone is not disconnection evidence.
- safe-stub stop is not session-stopped evidence.

## 4. Non-negotiable rules

- JSONL growth => cannot be disconnected.
- JSONL not growing => only idle/no recent traffic, not disconnected.
- bridge-unreachable => control-plane degraded/non-fatal evidence only, not disconnected alone.
- control-plane alive => idle/ready only, not active alone.
- `activeNetworkMentionsVpn` cannot trigger `active` by itself; treat as auxiliary generic VPN evidence only.
- stop/recover with `safeStub=true` or `implemented=false` cannot be used as real state-transition evidence.
- stop evidence is valid only when newer than latest successful start/recover evidence.
- successful recover must clear prior stop failure chain.
- all bridge/core HTTP calls must use AbortController/timeout.
- bridge 5xx/timeout must fallback to ADB intent and must not swallow fallback.
- traffic evidence from bridge mode and addon self-session mode must not be mixed.

## 5. Test policy

When changing connection-state logic, add/modify tests for:
- control-plane alive alone => idle, not active.
- JSONL not growing => not disconnected.
- bridge unreachable alone => not disconnected.
- safeStub stop => not session-stopped.
- real stop newer than start => can become session-stopped after threshold.
- recover newer than stop => clears stop evidence.
- bridge timeout/5xx => fallback to ADB intent.
- official bridge URL env override affects both activation client and health check.
