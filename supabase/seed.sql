-- =============================================================================
-- Seed data. Runs automatically on `supabase db reset`.
--
-- Add your area's rows under its own heading so merges stay clean.
-- =============================================================================


-- =============================================================================
-- Venue Catalogue (SCRUM-116, 117, 118, 120, 121)
--
-- Shaped around ConnectSphere_Test_Cases_v3:
--   * "Hall A" is deliberately NOT seeded, so US-11.1-TC01 can create it.
--   * Bugis Seminar Room has maximum capacity 200 and no layouts yet, for the
--     US-11.2 layout cases and US-11.4-TC01.
--   * Jurong East Training Room lists Whiteboard, for US-11.4-TC05.
--   * Marina Bay Ballroom has layouts, facilities, accessibility features and
--     turnaround values, for US-11.3-TC02.
--   * Three active venues and one retired venue, for US-11.3-TC01 and TC03.
--   * Turnaround values are seeded because SCRUM-119 (the entry screen) is not
--     in Sprint 1, and the retired flag is seeded because SCRUM-122 (the
--     retire action) is not in Sprint 1.
-- =============================================================================

-- Reference lists -------------------------------------------------------------

insert into locations (name) values
  ('Bugis'),
  ('Jurong East'),
  ('Marina Bay');

insert into facilities (name) values
  ('Projector'),
  ('Wifi'),
  ('Whiteboard'),
  ('Sound system');

insert into accessibility_features (name) values
  ('Step-free access'),
  ('Hearing loop'),
  ('Accessible toilet');


-- Venues ----------------------------------------------------------------------

insert into venues
  (name, location_id, max_capacity, operating_slots,
   setup_minutes, teardown_minutes, turnaround_minutes, is_retired)
values
  ('Bugis Seminar Room',
   (select id from locations where name = 'Bugis'),
   200, array['am', 'pm'],
   30, 30, 45, false),

  ('Marina Bay Ballroom',
   (select id from locations where name = 'Marina Bay'),
   300, array['am', 'pm', 'night'],
   60, 45, 90, false),

  ('Jurong East Training Room',
   (select id from locations where name = 'Jurong East'),
   40, array['am', 'pm'],
   15, 15, 30, false),

  ('Bugis Old Annex',
   (select id from locations where name = 'Bugis'),
   80, array['am', 'pm'],
   null, null, null, true);


-- Facilities per venue --------------------------------------------------------

insert into venue_facilities (venue_id, facility_id)
select v.id, f.id
from venues v
join facilities f on f.name in ('Projector', 'Wifi')
where v.name = 'Bugis Seminar Room';

insert into venue_facilities (venue_id, facility_id)
select v.id, f.id
from venues v
join facilities f on f.name in ('Projector', 'Wifi', 'Sound system')
where v.name = 'Marina Bay Ballroom';

insert into venue_facilities (venue_id, facility_id)
select v.id, f.id
from venues v
join facilities f on f.name in ('Whiteboard', 'Projector', 'Wifi')
where v.name = 'Jurong East Training Room';

insert into venue_facilities (venue_id, facility_id)
select v.id, f.id
from venues v
join facilities f on f.name in ('Projector')
where v.name = 'Bugis Old Annex';


-- Accessibility features per venue --------------------------------------------

insert into venue_accessibility_features (venue_id, accessibility_feature_id)
select v.id, a.id
from venues v
join accessibility_features a on a.name in ('Step-free access')
where v.name = 'Bugis Seminar Room';

insert into venue_accessibility_features (venue_id, accessibility_feature_id)
select v.id, a.id
from venues v
join accessibility_features a on a.name in ('Step-free access', 'Hearing loop', 'Accessible toilet')
where v.name = 'Marina Bay Ballroom';

insert into venue_accessibility_features (venue_id, accessibility_feature_id)
select v.id, a.id
from venues v
join accessibility_features a on a.name in ('Step-free access')
where v.name = 'Jurong East Training Room';


-- Layouts per venue (each capacity is at or below the venue maximum) ---------

insert into venue_layouts (venue_id, layout, capacity)
select v.id, l.layout, l.capacity
from venues v
join (values
  ('theatre', 300),
  ('banquet', 220),
  ('standing', 300)
) as l (layout, capacity) on true
where v.name = 'Marina Bay Ballroom';

insert into venue_layouts (venue_id, layout, capacity)
select v.id, l.layout, l.capacity
from venues v
join (values
  ('classroom', 30),
  ('boardroom', 20),
  ('u_shape', 24)
) as l (layout, capacity) on true
where v.name = 'Jurong East Training Room';

insert into venue_layouts (venue_id, layout, capacity)
select v.id, l.layout, l.capacity
from venues v
join (values
  ('theatre', 80)
) as l (layout, capacity) on true
where v.name = 'Bugis Old Annex';
