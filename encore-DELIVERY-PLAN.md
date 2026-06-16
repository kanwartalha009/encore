# Encore — Delivery Plan & Guardrails (operational runbook)

> Companion to `encore-BUILD-PACK.md` (the phased spec) and `encore-PREREQUISITES.md` (the pre-build gate).
> This doc is **how the build is run**: phase gating, copy-paste Cowork prompts, production-safety guardrails, and the per-phase audit. Grounded in the platform's `docs/CHANGE-CONTROL.md` (invariants I-1…I-10, change classes C1/C2/C3) and `docs/04-plan/phased-plan.md` ("phases never reopen earlier phases' contracts").

---

## 0. How this works (the gating model)

- Build **phase by phase**, 0 → 5 (scope + gate per phase: build pack §3).
- **Start each phase in a NEW Cowork chat** using its prompt in §3 below — paste it as-is.
- Every prompt makes Cowork **first verify the previous phase from the real code + the Nova platform** (not from a ticked box). If anything fails, it **STOPS and reports** — the next phase stays locked.
- A phase is **done** only when (a) every gate item in build pack §3.N is verified *from code/platform evidence*, and (b) the **post-phase audit (§4)** passes with zero flags.
- The next phase unlocks **only** after the previous phase is done.
- **Exception — spec change:** if specs change, see §5. A change that touches a completed phase's frozen contract is a change-control event, not a free edit.

---

## 1. Progress tracker

Check a box only when that phase's gate (build pack §3.N) **and** the §4 audit are green.

- [ ] **Phase 0** — Foundation & feasibility
- [ ] **Phase 1** — Core preorder (P0 mechanics)
- [ ] **Phase 2** — The wedge (P0 differentiators)
- [ ] **Phase 3** — Waitlist + ARRS
- [ ] **Phase 4** — Reliability hardening & BFS
- [ ] **Phase 5** — Pilot & validation gate

---

## 2. Guardrails (production-safety — read before any change)

Once an app + the platform serve real merchants, an architecture change can break existing customers. These guardrails make that **impossible by default**.

### 2.1 Frozen contracts
When a phase passes, its contracts are **frozen** and may change **only additively**:

- **Per-app DB schema** (Prisma): additive migrations only — never drop/rename a column or table in use; no non-additive type change.
- **Nova integration contract**: install-confirm payload, the forwarded webhook topics + HMAC signing, billing sync — frozen (changing it is **C2**, it touches the platform).
- **Shopify surface**: selling-plan group/plan structure (active payment mandates depend on it), order tag + ship-date metafield keys, app-proxy paths (`/apps/encore/*`), OAuth scopes, webhook topics, and theme app-block names/settings (merchants have already placed them).
- **Endpoints + their auth modes.**
- **GDPR handlers** — never weakened.

### 2.2 Change classification (apply CHANGE-CONTROL.md)
| Class | What | Process |
|---|---|---|
| **C1** module-internal | no frozen contract touched | implement |
| **C2** contract | touches a frozen surface above or the Nova platform | update specs, list consumers, migrate together, **additive + backward-compatible** |
| **C3** architecture | violates an invariant (I-1…I-10) or breaks a frozen contract / active installs | **STOP.** Impact report + rollback plan + approval + ADR **before any code** |

### 2.3 The production rule (blocking)
**Anything that could affect a previously-completed phase or existing installs is BLOCKED until proven safe.** Before touching a frozen surface, answer:

1. Does it alter an existing contract (schema / endpoint / webhook / selling-plan / tag / metafield / proxy / scope)? If yes → it's **C2 or C3**.
2. Is it **additive + backward-compatible**? Is there a migration **and** a rollback?
3. Are **active installs or in-flight charges** affected? (Selling-plan changes must not orphan existing mandates. Note: Shopify deletes selling plans 48h after *uninstall* — active installs keep theirs, so structural changes must be backward-compatible.)

No change ships to a frozen surface without: **impact report → backward-compat proof (or additive-only) → audit green → approval.** Otherwise it is blocked.

### 2.4 Anti-hallucination
- **Never invent** a Shopify API, field, endpoint, scope, or webhook topic — verify against shopify.dev (Shopify dev MCP) before using it.
- **Never invent** a Nova platform endpoint/field not in the specs — flag a **spec gap** instead and stop.
- Every file/route/field referenced in code must actually exist; the §4 audit enforces this.

---

## 3. Per-phase Cowork prompts

Open a **new Cowork chat on this workspace** and paste the matching prompt. Each is self-contained.

### ▶ Phase 0 — start prompt

