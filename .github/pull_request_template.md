<!-- Title: SCRUM-<key>: <what the story does> -->

## Jira

SCRUM-<key> — <story title, as on the Jira card>

## Acceptance criteria and evidence

<!-- Copy each AC from the Jira card, not the test sheet. -->

| AC (from Jira) | Test case IDs | How it was tested |
|---|---|---|
| AC1 — | TC-<key>-01 | Manual: … · Automated: … |

## Not built or blocked

<!-- Any AC or test case you couldn't verify, and what it's waiting on. Delete this section if none. -->

## Shared files touched

<!-- Files that belong to other stories (e.g. a shared schema or lib file). Tag their owner. Delete this section if none. -->

## Checklist

- [ ] Every commit starts with `SCRUM-<key>:`
- [ ] `main` merged in, conflicts resolved
- [ ] Manually tested against every AC above
- [ ] Added or replaced a dummy? `DUMMY(...)` markers and `docs/dummies.md` updated
- [ ] Changed the database schema? `database.types.ts` regenerated
