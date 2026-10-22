import { resolve } from 'node:path';
import { config } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Setting up and cleaning up a test's starting data, with the service key. Only
 * for arranging rows: what is being tested always goes through the pages.
 *
 * Reads the committed .env.test: the Supabase CLI's local demo keys, the same on
 * every machine. Never the cloud project.
 */
config({ path: resolve(process.cwd(), '.env.test'), override: false });

let client: SupabaseClient | null = null;

export function admin(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('.env.test is missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

/** Added to names a test creates, so runs never clash with each other or with your own data. */
export const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A date `days` after today in Singapore, as YYYY-MM-DD. */
export function daysFromToday(days: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A seeded account's user id, by its email. */
export async function userId(email: string): Promise<string> {
  const { data, error } = await admin().auth.admin.listUsers();
  if (error) throw new Error(`could not list users: ${error.message}`);
  const user = data.users.find((candidate) => candidate.email === email);
  if (!user) throw new Error(`${email} is not seeded: run npm run seed:users`);
  return user.id;
}

/** A seeded venue's id, by its name. */
export async function venueId(name: string): Promise<string> {
  const { data, error } = await admin().from('venues').select('id').eq('name', name).single();
  if (error || !data) throw new Error(`venue "${name}" is not in the seed: ${error?.message}`);
  return data.id as string;
}

// Events need a client organisation. One for the end-to-end tests, kept apart
// from the integration tests' own (tests/integration/fixtures).
const E2E_CLIENT_ORGANISATION_ID = '33333333-3333-4333-8333-333333333333';

export async function clientOrganisationId(): Promise<string> {
  const { error } = await admin()
    .from('client_organisations')
    .upsert({ id: E2E_CLIENT_ORGANISATION_ID, name: 'End-to-end Test Organisation' }, { onConflict: 'id' });
  if (error) throw new Error(`could not set up the test client organisation: ${error.message}`);
  return E2E_CLIENT_ORGANISATION_ID;
}
