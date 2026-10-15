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

**Confirmed booking**:
A venue committed to one event for one date, from a start to an end time, created when Venue Staff approve that line of a booking request.
_Avoid_: reservation (that word is for equipment)

**Affected booking**:
A confirmed booking for an upcoming event whose times overlap a period that has since become unavailable (SCRUM-151, by time since SCRUM-239 AC6). A booking that only touches the period (ends as it starts) is not affected.

**Released booking**:
A confirmed booking that its event's coordinator has given up, with a reason. It no longer commits the venue; the event and its other bookings are unchanged (SCRUM-231).
_Avoid_: cancelled booking (cancelling is for a whole event, SCRUM-105)

**Setup time** / **Turnaround time**:
The minutes a venue needs before an event to prepare the room and after it to reset it, in 15-minute steps, set per venue by Venue Staff (SCRUM-225). A booking commits its venue from its start minus the setup time to its end plus the turnaround time.
_Avoid_: teardown (folded into turnaround), buffer

**Affected by a setup or turnaround change**:
A confirmed booking that a confirmed setup or turnaround change has left too close to another event's booking. It stays confirmed and is flagged for Venue Staff (SCRUM-225 AC5). Kept apart from an _affected booking_, which carries an outstanding action for the coordinator.

**Hold**:
A period at one venue kept for one event by Venue Staff until an expiry, so the coordinator can finish arranging the booking (SCRUM-227). While it is _active_ it commits the period against every other event; it is _closed_ when that event's booking for the period is confirmed, and _lapsed_ once its expiry passes first. A hold is never a booking.
_Avoid_: tentative booking, reservation, provisional booking

**Outstanding action**:
An open item on an event that its coordinator must deal with, such as releasing or replacing an affected booking. It closes when that is done.
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

### Access

**Anyone with access** (to an event):
The people whose role and relationship to the event let them see its protected details: its Event Organiser, its Event Coordinator (or any coordinator while it has none), and Event Operations Managers (customer clarification #91). A same-organisation colleague can open the event but is not included.
_Avoid_: "anyone" on its own (Sprint 1 read it as anyone signed in)
