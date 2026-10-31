// Stress-checks AC2 for real: resets the race event to 19/20, fires both
// attendees' requests concurrently via the real HTTP API, and repeats.
// Exists only to answer "are you sure it works" with evidence, not vibes.
import { config } from 'dotenv';
import { resolve } from 'path';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { execSync } from 'child_process';

config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = 'http://localhost:3000';
const ROUNDS = Number(process.argv[2] ?? 10);

async function cookieHeaderFor(email, password) {
  const jar = new Map();
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => Array.from(jar.entries()).map(([name, value]) => ({ name, value })),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) jar.set(name, value);
      },
    },
  });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  return Array.from(jar.entries()).map(([name, value]) => `${name}=${value}`).join('; ');
}

const admin = createClient(supabaseUrl, serviceRoleKey);

async function eventIdByName(name) {
  const { data, error } = await admin.from('event_request').select('id,name').eq('name', name).limit(1).single();
  if (error) throw new Error(`lookup ${name}: ${error.message}`);
  return data.id;
}

async function registeredCount(eventId) {
  const { count, error } = await admin
    .from('event_registration')
    .select('id', { count: 'exact', head: true })
    .eq('event_request_id', eventId)
    .eq('status', 'registered');
  if (error) throw error;
  return count;
}

async function post(cookie, eventId, body) {
  const res = await fetch(`${APP_URL}/api/events/${eventId}/registrations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, json };
}

const a = await cookieHeaderFor('attendee@example.com', 'TestPass123!');
const b = await cookieHeaderFor('attendee2@example.com', 'TestPass123!');

let allGood = true;
for (let round = 1; round <= ROUNDS; round++) {
  // Reset every SCRUM-182 event back to its seeded state, including the race one at 19/20.
  execSync('node scripts/seed-scrum182.mjs', { stdio: 'ignore' });
  const eventId = await eventIdByName('Client Appreciation Night (race)');
  const before = await registeredCount(eventId);
  const [ra, rb] = await Promise.all([
    post(a, eventId, { fullName: 'Tan Mei Ling', email: 'attendee@example.com', contactNumber: '+65 9123 4567' }),
    post(b, eventId, { fullName: 'Lim Wei Jie', email: 'attendee2@example.com', contactNumber: '+65 9876 5432' }),
  ]);
  const after = await registeredCount(eventId);
  const succeeded = [ra.status, rb.status].filter((s) => s === 201).length;
  const refused = [ra.status, rb.status].filter((s) => s === 409).length;
  const ok = before === 19 && after === 20 && succeeded === 1 && refused === 1;
  if (!ok) allGood = false;
  console.log(`round ${round}: before=${before} after=${after} succeeded=${succeeded} refused=${refused} statuses=[${ra.status},${rb.status}] ${ok ? 'OK' : 'FAIL <<<<<'}`);
}
console.log(allGood ? `\nAll ${ROUNDS} rounds: exactly one success, exactly one refusal, every time.` : '\nAT LEAST ONE ROUND FAILED — see above.');
