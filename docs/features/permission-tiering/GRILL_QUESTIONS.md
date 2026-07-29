# Permission Tiering — GRILL Question Pattern

This document captures the question structure used in the BI[7] grill session
(2026-07-28). It's a reference for whatever user is updating the
feature-pipeline skill with the actual question patterns the skill should
recommend.

The skill's `grill-with-docs` says "Ask the questions one at a time, waiting
for feedback on each question before continuing" and "provide your recommended
answer." This document records the concrete shape those questions took in
BI[7] and what made them work.

---

## The pattern (8 questions, ~one per design axis)

Each question has the same shape:

1. **Plain-English situation framing** — anchor the question in a real
   scenario the user can see themselves in (a junior agent, a token, a
   plugin author, an admin).
2. **3-4 options, each with a recommended answer** — never give only one
   choice. The user can disagree with the recommendation, but they need to
   see the alternatives to disagree usefully.
3. **Concrete code snippets where it helps** — show the manifest, the
   response shape, the error message. The user can read code faster than
   they can read prose.
4. **A "my take" / "recommendation" with the rationale** — name what you'd
   ship and why. The user can agree, push back, or pivot.
5. **End with "What do you say?"** — explicit close. The user replies with
   "approved" / "A" / "B" / "push back" / free-text.

The user feedback loop in BI[7] was: present a question → user replies with
"approved" or "D" or pushes back → present next question. Eight questions
to lock the design.

---

## The 8 questions (BI[7] reference)

### Q1 — Scope. What does "platform-wide" mean?

The user's BI[7] backlog entry said "Implement the read/act/destructive scope
convention platform-wide (not just documented)." That's vague. Q1 asked them
to pick three concrete surfaces from a list of four.

Recommendation: ship 4 surfaces (tier field, tier-aware list, wildcard tests,
tenant-scoped listing). User pushed back through Q4 which trimmed it to 3
surfaces (tenant scoping deferred to BI[14]).

### Q2 — Where does the tier live on a capability? (Field location)

3 options (A: explicit field, B: derived from permissions, C: hybrid).
Recommended C: explicit field with derived fallback. The validator enforces
the rules.

### Q3 — What does "tier-aware capability.list" mean? (Filter semantics)

3 options (A: coverage-filtered, B: annotated, C: two-mode flag). Recommended
A: coverage-filtered. The catalog is the caller's security boundary.

### Q4 — Tenant-scoped listing. Does this fit in BI[7]?

3 options (A: build it, B: defer to BI[14], C: soft placeholder). User
chose B with the requirement to track the deferral in drift log.

### Q5 — Migration story. Does BI[7] need to migrate anything?

Reframed after the user pointed out we're in dev. No migration needed. The 25
existing platform caps get explicit tiers as a refactor in the same BI[7]
commit (1-line change in `caps.ts`).

### Q6 — Where does a runtime plugin declare the tier?

4 options (A: manifest rich metadata, B: programmatic hook, C: convention, D:
hybrid). Recommended D: hybrid convention with explicit override. Verb list
in `tier-convention.ts` covers common cases; plugin author overrides for
ambiguous verbs.

### Q7 — Where does the tier-aware filter live? (Architecture)

4 options (A: registry, B: gateway, C: CLI, D: new capability). Recommended
B: gateway. The gateway is the authz authority. The filter is a one-line
walk per cap.

### Q8 — Response shape + test matrix

2 parts. Response shape: A (tier added to the card, no second call needed).
Test matrix: 11 cases including multi-scope, empty, malformed.

---

## Why this pattern works

1. **Real scenarios beat abstract options.** Q1 framed the scope question
   with "imagine a tenant with a junior agent, a checkout agent, and a
   refund agent" — the user immediately understood the stakes. Without
   that framing, the same question ("what's in scope?") would be a
   guessing game.

2. **The user pushed back on the question tool.** They said "do not use
   the asking question tool, just ask the question in chat, this allows
   me to throw back a question at you, until we are in sync." Once we
   dropped the question tool, the conversation became a real back-and-forth
   where they'd push back on one of my recommendations and I'd reframe.
   Per the skill spec, the question tool is built-in; in practice chat
   questions work better when the user wants to engage deeply.

3. **Concrete code snippets anchor the answers.** Q6's "visualize D for me"
   request was answered by showing the manifest, the verb list, the install
   algorithm, and a worked example. The user could see exactly what the
   plugin author would write. The answer "ship the hybrid" landed cleanly
   because the worked example proved it was tractable.

4. **The user steered scope reductions.** Q1's recommendation was 4
   surfaces. The user pushed back through Q4 to 3. That's the grill
   working as intended — the user owns the scope, the agent surfaces the
   options.

5. **The "revised" pattern for migration.** When the user said "we don't
   really need migration do we? this is still in dev", the question got
   reframed without the migration framing. The grill accepts reframing
   mid-flow. The skill should make this explicit.

6. **The "now re-ask the question on this note" pattern.** After the user
   asked for plain-English framing, I re-asked Q6 with the same options but
   in the language the user now understood. The skill should have a
   "if the user asks for clearer framing, re-ask the same questions with
   the new framing" pattern.

7. **Phase 0.5 verdict is its own question.** The "Does that sit right with
   you? Or push back on any U?" is the gate to Phase 1. The user can
   reverse a Q1-Q8 decision if Phase 0.5 reveals it. The skill should
   make this re-loop explicit.

---

## Anti-patterns noticed

- **Don't include write-up docs in the grill.** The user said "we don't
  really need migration do you? this is still in dev" — referring to my
  Q5 framing. The question was over-engineered for the state of the
  project. The skill should hint: "if the project is in dev, drop the
  migration framing."

- **Don't recommend Option A when A is the obvious choice.** Q7 had a
  weak recommendation (gateway) that the user agreed with. The user
  didn't push back because the recommendation was right, but the question
  could have been sharper. The pattern: present the strongest case for
  the alternative too, so the user can see the trade-off.

- **Don't bundle too many questions into one.** Q8 had two parts (response
  shape + test matrix). The user engaged with the first part but I had to
  re-ask the second part. The skill should make this clear: one design
  axis per question, even if they're related.

---

## Files to capture

- `docs/features/permission-tiering/GRILL-permission-tiering.txt` — the
  canonical grill notes (the 8 questions + answers + rationale + deferred items).
- This file (`GRILL_QUESTIONS.md`) — the meta-pattern document for the
  skill update.

---

## Suggested skill updates

The `feature-pipeline/SKILL.md` (Phase 0: Grill First) currently says:

> Ask the questions one at a time, waiting for feedback on each question before continuing.

That's right but underspecified. Suggested additions:

1. **Pattern: present 3-4 options with a recommended answer.** Each option
   with rationale. End with "What do you say?" or equivalent.
2. **Pattern: plain-English situation framing.** Anchor each question in a
   real scenario the user can see themselves in.
3. **Anti-pattern: don't use the question tool for the grill.** Use chat
   questions so the user can push back freely.
4. **Pattern: when the user asks for reframing, re-ask the same question
   with the new framing.** Don't drop the question.
5. **Anti-pattern: don't bundle unrelated questions.** One design axis per
   question.
6. **Pattern: in dev, drop the migration framing.** Reframe as a refactor.
7. **Phase 0.5 gate: present the verdict as "are we done?" — give the user
   a chance to reverse any Q1-Q8 decision.**
