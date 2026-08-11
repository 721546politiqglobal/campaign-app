# Disclosures for All Jurisdictions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `DisclosureEngine.requiredFor` always produce a disclosure for AI-generated content, even when a jurisdiction has no row in `disclosure_rules`, instead of silently skipping it.

**Architecture:** One-line behavior change in the domain layer (`src/domain/disclosure.ts`). No schema change, no UI change: the content wizard (`src/components/ContentWizard.tsx`) already renders an editable textarea per required disclosure and lets staff rewrite the wording per jurisdiction via `confirmDisclosureAction` — that flow just needs `requiredFor` to actually hand it something to render.

**Tech Stack:** TypeScript, Vitest.

## Global Constraints
- Do not change the `RequiredDisclosure` or `DisclosureRule` type shapes — `ContentWizard.tsx` and `combineDisclosureText` consume them as-is.
- Preserve the existing, intentional behavior that a jurisdiction whose rule explicitly sets `requiresAiLabel: false` is skipped (that's a deliberate legal opt-out, recorded in `disclosure_rules`, not a gap).

---

## Background (read before starting)

`disclosure_rules` only has seeded rows for `US-FEDERAL` and `US-CA` (`supabase/migrations/001_init.sql:109-114`). `DisclosureEngine.requiredFor` (`src/domain/disclosure.ts:33-47`) calls `this.rules.get(j)` per jurisdiction and does `if (!rule || !rule.requiresAiLabel) continue;` — so a jurisdiction with **no row at all** is treated identically to one that was explicitly reviewed and marked "no label needed." That's wrong: "no row" means "nobody has configured this jurisdiction yet," not "this jurisdiction is exempt."

Effect on users: a campaign whose jurisdiction isn't `US-FEDERAL`/`US-CA` sees `requiredDisclosures.length === 0`, and `ContentWizard.tsx:436-437` renders "No disclosure required for your jurisdictions." But `ContentLifecycle.schedule` (`src/domain/content-lifecycle.ts:57-59`) still hard-blocks scheduling any AI content with zero disclosure records — so that campaign can never schedule AI-generated content, with no explanation why.

The fix only touches the branch that decides "skip vs. include" — when `rule` is missing, fall back to generic defaults (`DEFAULT_LABEL` text, `'overlay'` placement, `needsLegalReview: false`) instead of skipping. When `rule` exists and explicitly says `requiresAiLabel: false`, still skip — that's a real, reviewed exemption.

---

### Task 1: Fall back to a generic disclosure when no jurisdiction rule exists

**Files:**
- Modify: `src/domain/disclosure.ts:33-47`
- Test: `src/domain/disclosure.test.ts`

**Interfaces:**
- Consumes: `DisclosureRulesRepo.get(jurisdiction: string): Promise<DisclosureRule | null>` (unchanged, `src/domain/disclosure.ts:10-13`)
- Produces: `DisclosureEngine.requiredFor(jurisdictions: string[], isAiGenerated: boolean): Promise<RequiredDisclosure[]>` — same signature, new behavior: never omits a jurisdiction solely because it has no rule row.

- [ ] **Step 1: Write the failing tests**

Replace the existing "skips jurisdictions with no rule…" test (it currently asserts the wrong behavior for the no-rule case) and add a dedicated test for the fallback, in `src/domain/disclosure.test.ts`:

```typescript
  it('still skips a jurisdiction whose rule explicitly says no AI label is required', async () => {
    const engine = new DisclosureEngine(repoWith({
      'US-CA': rule({ jurisdiction: 'US-CA', requiresAiLabel: true, requiredText: 'CA text' }),
      'US-TX': rule({ jurisdiction: 'US-TX', requiresAiLabel: false }),
    }));
    const out = await engine.requiredFor(['US-CA', 'US-TX'], true);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ jurisdiction: 'US-CA', disclosureText: 'CA text', placement: 'overlay', needsLegalReview: false });
  });

  it('falls back to a generic default disclosure for a jurisdiction with no rule row at all, instead of skipping it', async () => {
    const engine = new DisclosureEngine(repoWith({
      'US-CA': rule({ jurisdiction: 'US-CA', requiresAiLabel: true, requiredText: 'CA text' }),
    }));
    const out = await engine.requiredFor(['US-CA', 'US-NOWHERE'], true);
    expect(out).toHaveLength(2);
    expect(out.find(o => o.jurisdiction === 'US-NOWHERE')).toEqual({
      jurisdiction: 'US-NOWHERE',
      disclosureText: DEFAULT_LABEL,
      placement: 'overlay',
      needsLegalReview: false,
    });
  });
```

Delete the old test named `'skips jurisdictions with no rule and jurisdictions that do not require an AI label'` (lines 27-35 of the current file) — it's superseded by the two tests above, which separate the two cases it conflated.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/domain/disclosure.test.ts`
Expected: The new "falls back to a generic default…" test FAILS (current code produces only 1 result, not 2, for `['US-CA', 'US-NOWHERE']`). The "still skips…" test passes already (it's testing existing behavior).

- [ ] **Step 3: Implement the fallback**

In `src/domain/disclosure.ts`, replace the body of `requiredFor` (currently lines 33-47):

```typescript
  async requiredFor(jurisdictions: string[], isAiGenerated: boolean): Promise<RequiredDisclosure[]> {
    if (!isAiGenerated) return [];
    const out: RequiredDisclosure[] = [];
    for (const j of jurisdictions) {
      const rule = await this.rules.get(j);
      // No rule row means "not configured yet," not "exempt" — only an
      // explicit requiresAiLabel: false on a real rule is a genuine opt-out.
      if (rule && !rule.requiresAiLabel) continue;
      out.push({
        jurisdiction: j,
        disclosureText: rule?.requiredText ?? DEFAULT_LABEL,
        placement: rule?.placement ?? 'overlay',
        needsLegalReview: rule?.needsLegalReview ?? false,
      });
    }
    return out;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/domain/disclosure.test.ts`
Expected: All tests PASS, including the two from Step 1 and the pre-existing "falls back to the DEFAULT_LABEL when a required rule has no required text" and "aggregates a distinct required disclosure per matching jurisdiction" tests (unaffected by this change).

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `npx vitest run`
Expected: PASS. In particular check `src/domain/content-lifecycle.test.ts` (the schedule gate) and `src/app/actions.*.test.ts` (they mock `disclosureEngine` directly, so they're unaffected either way, but confirm none broke).

- [ ] **Step 6: Commit**

```bash
git add src/domain/disclosure.ts src/domain/disclosure.test.ts
git commit -m "fix(disclosure): fall back to generic disclosure instead of skipping jurisdictions with no rule"
```

---

## Manual verification (do this after Task 1, before considering the plan done)

1. In the running app, create or edit a campaign (`/admin/campaigns`) with a jurisdiction that has no `disclosure_rules` row, e.g. `US-TX`.
2. As a user on that campaign, create AI-generated content and open it in `/content/[id]`.
3. Confirm the wizard's "Required AI disclosure" step now shows one editable disclosure block (jurisdiction `US-TX`, generic default text), not "No disclosure required for your jurisdictions."
4. Edit the text, click "Confirm disclosure — Continue," and confirm the item reaches `scheduled` status instead of throwing "Can't schedule: AI content needs a disclosure attached first."
