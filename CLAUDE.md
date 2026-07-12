# Encore — session anchor

Before any development work in this repo:

1. Invoke the `encore-dev-discipline` skill (`.claude/skills/encore-dev-discipline/`) and follow it exactly.
2. Plan of record: `OPUS-HANDOVER-ENCORE.md` (phases E0–E4), gates in `../../docs/06-plan/MASTER-PLAN-2026-07-11.md` §Workstream E.
3. Prime directives: no feature loss ever (simplify via progressive disclosure, not deletion); merchant-simple (≤3 screens to first preorder, no jargon, full i18n).
4. Always run `npm run typecheck` AND `npm run build` before calling anything done (the `.server` import trap only appears at prod build).
