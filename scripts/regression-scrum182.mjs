// Post-merge regression for SCRUM-182, run against the actual `main` dev
// server (localhost:3000) and the real local Postgres, using the exact
// @supabase/ssr cookie format the app itself uses (so the HTTP requests are
// indistinguishable from a signed-in browser to the server). One scenario
// per AC, per docs/pr-review-process.md step 5.
//
//   npm run dev        (in another terminal, against main)
//   node scripts/regression-scrum182.mjs
import { config } from 'dotenv';
import { resolve } from 'path';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = 'http://localhost:3000';

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

console.log('=== R1 (AC1): a full event refuses registration, shown as full ===');
{
  const attendeeCookie = await cookieHeaderFor('attendee@example.com', 'TestPass123!');
  const eventId = await eventIdByName('Client Appreciation Night (full)');
  const before = await registeredCount(eventId);
  const pageRes = await fetch(`${APP_URL}/register-events/${eventId}`, { headers: { Cookie: attendeeCookie } });
  const pageHtml = await pageRes.text();
  const showsFull = pageHtml.includes('There are no places remaining for this event.');
  const result = await post(attendeeCookie, eventId, {
    fullName: 'Regression Tester',
    email: 'attendee@example.com',
    contactNumber: '+65 9000 0001',
  });
  const after = await registeredCount(eventId);
  console.log({ eventId, before, after, pageShowsFull: showsFull, apiStatus: result.status, apiError: result.json?.error });
}

console.log('\n=== R2 (AC2): two attendees racing for the last place, exactly one succeeds ===');
{
  const a = await cookieHeaderFor('attendee@example.com', 'TestPass123!');
  const b = await cookieHeaderFor('attendee2@example.com', 'TestPass123!');
  const eventId = await eventIdByName('Client Appreciation Night (race)');
  const before = await registeredCount(eventId);
  const [ra, rb] = await Promise.all([
    post(a, eventId, { fullName: 'Tan Mei Ling', email: 'attendee@example.com', contactNumber: '+65 9123 4567' }),
    post(b, eventId, { fullName: 'Lim Wei Jie', email: 'attendee2@example.com', contactNumber: '+65 9876 5432' }),
  ]);
  const after = await registeredCount(eventId);
  console.log({
    eventId,
    before,
    after,
    attendeeAStatus: ra.status,
    attendeeBStatus: rb.status,
    attendeeAError: ra.json?.error,
    attendeeBError: rb.json?.error,
  });
}

console.log('\n=== R3 (AC3): a withdrawal frees the place, registration then succeeds, no waiting list ===');
{
  const c = await cookieHeaderFor('attendee3@example.com', 'TestPass123!');
  const eventId = await eventIdByName('Client Appreciation Night (withdrawal)');
  const before = await registeredCount(eventId);
  const refused = await post(c, eventId, { fullName: 'Siti Nur Aisyah', email: 'attendee3@example.com', contactNumber: '+65 9234 5678' });
  // Withdraw one Registered row directly, the same fact SCRUM-184 will write (D-25).
  const { data: toWithdraw, error: fetchErr } = await admin
    .from('event_registration')
    .select('id')
    .eq('event_request_id', eventId)
    .eq('status', 'registered')
    .limit(1)
    .single();
  if (fetchErr) throw fetchErr;
  const { error: withdrawErr } = await admin.from('event_registration').update({ status: 'withdrawn' }).eq('id', toWithdraw.id);
  if (withdrawErr) throw withdrawErr;
  const afterWithdraw = await registeredCount(eventId);
  const succeeded = await post(c, eventId, { fullName: 'Siti Nur Aisyah', email: 'attendee3@example.com', contactNumber: '+65 9234 5678' });
  const after = await registeredCount(eventId);
  // No waiting list / no notification: nobody gets one just because a place opened up.
  const { count: notifCount } = await admin.from('notifications').select('id', { count: 'exact', head: true }).eq('event_request_id', eventId);
  console.log({
    eventId,
    before,
    refusedWhileFullStatus: refused.status,
    refusedWhileFullError: refused.json?.error,
    afterWithdraw,
    succeededStatus: succeeded.status,
    succeededReference: succeeded.json?.reference,
    after,
    notificationsOnThisEvent: notifCount,
  });
}
