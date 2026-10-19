# ConnectSphere — Customer Clarifications Register (G9)

As of 17 Oct 2026. Source: G9 GitHub Discussions extract of 6 Oct 2026 (saved here as `2026-10-06_discussions-extract.md`): 121 threads, 120 answered plus the #1 announcement. Week 7 changes: `project-scope.md` §6A.

**#130, #131 and #132** were added 17 Oct from the team's consolidated summary of the client's clarifications (posted to the team, 17 Oct), not from an extract. Check the wording against the next extract and correct here if it differs. **#133** (must the app show the signed-in role?) is still unanswered.
Thread `#NN` = https://github.com/SinYang13/IS212-2026/discussions/NN

## How to use

- **Precedence:** latest follow-up in a thread > Week 4 Project Instructions (R1 scope) > Week 1 Customer Briefing. Only G9 clarifications apply.
- **Jira cards are authoritative for ACs.** This file records customer rulings; it does not override a card. If a card conflicts with a ruling, flag it — don't silently change code.
- **Type:** `Rule` = firm requirement, build + test it · `Propose` = customer delegated; our choice must be recorded (backlog / C4 rationale) · `Not R1` = out of Release 1 or handled outside the system.
- Cite rulings as `#NN` in stories, tests, commits and code comments.

## Release 1 scope

**Required beyond the 20 listed core features**
| Topic | Ruling | Ref |
|---|---|---|
| Event Coordinator Lead (was Event Operations Manager) | Separate system role; only it assigns/reassigns Coordinators. **Same role, display name changed** to Event Coordinator Lead; it also views basic event info and every coordinator's assignments and active events (W7-5) | #101, #73, #94, #128, #129 |
| Event confirmation | Not standalone, but Coordinator must be able to confirm once essential arrangements are done → Confirmed status visible to relevant users | #98, #80 |
| Attendee Registration | = registering for an event (view, register, status, withdraw), NOT account creation | #49 |
| Setup/turnaround | Configurable per venue, **in 15-minute steps**; included in availability and conflict checks; bookings that become a problem are identified, not removed (W7-1). Replaces the slot-adjacent rule of #123 | #128, #126, #131, W7-1 |
| Booking unit | **15 minutes** is the smallest unit of booking; no fixed lunch or dinner blackout (12:00–13:00 is valid). Replaces AM/PM/Night slots for **all venue-related timing: the organiser's event request and the coordinator's venue booking request**. The **07:00–24:00 operating window stays**; bookings inside it are in 15-minute increments | #126, #128, #131 |
| Week 7 changes (all six) | Now required in R1: setup/turnaround (W7-1), venue unavailable after booking (W7-2), multiple venues per event (W7-3), hold expiry (W7-4), Event Coordinator Lead (W7-5), Operational Safety Check with a new Safety Officer role (W7-6). The customer expects no further R1 changes | #128, `project-scope.md` §6A |

**Not required in R1**
| Topic | Ruling | Ref |
|---|---|---|
| Account onboarding / self-registration | Not required; pre-loaded staff + client accounts OK | #49 |
| Role-based dashboard | Not core | #118 |
| Event categories | Not core; reasonable set from briefing | #100 |
| Activity / change history | Not core; if built, log material actions (submit, decisions, assignment, significant changes, bookings, reservations, confirm, reschedule, cancel) | #96 |
| Multiple tentative holds per event | Not required | #109 |
| Withdrawal caused by event change/cancel | Detailed handling not required | #115 |
| External integration, data migration | Not required; email is a notification channel, not an integration | #79, #12 |
| Contracts/payments | Outside system | #24 |
| Account recovery, offline, multi-language | Not specified; English only | #64, #31, #28 |
| Equipment checklist, doc versioning, retention | Outside system / not needed | #85, #21, #20 |

## Users, roles, access

Seven roles: Event Organiser, Event Coordinator, Event Coordinator Lead (`operations_manager` in code; called Event Operations Manager before W7-5), Venue Staff, Technical Support Staff, Attendee, and **Safety Officer** (new, W7-6). Access = role AND relationship to the event.

