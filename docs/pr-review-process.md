# PR review process

How a PR gets reviewed before merge, and how it's checked again after. This is
one reviewer's working method (Jinhong); it satisfies the Definition of
Done's "code reviewed by someone other than the author" and "merged into main
and existing functionality still works" rows. Worked examples: SCRUM-232 (He
Jinhong's own card, self-reviewed before PR), SCRUM-230 (Marcus Liow's PR
#106, reviewed as a second reviewer).

## Before merge

1. **Connect Google Sheets and Jira.** Pull the story's test-case tab from
   `ConnectSphere_Test_Cases_v3.xlsx` (or the developer's own sprint sheet) and
   the Jira card itself.
2. **Cross-check test cases against the Change Log.** Read the card's cited
   Change Log entries (CL-##) against the team tracker's actual Change Log
   doc — not just the Jira description's summary of them. Confirm: the AC
   text on the card matches what the Change Log says was agreed; the story's
   point estimate wasn't quietly changed; any Done story the change touches is
   named and handled correctly (stays Done vs. reopened).
3. **Sanity-check against the actual code**, not just the sheet's claims.
   Grep the codebase for the literal strings the test evidence cites (error
   messages, UI copy, function names) and read the relevant PR diff. This
   catches two different failure modes:
   - the evidence describes behaviour the code doesn't actually have (wrong
     branch, stale screenshot, or a claim that outruns what shipped), and
   - the reviewer (AI or human) suggesting work the story doesn't actually
     need — e.g. flagging a "missing" check that's out of scope, or proposing
     a fix for something already covered elsewhere. Push back on scope
     creep the same as on a missed bug: confirm what's actually required
     against the Jira card before accepting a suggestion.
4. **If everything aligns, approve and merge.** The localhost isn't opened at
   this stage — the screenshots/evidence already in the PR and Jira comment
   stand in for a live check. Opening localhost now would just be redoing the
   author's own manual testing, not independent review.

## After merge

5. **Manual regression, one test per AC, against `main`.** Not a copy of the
   author's test cases — one encapsulating scenario per acceptance criterion,
   run fresh against the merged branch, with its own commit hash recorded.
   Goals:
   - catch anything the merge itself broke (conflicts with other stories
     merged around the same time, migration ordering issues);
   - catch bugs the author's own test cases didn't reach;
   - note anywhere the feature could be improved, even if not a defect.

   Logged in the same compact format as the author's own evidence — one line
   per scenario, action and expected result, with a screenshot — so the log
   reads the same whether it's pre-merge author evidence or post-merge
   reviewer regression. See SCRUM-226's and SCRUM-230's regression logs for
   the format.

## Why this order

Checking the paper trail (Jira, Change Log, sheet) before the code catches
process problems — wrong AC, unconfirmed estimate change, scope creep — that
no amount of clicking through the app would surface. Checking the code before
merging catches whether the paper trail is even true. Testing again after
merge is the only step that can catch what the merge itself introduced, which
is why it's a separate pass rather than folded into the pre-merge review.
