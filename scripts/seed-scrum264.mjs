// Seeds one test user for manually testing SCRUM-264 (logout does not clear
// csp_last_activity) in a browser.
//
// Run: npm run db:start && npm run db:reset (if you want a clean db), then:
//   node scripts/seed-scrum264.mjs
import { config } from 'dotenv';
import { resolve } from 'path';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = 'scrum264-test@example.com';
const PASSWORD = 'TestPass123!';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.');
}
const isLocalSupabaseUrl = ['127.0.0.1', 'localhost'].includes(new URL(SUPABASE_URL).hostname);
if (!isLocalSupabaseUrl) {
  throw new Error(`NEXT_PUBLIC_SUPABASE_URL (${SUPABASE_URL}) is not local. Refusing to seed anything but 127.0.0.1/localhost.`);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const { error } = await admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
if (error && !error.message.toLowerCase().includes('already been registered')) {
  throw new Error(`Failed to create ${EMAIL}: ${error.message}`);
}

console.log(`Ready. Log in at /login with:\n  email:    ${EMAIL}\n  password: ${PASSWORD}`);