| Topic | Ruling | Type | Ref |
|---|---|---|---|
| Multiple roles | One person may hold several roles | Rule | #56 |
| Organiser visibility | Responsible Organiser views + edits own events; other Organisers in same client org may VIEW, not edit; never unrelated clients | Rule | #81 |
| Delegation | Not supported; change of Organiser is (also used on account deactivation) | Rule | #61, #59 |
| Primary contact per client | None specified | Propose | #65 |
| Staff scoping | Venue/Tech staff not restricted by venue, equipment type or location | Rule | #66 |
| Protected information | Internal planning, venue/equipment arrangements, attendee + client data, non-public details — by role and relationship; field-level design ours | Rule + Propose | #91 |
| Admin role | None defined; propose if needed | Propose | #52 |
| Authentication | Must be secure; method ours | Propose | #62 |
| Attendee info | Available in system, but app need not be the only channel | Rule | #97 |
| Organiser and client organisation | "Refer to project brief": in the brief, Organisers belong to a client organisation | Rule | #124 |
| Who sees approval/rejection outcomes | Only users with a legitimate relationship to the event (responsible Organiser, relevant authorised internal users), not every non-Attendee role | Rule | #125 |
| Lead vs Ops Manager | Same role; only the display name changes. **In code the role stays `operations_manager`** | Rule | #129, #128 |
| Lead and cancellation | The Lead can **reassign** an event to another coordinator but **cannot cancel** it. Check the permission matrix doesn't give `operations_manager` cancel rights (SCRUM-232/233) | Rule | #132 |

## Event lifecycle

**Request, submission, review**
| Topic | Ruling | Type | Ref |
|---|---|---|---|
| Mandatory fields | Not firmed up; we define | Propose | #72 |
| Expected attendance | Separate event-level field (not inside venue requirements), used for suitability/capacity/booking | Rule | #119 |
| Lead time | No minimum | Propose | #78 |
| Edit after submission | Organiser cannot directly edit a submitted request (even non-significant fields); changes go via Coordinator | Rule | #102 |
| Withdrawal | Organiser asks Coordinator (outside system); Coordinator records it; "Withdrawn" distinct from other states | Rule | #103 |
| Resubmit rejected | Our choice | Propose | #67 |
| Reuse previous event | Which fields copied is ours | Propose | #75 |

**Coordinator assignment**
| Topic | Ruling | Type | Ref |
|---|---|---|---|
| Who assigns | Event Coordinator Lead (= Ops Manager renamed), after submission, own SOP. New requests wait unassigned in the Lead's queue; Coordinators manage only events assigned to them (W7-5) | Rule | #73, #93, #128, #129 |
| Lead's overview | Lead sees every coordinator's assignments and active events | Rule | #128 |
| Acceptance | No accept/decline step | Rule | #95 |
| Reassignment | Lead (Ops Manager) only; assumed pre-approved; relevant users notified (W7-5) | Rule | #94, #128 |
| Concurrent events | Allowed, no limit | Rule | #92 |
| Unassigned events | Ops Manager needn't be notified of every submission but must be able to find events awaiting assignment | Rule + Propose | #117 |

**Approval, confirmation, completion**
| Topic | Ruling | Type | Ref |
|---|---|---|---|
| Approved vs Confirmed | Approved = enough info to plan, commits nothing. Confirmed = all essential arrangements done | Rule | #80 |
| Essential arrangements | Vary per event; no fixed list | Rule | #80 |
| Gate | Essential + incomplete → not confirmable; non-essential may stay open | Rule | #80 |
| Incomplete equipment | Coordinator decides with Tech Support if essential | Rule | #106 |
| Safety check rejected | If the Safety Officer rejects the arrangement, the event is **not cancelled**. It returns to the relevant planning stage; the Event Coordinator and affected staff revise it and **resubmit it for the Operational Safety Check**. The status name is ours (SCRUM-234; matches the Sprint 3 interim rule) | Rule + Propose | #130, W7-6 |
| Completion | Coordinator marks complete; may auto-complete 7 days after end date | Rule | #71 |

