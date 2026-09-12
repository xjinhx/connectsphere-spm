-- =============================================================================
-- Venue Catalogue (EP-08)
-- SCRUM-116 Add a venue to the catalogue
-- SCRUM-117 Record facilities and accessibility features
-- SCRUM-118 Record supported room layouts and their capacities
-- SCRUM-120 Update venue information
-- SCRUM-121 Browse and view the venue catalogue
--
-- Also holds the columns that SCRUM-119 (turnaround) and SCRUM-122 (retire)
-- will use. Those stories are not in Sprint 1, but SCRUM-121 has to display
-- turnaround values and filter out retired venues, so the columns exist now
-- and are filled by seed data only.
--
-- Rules that span two tables (a layout capacity cannot exceed the venue's
-- maximum capacity) live in src/domain/venues/policy.ts, not here.
--
-- RLS is enabled with no policies on every table: a deny-all backstop.
-- Server code reads and writes through the service-role admin client.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Reference lists maintained by Venue Staff
-- -----------------------------------------------------------------------------

-- The maintained location list a venue's location is chosen from (SCRUM-116 AC1)
create table if not exists locations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create unique index if not exists locations_name_unique
  on locations (lower(name));

-- The facility reference list (SCRUM-117 AC1)
create table if not exists facilities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create unique index if not exists facilities_name_unique
  on facilities (lower(name));

-- Accessibility features such as step-free access or a hearing loop (SCRUM-117 AC2)
create table if not exists accessibility_features (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create unique index if not exists accessibility_features_name_unique
  on accessibility_features (lower(name));


-- -----------------------------------------------------------------------------
-- Venues
-- -----------------------------------------------------------------------------

create table if not exists venues (
  id uuid primary key default gen_random_uuid(),

  name text not null
    check (length(trim(name)) between 1 and 100),

  location_id uuid not null
    references locations (id) on delete restrict,

  -- SCRUM-116 AC3: a positive whole number
  max_capacity integer not null
    check (max_capacity > 0),

  -- SCRUM-116 AC4: the slots the venue is open for, applied to every day.
  -- Same text[] + check pattern as profiles.roles.
  operating_slots text[] not null default array['am', 'pm', 'night']::text[]
    check (
      operating_slots <@ array['am', 'pm', 'night']::text[]
      and cardinality(operating_slots) >= 1
    ),

  -- SCRUM-119 (not in Sprint 1): whole minutes, 0 to 240. Shown by SCRUM-121.
  setup_minutes integer
    check (setup_minutes between 0 and 240),
  teardown_minutes integer
    check (teardown_minutes between 0 and 240),
  turnaround_minutes integer
    check (turnaround_minutes between 0 and 240),

  -- SCRUM-122 (not in Sprint 1): retired venues stay on record but are hidden
  -- from the default catalogue view (SCRUM-121 AC3).
  is_retired boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- SCRUM-116 AC2: a venue name can only be used once, ignoring upper/lower case
create unique index if not exists venues_name_unique
  on venues (lower(name));

create index if not exists venues_location_id_idx
  on venues (location_id);


-- -----------------------------------------------------------------------------
-- What each venue offers
-- -----------------------------------------------------------------------------

-- SCRUM-117 AC1 and AC3
create table if not exists venue_facilities (
  venue_id uuid not null references venues (id) on delete cascade,
  facility_id uuid not null references facilities (id) on delete restrict,
  primary key (venue_id, facility_id)
);

-- SCRUM-117 AC2
create table if not exists venue_accessibility_features (
  venue_id uuid not null references venues (id) on delete cascade,
  accessibility_feature_id uuid not null references accessibility_features (id) on delete restrict,
  primary key (venue_id, accessibility_feature_id)
);

-- SCRUM-118: one row per supported layout, each with its own capacity.
-- Layout values match the options on the event request form (US-02.4 AC1).
create table if not exists venue_layouts (
  venue_id uuid not null references venues (id) on delete cascade,
  layout text not null
    check (layout in (
      'theatre',
      'classroom',
      'boardroom',
      'banquet',
      'u_shape',
      'cabaret',
      'standing'
    )),
  capacity integer not null
    check (capacity > 0),
  primary key (venue_id, layout)
);


-- -----------------------------------------------------------------------------
-- Row Level Security: deny-all backstop
-- -----------------------------------------------------------------------------

alter table locations enable row level security;
alter table facilities enable row level security;
alter table accessibility_features enable row level security;
alter table venues enable row level security;
alter table venue_facilities enable row level security;
alter table venue_accessibility_features enable row level security;
alter table venue_layouts enable row level security;
