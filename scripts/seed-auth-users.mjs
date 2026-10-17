// Creates one Supabase Auth user per role, with the role stored in the
// `profiles.roles` column (SCRUM-206) - the actual source of truth the login
// flow reads from. Run against your local stack: `npm run db:start` first.
//
//   node scripts/seed-auth-users.mjs
//
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    'Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local before running this script.',
  );
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

export const TEST_PASSWORD = 'TestPass123!';

// Role values must match RoleSchema in src/domain/identity/roles.ts exactly.
const TEST_USERS = [
  { email: 'organiser@example.com', role: 'event_organiser' },
  { email: 'coordinator@example.com', role: 'coordinator' },
  { email: 'ops-manager@example.com', role: 'operations_manager' },
  { email: 'venue-staff@example.com', role: 'venue_staff' },
  { email: 'tech-support@example.com', role: 'technical_support' },
  { email: 'attendee@example.com', role: 'attendee' },
  { email: 'safety-officer@example.com', role: 'safety_officer' },
];

async function findUserIdByEmail(email) {
  const { data, error } = await supabase.auth.admin.listUsers();
  if (error) throw error;
  return data.users.find((user) => user.email === email)?.id;
}

for (const { email, role } of TEST_USERS) {
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });

  let userId = created?.user?.id;

  if (createError) {
    if (!createError.message.toLowerCase().includes('already been registered')) {
      console.error(`Failed to create ${email}:`, createError.message);
      continue;
    }
    userId = await findUserIdByEmail(email);
  }

  // The `handle_new_user` trigger already inserted a profiles row with an
  // empty roles array on signup - this is what the login flow actually reads.
  const { error: rolesError } = await supabase.from('profiles').update({ roles: [role] }).eq('id', userId);

  if (rolesError) {
    console.error(`Failed to set role for ${email}:`, rolesError.message);
  } else {
    console.log(`Ready: ${email} / ${TEST_PASSWORD} (${role})`);
  }
}
