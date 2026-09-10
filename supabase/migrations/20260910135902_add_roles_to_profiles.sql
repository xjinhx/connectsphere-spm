-- Minimal profiles table (prerequisite for SCRUM-206).
-- NOTE: this is intentionally minimal — full Auth/Identity schema
-- (e.g. additional profile fields, fuller RLS policies) is expected
-- to be built out separately as part of the Authentication epic.

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "Users can view own profile"
  on profiles for select
  using (auth.uid() = id);

-- Auto-create a profile row whenever a new auth user signs up
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- SCRUM-206: Hold the roles assigned to my account

alter table profiles
  add column roles text[] not null default '{}';

alter table profiles
  add constraint valid_roles check (
    roles <@ array[
      'event_organiser',
      'coordinator',
      'operations_manager',
      'venue_staff',
      'technical_support',
      'attendee'
    ]::text[]
  );