**Changes, postponement, cancellation**
| Topic | Ruling | Type | Ref |
|---|---|---|---|
| Significant vs ordinary | Significant = could affect arrangements (date/time, attendance, venue/equipment reqs); ordinary needs no revalidation | Rule + Propose | #4 |
| Cut-off | None; post-confirmation changes can trigger re-review | Rule | #8 |
| Multi-field change request | One request, several fields, partial approval; reasons to Organiser | Rule | #104 |
| Losing Confirmed | Organiser must be told; transition flow ours | Rule + Propose | #105, #70 |
| Calendar reschedule | Must not bypass change process | Rule | #3 |
| Postponement | With new date = reschedule; without = allowed, release bookings, keep record | Rule | #69, #121 |
| Cancellation | Any stage; **only the assigned Event Coordinator in charge**. The Event Coordinator Lead cannot cancel (can reassign instead); no cancellation reason is required from the Lead | Rule | #68, #132 |
| Multi-session | Sessions may differ in timing, venue, equipment, attendance limit (not core) | Rule | #74 |
| Comments / documents | Keep comments with event (threading = UI choice); no doc versioning | Propose | #15, #21 |

## Venues and booking

**Booking unit, current** (#126, #128 point 1, #131): 15 minutes, no fixed lunch or dinner blackout, inside the unchanged **07:00–24:00 operating window**. Applies to both the organiser's event request and the coordinator's venue booking request; setup and turnaround are also in 15-minute steps. With 30 min setup and 45 min turnaround, a 10:00–12:00 booking occupies the venue 09:30–12:45 (W7-1 example). Stories: SCRUM-238, 239, 226, 225.

**Superseded: the slot model** (#50, #107, #123). Kept because Done stories and old data use it; SCRUM-238 maps old slots to AM 07:00–12:00, PM 13:00–18:00, Night 19:00–24:00. Full day = all 3. An event spanning two slots consumes both.

| Event slot | Setup occupies | Turnaround occupies |
|---|---|---|
| AM | Night, previous day | PM, same day |
| PM | AM, same day | Night, same day |
| Night | PM, same day | AM, next day |

| Topic | Ruling | Type | Ref |
|---|---|---|---|
| Setup/turnaround size | **Superseded by W7-1, #126 and #131:** minutes per venue, in 15-minute steps. Was: max one full slot each, one slot the smallest unit, always the adjacent slots | Rule | W7-1, #126, #131 (was #108, #123) |
| Ownership | Venue Staff record setup/teardown/turnaround per venue | Rule | #43 |
| Double-booking | Hard block, no override | Rule | #35 |
| Tentative holds | One active hold or confirmed booking per venue per overlapping period. Every hold has an expiry; an expired hold frees the venue and is never a confirmed booking; Coordinator told before or when it expires (W7-4). Duration ours; PO decision: warn 24 h before expiry | Rule + Propose | #41, #39, #109, W7-4 |
| Multiple venues per event | Allowed (W7-3): each booking checked on its own for suitability, availability and conflicts; releasing one doesn't remove the others. Multiple *holds* per event still not required | Rule | #74, #109, W7-3 |
| Capacity by layout | Stored per supported layout; suitability uses chosen layout's capacity | Rule | #112 |
| Search vs suitability | Filtering narrows the list; suitability assesses a selected/shortlisted venue | Rule + Propose | #83 |
| Operating hours | Venue Staff maintain; all days equal, no holiday calendar | Rule | #46 |
| Booking horizon | None | Propose | #57 |
| Organiser venue preference | Preference only; never overrides suitability/approval | Propose | #111 |
| Reject with alternative | Venue Staff suggest; Coordinator updates request before approval | Rule | #45, #110 |
| Venue attribute change | Don't auto-revert bookings to Requested; flag affected bookings + notify Coordinator | Rule + Propose | #120 |
| Venue unavailable after booking | Venue Staff mark it temporarily unavailable (maintenance, equipment failure, renovation, safety, other); affected future bookings identified; event **not** cancelled; Coordinators informed; Coordinator can search for and request a replacement (W7-2) | Rule | #54, W7-2 |
| Venue retired | No auto-cancel/reschedule; flag bookings, notify Coordinators, Coordinator re-arranges | Rule + Propose | #122 |
| Time zone | Singapore | Rule | #36 |

## Equipment and technical support

Lifecycle (#2 follow-up, #5): current location → transfer/prep to venue (reduces pre-event availability) → D-1 collection / commitment → event use → return → inspection → available from Return Day + 1. No same-day sharing between events.

| Topic | Ruling | Type | Ref |
|---|---|---|---|
| Flow | Coordinator records reqs; Tech Support checks suitability/availability, then reserves; no separate approval step | Rule | #19 |
| Partial fulfilment | Reserve what's available, flag the rest; Coordinator judges readiness | Rule | #90 |
| Change after reservation | Allowed; re-check; release/replace flow ours | Rule + Propose | #114 |
| Reschedule | Arrangements reviewed again | Rule + Propose | #16 |
| Quantity model | Pooled or serialised ours; quantity must be known | Propose | #13 |
| Location / transfer / return date | Representation ours; no default return day | Propose | #2, #113 |
| Status ownership | Tech Support only (unavailable, damaged, maintenance) | Rule | #9, #23 |
| Return defects | Tech Support records issues + updates status | Rule | #86 |
| Maintenance workflow | Not a requirement | Not R1 | #23 |
| Reservation period / notice | No min/max, no minimum notice | Propose | #82, #25 |
| Clarifying tech reqs | Tech Support logs questions on event; Coordinator liaises with Organiser | Rule | #87 |
| Staff rostering | No required mechanism (not core) | Propose | #88, #89 |

## Registration and attendees

| Topic | Ruling | Type | Ref |
|---|---|---|---|
| Attendee calendar | Registered events + events open for registration | Rule + Propose | #10 |
| Registration fields | Per event needs | Propose | #22 |
| Multiple registrations | No limit | Propose | #48 |
| Registration period | Separate start/end set by Coordinator; extendable (not core) | Rule | #30, #42 |
| Waiting list | FIFO + manual override; 3-day acceptance window (not core) | Rule | #26, #44, #116 |
| Manual / VIP adds | Via Coordinator; VIPs allowed when registration full but never beyond event/venue capacity | Rule | #33, #99 |
| Reschedule | Registrations may be kept; attendees informed and may withdraw; detail not R1 | Rule | #115 |
| Attendee export | Organiser for own events, subject to access (not core) | Rule | #32 |
| Check-in | QR/manual by an existing internal role (not core) | Rule + Propose | #38 |
| Attendee accounts | Attendees are external users who register for events and view their status; onboarding not in the brief | Rule | #53, #49 |
| Open/Closed registration status | How it's stored is ours, but it must match the registration period, capacity and event status; registration can reopen if the period is extended | Propose | #127, #42 |

## Notifications

| Topic | Ruling | Type | Ref |
|---|---|---|---|
| Channels | In-app + email, configurable per notification type | Rule | #37 |
| Timing | Batch at configurable interval, or real time; no deadline | Rule + Propose | #55 |
| Clarified triggers | No-longer-confirmed → Organiser · venue change/retire affecting booking → Coordinator · venue unavailable → Coordinator · reschedule → registered attendees | Rule | #105, #120, #122, #54, #115 |
| Lead (Ops Manager) | Not notified of every submission; must find unassigned events (now the Lead's unassigned queue). Relevant users notified on assignment and reassignment (W7-5) | Rule + Propose | #117, #128 |
| Hold expiry | Coordinator told before or when a hold expires (W7-4); PO decision 24 h before | Rule + Propose | W7-4 |
| Reminders | Incomplete-arrangement reminders, batched/configurable (not core) | Propose | #47, #40 |

## Non-functional and general

| Topic | Ruling | Type | Ref |
|---|---|---|---|
| System of record | Authoritative for in-scope event data | Rule | #79 |
| Scale / architecture | 3-year growth (~500 staff); microservices or not is ours | Propose | #7 |
| Audit | Must show what/who/when; mechanism ours | Rule + Propose | #14 |
| Uploads | No size/type limits specified | Propose | #18 |
| Reports | On demand; venue usage excludes revenue (not core) | Propose | #34, #29 |
| 14-step process | Typical happy path; exceptions exist | Rule | #11 |
| UI/UX questions | Calendar granularity, sorting, saved searches ours | Propose | #6, #27 |

## Answers that evolved (latest wins)

| Date | Thread | Change |
|---|---|---|
| by 17 Oct | #132 | Only the assigned Coordinator in charge cancels; the Lead can reassign but not cancel; no reason needed from the Lead (refines #68) |
| by 17 Oct | #131 | 15-minute unit covers both the event request and the venue booking request; setup/turnaround in 15-minute steps; 07:00–24:00 window unchanged |
| by 17 Oct | #130 | Safety rejection: event not cancelled; back to the relevant planning stage, revised and resubmitted for the safety check; status name ours. Confirms SCRUM-234's interim rule |
| 2026-10-06 | #126 | **Booking unit is 15 minutes**, no lunch or dinner blackout. Supersedes the slot model of #50, #107, #108 and #123 |
| 2026-10-06 | #129 | Event Operations Manager = Event Coordinator Lead; display name only (confirms #128 point 5) |
| 2026-10-03 | #128 | Week 7 changes 1–6 now in R1; setup/turnaround moves from slots to 15-minute units; the Lead reassigns and sees all assignments; change 6 is a new role "due to regulation". The post calls it Operational *Feasibility* Check; Jira and the team use **Operational Safety Check** |
| 25 Aug → 6 Oct | setup/turnaround chain | #43 per venue (25 Aug) → #108 one slot is the smallest unit (7 Sep) → #123 one adjacent slot each (14 Sep) → SCRUM-119 yes/no flags per venue (PO, 27 Sep) → W7-1 minutes per venue (team, 4 Oct) → #126/#128 15-minute booking unit (6 Oct). Latest wins: minutes per venue in 15-minute steps (SCRUM-225/226) |
| 2026-09-14 | #123 | Setup/turnaround = exactly one adjacent slot each, across days (refines #43, #108). **Superseded 6 Oct** |
| 2026-09-12 | #122 | Retired venue: no auto-cancel/reschedule; flag + notify |
| 2026-09-07 | #49 | No onboarding in R1; pre-loaded accounts OK; Attendee Registration = event registration |
| 2026-09-07 | #38 | Check-in by any authorised existing internal role |
| 2026-09-07 | #101 | Ops Manager confirmed as separate system role |
| 2026-09-07 | #121 | Postpone allowed without a new date (confirms #69) |
| 2026-08-31 | #2 | Transfer time = pre-event availability; Return Day + 1 = post-event (not in conflict with #5) |
| 2026-08-31 | #55 | "Batch" = no real-time requirement; real time also acceptable |

## Known interpretation points (team decisions, record the reasoning)

- #102 vs "Clarification Requested → Organiser can edit": treated as the Coordinator handing the request back (briefing Step 4, US-5.3 AC6). Confirm with PO or record as team interpretation.
- #81 vs draft privacy: a draft is not yet submitted to ConnectSphere, so same-org colleagues cannot see it.
- #130 leaves the status name for a rejected safety check to the team. Record the chosen name on SCRUM-234 and in the Change Log.

## Open questions for the customer

- Must normal registration enforce a capacity limit in R1 (#99 says capacity never exceeded)?
- On cancellation in R1, must venue bookings and equipment reservations be released automatically?
- Does equipment maintenance need a UI in R1, or is seeded data enough? (Venue unavailability is now required, W7-2.)
- Equipment by whole day (D-1 / Return + 1) while venues book in 15 minutes: confirm the granularities may differ.
- W7-5: does "under their supervision" mean all coordinators or a team? (SCRUM-233 assumes all.)
- W7-6, still open after #130: does a later venue or equipment change after safety approval need a new check? Does one check cover all of an event's venues?
- Setup before opening hours: if a venue opens 08:00 with 30 min setup, is the earliest start 08:30? Team assumption yes (recorded on SCRUM-239); Arwen to post it on the forum (Sprint 3 plan, 9 Oct).
- W7-2: are the unavailability reasons a fixed list, or is free text enough?
- **#133 (pending):** must the app show the signed-in user's role? If ours to propose, fold the label into SCRUM-109 (Sprint 3 plan).

**Answered since the last update:** "Does every booking consume setup/turnaround?" → per venue, configurable, can be 0 (W7-1). "Tentative holds in R1?" → yes, with expiry (W7-4). "Venue unavailability UI?" → yes (W7-2).
**Answered 17 Oct:** "What does rejecting the safety arrangement lead to?" → not cancelled; back to planning and resubmitted (#130). "Scope of the 15-minute change?" → all venue-related timing, including setup/turnaround; 07:00–24:00 window unchanged (#131). "Can the Lead cancel events?" → no, only the assigned Coordinator; the Lead reassigns (#132).
- Which roles can view all events (Ops Manager, Venue Staff, Tech Support)?
