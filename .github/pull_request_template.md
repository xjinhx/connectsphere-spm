<!--
HOW TO USE
- Replace everything in <ANGLE BRACKETS>. Delete the HTML guidance comments before posting.
- Title: SCRUM-<KEY>: <STORY TITLE AS ON THE JIRA CARD>
- Base branch: main. Never merge it yourself; one approving review from someone else.
- Take every AC from the Jira card (Jira is authoritative), not from the test sheet.
- Delete any optional section that doesn't apply, except "Not built or blocked":
  write "Nothing is blocked." there instead.
-->

## Jira

SCRUM-<KEY> — <STORY TITLE AS ON THE JIRA CARD>

## Acceptance criteria and evidence

<!-- One row per Jira AC, pasted word for word. List every test case that covers it.
     "How it was tested": say what each case checks in a few words, and whether it was
     Manual, Automated (unit / integration), or both. Only manual testing closes a story. -->

| AC (from Jira) | Test case IDs | How it was tested |
|---|---|---|
| AC1 — <GIVEN … WHEN … THEN …, COPIED FROM JIRA> | <TC-KEY-01 to TC-KEY-0N> | Manual: <WHAT CASE 01 CHECKS> (01), <WHAT CASE 02 CHECKS> (02) · Automated: <unit / integration TC IDs> |
| AC2 — <…> | <TC-KEY-0N> | Manual and automated |
| AC<N> — <…> | <TC IDs> | <…> |

All <NUMBER> test cases pass. Screenshots, each labelled with its test case and AC, are on SCRUM-<KEY> in Jira<, after <N> setup screenshot(s) of <THE DATA THEY RELY ON>>.

<!-- Optional: an end-to-end run through other stories' real flows, e.g.
     "Also run end to end: <STEP> → <STEP> → <STEP>. <X>/<X> checks pass." -->

## What this adds

<!-- What a reviewer needs to find their way in: pages, API routes, the service function
     they go through, the permission used and which roles it allows, new tables. -->

- <PAGE PATH> and `<METHOD> <API ROUTE>`, both through `<serviceFunction()>` in `<src/domain/…>`.
- Permission is `<permission_name>`: <ROLES ALLOWED>. <ROLES REFUSED> are refused.
- <NEW TABLE / MIGRATION AND WHY, IF ANY>
- <ANY STRUCTURAL CHOICE A REVIEWER WOULD QUESTION, e.g. a new file to avoid a circular import>

Decisions the card doesn't state, flagged for review:
<!-- Every rule you had to choose because the card is silent. Cite the story or
     clarification that supports it. Delete if none. -->
- <DECISION> (<SOURCE, e.g. SCRUM-121 AC3 / clarification #NN>).
- <DECISION>.

<!-- Optional: AC wording changes agreed with the PO, e.g.
     "AC<N> was reworded on <DATE> to <…>; logged in the Change Log." -->

## Not built or blocked

<!-- Anything you couldn't build or verify, and what it's waiting on.
     Dummies added, extended or replaced (with their D-NN register IDs).
     Known limitations. Write "Nothing is blocked." if that's true. -->

- <Nothing is blocked. / AC<N> waits on SCRUM-<KEY> (<OWNER>)>
- Dummy <D-NN> <added / extended / replaced>: <WHAT IT STANDS IN FOR>, waiting on SCRUM-<KEY>. @<OWNER>, <WHAT YOU NEED FROM THEM>.
- <OTHER OPEN PR THAT OVERLAPS, e.g. "SCRUM-<KEY> (#<PR>) merges after this; we overlap only in `<file>` (keep both).">
- Known limitations: <…>

Noticed while testing, outside this story: <ISSUE> belongs with SCRUM-<KEY>. Not changed here.
<!-- Delete the line above if nothing was noticed. Don't fix other people's stories in your PR. -->

## Shared files touched

<!-- Files that belong to other stories or the whole team. Say what changed and tag the
     owner. Delete this section if none. -->

- `<path/to/file>` (SCRUM-<KEY>, @<OWNER>): <additions only / one link added / …>.
- `src/lib/supabase/database.types.ts`: regenerated; the only change is <…>.
- `docs/dummies.md`: <D-NN added / note on D-NN>.
- `supabase/migrations/<TIMESTAMP>_<name>.sql`: new.

## Checklist

<!-- Tick only what is true. If a box can't be ticked, leave it and say why after it. -->

- [ ] Every commit starts with `SCRUM-<KEY>:`
- [ ] `main` merged in, conflicts resolved <!-- or: "N commits behind (#PR, #PR); merges cleanly" -->
- [ ] Added or replaced a dummy? `DUMMY(...)` markers and `docs/dummies.md` updated <!-- (none / added D-NN / replaced D-NN) -->
- [ ] Changed the database schema? `database.types.ts` regenerated <!-- (no / yes: <migration file>) -->

Verified locally: typecheck and lint clean, <N> passed<, <N> skipped (<WHY>)>, build clean.

## Definition of Done

<!-- Mirrors the Definition of Done table in CLAUDE.md (and the tracker's DoD tab);
     keep them in step. The story is Done only when every box is ticked; no partial
     credit. Part A is ticked by the author before asking for review. Part B can only
     be ticked after the merge: come back and edit this description (checkboxes stay
     editable on merged PRs), then move the Jira story to Done. -->

**A. Before review (author)**

- [ ] All acceptance criteria are met
- [ ] Manually tested against those acceptance criteria (evidence on SCRUM-<KEY>, each screenshot labelled with its AC and test case)
- [ ] Runs from the README instructions

Automated tests (encouraged, not required by the DoD): <unit / integration test files, or "none">

**B. After merge (author, then move Jira to Done)**

- [ ] Code reviewed by someone other than the author (approved by @<REVIEWER>)
- [ ] Merged into `main` and integrated in Git, and existing functionality still works (merged <DD/MM/YY>)
- [ ] Required Jira/Slack updates, decisions and evidence recorded in the agreed locations (<Jira comment, Change Log row, test sheet, …>)
