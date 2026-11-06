# Definition of Done

Agreed by the whole Scrum Team on Slack on 21/10/2026, after Sprint 4
Planning and before any Sprint 4 work. It did not change during Sprint 4.

A story that does not meet every required row is not Done: it is not counted
toward velocity, is not shown at Sprint Review, and returns to the Product
Backlog. There is no partial credit, and merged is not Done.

| Criterion | Required? | Since |
|---|---|---|
| All acceptance criteria are met | Yes | Sprint 1 |
| Manually tested against those acceptance criteria | Yes | Sprint 1 |
| Before merging, automated unit/API tests covering every AC of this story have been written and pass in CI | Yes | Sprint 4 |
| Before merging, the full automated regression suite (all previous stories' ACs) has been run on the branch and passes, with this story's new tests added to it | Yes | Sprint 4 |
| Code has been reviewed by someone other than the author | Yes | Sprint 1 |
| After merging, a reviewer other than the author has manually run an end-to-end test on `main` covering every AC of this story, with screenshot evidence recorded | Yes | Sprint 4 |
| Required Jira/Slack updates, decisions and evidence recorded in the agreed locations | Yes | Sprint 3 |
| Playwright spec written according to the user story and raised as a small PR | No (not compulsory) | n/a |

The DoD grew each Sprint, as the "Since" column shows. Rows removed along the
way: "It runs from the README instructions" (Sprint 3); "Merged into main and
existing functionality still works" and "Merged and integrated into the Git"
(Sprint 4, now covered by the regression and post-merge rows and by the
review by someone other than the author).

## How it was applied

- **Before the PR (author):** run every automated and manual test case for the
  story, and post the evidence on the Jira ticket as screenshots, each labelled
  with its AC and test case ID.
- **After the merge (the reviewer who merged it):** re-test every AC end to end
  on `main`, and post the DoD checklist and labelled screenshots on the PR. A
  bug found at this step is logged as a Jira Bug ticket for the story's author.
  Only then does the story move to Done.
- **Board statuses:** To Do → In Progress → In Review → Merged - Pending
  Verification → Done.
- **Manual testing does not need a screen.** A backend-only story can be tested
  through its API (professor consultation, 15/09/2026).

Playwright was part of the 21/10 proposal as something to trial, never a
requirement. Its CI job was switched off on 22/10, and the team decided not to
use it for Release 1 on 23/10 (PR #126).
