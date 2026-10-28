# ConnectSphere

Planning client events at ConnectSphere-owned venues in Singapore: event requests, their review, and the venue bookings that follow. This file is the team's shared vocabulary. When two words exist for one thing, use the one listed here.

## Language

### Venues and slots

**Slot**:
One of the three fixed parts of a day that a venue is booked by: AM, PM or Night (customer clarification #50).
_Avoid_: session, period, time block

**Opening hours**:
The opening and closing time a venue keeps every day, in 15-minute steps, set by Venue Staff on the venue form (SCRUM-239 AC1). They replace the venue's operating slots. Outside them the venue is never offered. A permanent setting, not the same thing as unavailable.
_Avoid_: operating hours, open slot

**Operating slot**:
Before SCRUM-239: a slot a venue ran every day (AM, PM, Night). Replaced by opening hours; still stored, but nothing reads it for availability.

**Unavailable slot**:
A period at one venue on one date that Venue Staff have withdrawn from use, with the reason recorded (customer clarification #54). A start and end time since SCRUM-239 AC6 (before that, a slot); the name stays, as the table's does. The venue calendar labels it _Blocked_ (SCRUM-123 AC7).
_Avoid_: blocked slot (SCRUM-154's title uses it for the same thing), closed slot, blackout

### Bookings

**Booking request**:
A coordinator's request to use one venue, made up of lines, each a date with a start and end time, that Venue Staff approve or reject one by one (SCRUM-142 AC3, SCRUM-148 AC5).
_Avoid_: booking (until a line is approved)

**Booking request status**:
Worked out from its lines: Pending while any line is pending; Approved if every line is approved; Rejected if every line is rejected; otherwise Partially Approved (SCRUM-148 AC5).

**Venue requirements**:
The expected attendance, room layout and accessibility needs a venue must meet. An event has its own. A booking request may have its own for its venue, and uses the event's for any it leaves empty (SCRUM-230).
_Avoid_: event requirements (for a booking request's own), space requirements

**Confirmed booking**:
A venue committed to one event for one date, from a start to an end time, created when Venue Staff approve that line of a booking request.
_Avoid_: reservation (that word is for equipment)

**Affected booking**:
A confirmed booking for an upcoming event whose times overlap a period that has since become unavailable (SCRUM-151, by time since SCRUM-239 AC6). A booking that only touches the period (ends as it starts) is not affected.

**Released booking**:
A confirmed booking that its event's coordinator has given up, with a reason. It no longer commits the venue; the event and its other bookings are unchanged (SCRUM-231).
_Avoid_: cancelled booking (cancelling is for a whole event, SCRUM-105)

**Replacement request**:
A booking request a coordinator makes for an affected booking, to move it to another venue. While it is pending, the affected booking is unchanged; once it is approved, the affected booking is released (SCRUM-229). A Confirmed event may request a venue only this way.

**Replaced booking**:
A released booking given up because its replacement request was approved. Its outstanding action is closed (SCRUM-229).

**Setup time** / **Turnaround time**:
The minutes a venue needs before an event to prepare the room and after it to reset it, in 15-minute steps, set per venue by Venue Staff (SCRUM-225). A booking commits its venue from its start minus the setup time to its end plus the turnaround time. An active _hold_ commits the same widened period, so the event can still be booked when the hold closes (SCRUM-226).
_Avoid_: teardown (folded into turnaround), buffer

**Affected by a setup or turnaround change**:
A confirmed booking that a confirmed setup or turnaround change has left too close to another event's booking. It stays confirmed and is flagged for Venue Staff (SCRUM-225 AC5). Kept apart from an _affected booking_, which carries an outstanding action for the coordinator.

**Hold**:
A period at one venue kept for one event by Venue Staff until an expiry, so the coordinator can finish arranging the booking (SCRUM-227). While it is _active_ it commits the period, with the venue's setup and turnaround around it, against every other event; it is _closed_ when that event's booking for the period is confirmed, and _lapsed_ once its expiry passes first. A hold is never a booking.
_Avoid_: tentative booking, reservation, provisional booking

**Outstanding action**:
An open item on an event that its coordinator must deal with, such as releasing or replacing an affected booking. It closes when that is done. Confirming the event doesn't close it (SCRUM-102 AC5).
_Avoid_: task, alert

### Equipment

**Equipment catalogue**:
The record of the equipment ConnectSphere owns, maintained by Technical Support Staff: each item with its name, category, quantity held, current location and operational status (SCRUM-240, customer clarifications #2, #9, #13, #23). It says what exists, not what is free on a date.
_Avoid_: equipment list, inventory, stock list

**Catalogue item**:
One line of the equipment catalogue. It is what a coordinator's equipment requirement names (SCRUM-240 AC5), and is kept apart from the free-text equipment an Event Organiser types on an event request (SCRUM-80).

**Operational status**:
Whether a catalogue item can be used: _Available_, _Unavailable_, _Damaged_ or _Under maintenance_ (SCRUM-240 AC2, customer clarification #23). A property of the item itself, not of a date — a Damaged item can still be named by a requirement.
_Avoid_: condition, state, availability (that word is for a venue on a date)

**Equipment request**:
What an event's assigned coordinator asks Technical Support Staff to arrange: its equipment lines and its technical requirements, one per event (SCRUM-160). Raising it — adding its first item — moves an Approved event to Planning (AC10). Kept apart from the free-text equipment an Event Organiser types on an event request (SCRUM-80).
_Avoid_: equipment requirement, equipment booking, equipment order

**Equipment line**:
One catalogue item and a quantity of at least one on an equipment request. The same item added twice is two lines, never merged for the coordinator (SCRUM-160 AC3).
_Avoid_: equipment item (that is a catalogue item), row

**Technical requirements**:
The free text on an equipment request saying what Technical Support Staff need to know beyond the items, stored as typed (SCRUM-160 AC5, AC6).
_Avoid_: notes, technical support notes (that is the organiser's SCRUM-80 field)

**Equipment request status**:
How far Technical Support Staff have got with an equipment request: _Under review_ when raised, then _Partially fulfilled_, _Fulfilled_ or _Unable to fulfil_ (SCRUM-166). Under review and Partially fulfilled are **outstanding** and listed in the equipment request queue; Fulfilled and Unable to fulfil are resolved (SCRUM-164 AC3, AC4). Set by hand until SCRUM-166 (dummy D-19).
_Avoid_: open, closed, done, pending (that word is for venue booking requests)

**Unavailable** (equipment line):
An equipment line Technical Support Staff cannot meet, on a partially fulfilled request (SCRUM-166 AC3). The queue counts each unavailable line once, whatever its quantity (SCRUM-164 AC4; PO, 18 Oct 2026). Not the same as a catalogue item's _Unavailable_ operational status, which is about the item itself.

**Reserved** (equipment line):
An equipment line whose equipment has been set aside for the event. Reducing or removing it needs the coordinator to confirm a warning first (SCRUM-160 AC8). Technical Support Staff reserve it with a **reservation** (SCRUM-173): a quantity of the line's item held for the event's commitment window, Reserved until it is Released (SCRUM-177).
_Avoid_: booked, held (those words are for venues)

**Released reservation**:
A reservation Technical Support Staff have given up, with a reason. Its units are available again for its window; the event's other reservations are unchanged (SCRUM-177). Reserving the line again makes it Reserved, and the earlier release is not kept.
_Avoid_: cancelled reservation (cancelling is for a whole event, SCRUM-105)

**Commitment window** (equipment):
The days an event's equipment is committed to it: from the day before its first confirmed venue booking (collection day, F-1) to its last booked day (Return Day, L), both included; the units are free again from L+1 (SCRUM-167 AC1, SCRUM-173 AC3). Whole days, so a morning and an afternoon event on the same date share it. What is **available** to an event is the item's quantity, less units out of service (SCRUM-170), less the most units other events hold on any single day of the window (SCRUM-167 AC9); the event's own reservations are not counted against it (AC4).
_Avoid_: booking period, hold (those words are for venues)

**Out of service** (equipment units):
Units of a catalogue item that Technical Support Staff have recorded as Unavailable, Damaged or Under maintenance: a count per status on the item, which keeps its total quantity (SCRUM-170). They are excluded from what is available in every window, with no end date, until the count is lowered (returned to service). Not the same as the item's own operational status (SCRUM-240): an item whose own status is not Available has no units available at all.
_Avoid_: broken, written off, unavailable units (that word is one of the three statuses)

### Confirmation

**Essential arrangement**:
An arrangement (venue, equipment, technical support or registration) the coordinator has marked as one the event can't be confirmed without (SCRUM-100, SCRUM-102).

**Complete** (of an arrangement):
Venue is complete when the event has at least one confirmed booking, no Pending booking line and no affected booking. Equipment is complete when every line is fully reserved, and is never complete when nothing is requested (SCRUM-102).

### Completion

**End date** (of an event):
The last day of the event's confirmed venue bookings, or its proposed date when it has none. It has passed when it is before today in Singapore (SCRUM-104).
_Avoid_: event date (for a multi-day event, that is its first day)

**System-completed**:
An event the daily completion check moved to Completed, 7 or more days after its end date, because nobody marked it completed. Only a Preparation event is completed this way (SCRUM-104, Change Log CL-60).
_Avoid_: auto-closed, expired

### Safety

**Safety Officer**:
The role that runs the operational safety check (SCRUM-234). An account holding it lands on the Confirmed events awaiting a check.
_Avoid_: safety lead, inspector

**Operational safety check**:
The Safety Officer's review of a Confirmed event against its attendance, each booked venue's capacity and layout, its accessibility needs and its equipment, before it moves into Preparation (SCRUM-234). Its decision is _Approved_ (to Preparation), or _Changes requested_ or _Rejected_, each with a reason the assigned coordinator sees (both back to Planning, customer clarification #130; Change Log CL-27). Each decision is kept; an event confirmed again gets a new check.
_Avoid_: safety review, risk assessment

**Preparation**:
The status after Confirmed, reached only through the Safety Officer's approval (SCRUM-234 AC3, AC5): "passed its safety check and being prepared for the day". It goes on to Completed or Cancelled (Change Log CL-27).
_Avoid_: ready, safety approved (as a status name)

### Access

**Anyone with access** (to an event):
The people whose role and relationship to the event let them see its protected details: its Event Organiser, its Event Coordinator (or any coordinator while it has none), and Event Operations Managers (customer clarification #91). A same-organisation colleague can open the event but is not included.
_Avoid_: "anyone" on its own (Sprint 1 read it as anyone signed in)

### Header and navigation

**Default role**:
The role an account holding several roles starts in at every login: its highest in the fixed order Event Coordinator Lead, Safety Officer, Technical Support Staff, Venue Staff, Event Coordinator, Event Organiser, Attendee (SCRUM-249; PO, 22 Oct 2026). Not the order roles are stored in.
_Avoid_: primary role, first role

**Working role**:
The role chosen in "Working as" (SCRUM-249 AC5), or the default role until one is chosen. It decides the landing page and nav, and lasts until logout. It does not narrow what the API allows: every role the account holds still applies (SCRUM-206 AC2).
_Avoid_: active role, current permissions
