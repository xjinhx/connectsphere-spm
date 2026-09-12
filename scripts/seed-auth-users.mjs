// Creates one Supabase Auth user per role, with the role stored in
// user_metadata - a stand-in until the `profiles` table (a separate user
// story) exists. Run against your local stack: `npm run db:start` first.
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

const TEST_USERS = [
  { email: 'organiser@example.com', role: 'event_organiser' },
  { email: 'coordinator@example.com', role: 'event_coordinator' },
  { email: 'ops-manager@example.com', role: 'event_ops_manager' },
  { email: 'venue-staff@example.com', role: 'venue_staff' },
  { email: 'tech-support@example.com', role: 'tech_support' },
  { email: 'attendee@example.com', role: 'attendee' },
];

for (const { email, role } of TEST_USERS) {
  const { error } = await supabase.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { role },
  });

  if (error && !error.message.toLowerCase().includes('already been registered')) {
    console.error(`Failed to create ${email}:`, error.message);
  } else {
    console.log(`Ready: ${email} / ${TEST_PASSWORD} (${role})`);
  }
}