```
You are starting the build of the Encore Shopify app (preorder + back-in-stock for EU
fashion), specced in encore-BUILD-PACK.md and governed by encore-DELIVERY-PLAN.md. This is
PHASE 0 — Foundation & feasibility. Phase 0 has no predecessor.

STEP 1 — Prerequisites. Confirm encore-PREREQUISITES.md §1–§3 are satisfied (accounts,
toolchain, secrets/.env). If a required secret or env var is missing, STOP and list exactly
what's needed before continuing.

STEP 2 — Execute Phase 0 per build pack §3.0:
- `shopify app init` → React Router template. Wire shopify.app.toml: the 9 scopes, app proxy
  /apps/encore, webhook subscriptions (orders/create, orders/paid, inventory_levels/update,
  products/update, app/uninstalled, app_subscriptions/update, + the GDPR three), app URL.
- Embedded auth via token exchange; install on the EU multi-market dev store.
- Implement the Phase-0 Prisma tables (Shop, AppSettings) and migrate against APP_DB_URL__ENCORE.
- Nova wiring (build pack §5): install-confirm callback + webhook forwarding to ingress, both
  HMAC-signed.
- Resolve the TWO BLOCKING SPIKES (build pack §3.0): per-market selling plans, and the
  Shop Pay/charge-later payment dependency + deposit-only/pay-now fallback. They gate Phases 1–2.

GUARDRAILS (encore-DELIVERY-PLAN.md §2): never invent a Shopify or Nova API/field/scope —
verify on shopify.dev (Shopify dev MCP) and in the Nova specs; flag a spec gap instead of
guessing. Keep everything additive and within the specs (CHANGE-CONTROL.md).

STEP 3 — Close Phase 0:
- Check off the build pack §3.0 gate, each item from REAL code + Nova platform evidence (the
  platform shows the dev-store Installation ACTIVE; a forwarded event appears in the ingress log).
- Run the post-phase audit (encore-DELIVERY-PLAN.md §4) and produce a PASS/FLAG report.
- DO NOT start Phase 1. Stop and report.
```

### ▶ Phase N — start prompt (N = 1…5)

```
You are continuing the build of the Encore Shopify app, governed by encore-DELIVERY-PLAN.md
and specced in encore-BUILD-PACK.md. This is PHASE <N> — <name from build pack §3.N>.

STEP 1 — Verify Phase <N-1> is ACTUALLY complete, from the real code + the Nova platform
(not from ticked boxes):
- Walk build pack §3.<N-1> gate item by item; confirm each against the actual codebase and the
  Nova platform (admin + app-admin).
- Run the post-phase audit (encore-DELIVERY-PLAN.md §4).
- If ANY gate item or audit check fails, STOP, report the gap, and do not start Phase <N>.

STEP 2 — Execute Phase <N> per build pack §3.<N>:
- Build the screens tagged "Phase <N>" in build pack §6 and the backend scope in §3.<N>.
- Each screen is done only when its acceptance boxes (§6) check.
- GUARDRAILS (§2): work ADDITIVELY. Do NOT change any contract frozen by an earlier phase
  (schema / endpoint / webhook / selling-plan / tag / metafield / proxy / scope). If you must,
  STOP and treat it as a change-control event (C2/C3) — impact report + approval first. Never
  invent a Shopify or Nova API/field/scope; verify on shopify.dev and the Nova specs.

STEP 3 — Close Phase <N>:
- Check off the build pack §3.<N> gate from real code + platform evidence.
- Run the §4 audit; produce a PASS/FLAG report.
- DO NOT start Phase <N+1>. Stop and report.
```

---

## 4. Post-phase audit protocol (run at the end of every phase)

Cowork runs this before declaring a phase done and before any next phase is unlocked. **Any flag blocks the next phase.**

1. **Build health** — typecheck, lint, and tests are green.
2. **Schema diff** vs the previous phase — **additive-only** (no drop/rename/destructive type change). Any non-additive change is a guardrail breach (§2.3).
3. **Contract diff** — OAuth scopes, webhook topics, endpoints + auth modes, selling-plan structure, order tag + ship-date metafield keys, app-proxy paths: unchanged from frozen, or change-controlled with proof.
4. **Nova consistency** — install-confirm + webhook forwarding still work; charges / commissions / per-store comp reflect correctly in the platform (admin + app-admin).
5. **Regression** — re-run earlier phases' gate items and the reliability bar (build pack §8); they still pass.
6. **Anti-hallucination** — every file / route / field / scope the code and build pack reference actually exists; no invented Shopify or Nova APIs.
7. **Report** — PASS or FLAG per check, with evidence (file paths, platform screenshots/log lines). One FLAG = phase not done.

---

## 5. When specs change

Specs will evolve. When the build pack or a spec changes mid-stream:

1. **Classify** the change (C1 / C2 / C3, §2.2).
2. If it touches a **completed phase's frozen contract**, run the **production rule (§2.3)** — block unless additive + backward-compatible + audited. Get approval and record an ADR for C3.
3. **Reopen the minimum** — only the affected phase(s). Re-run that phase's gate (build pack §3.N) + the §4 audit before resuming forward.
4. Note the change and its classification so the audit trail stays intact.

> Default posture: **a change that might affect a finished phase or a live merchant is blocked until proven safe.** Reliability beats velocity — that is Encore's whole wedge.
