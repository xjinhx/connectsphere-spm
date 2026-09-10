import { createServerClient } from '@supabase/ssr';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { publicEnv, serverEnv } from '../env';

/**
 * Loosely-typed admin client.
 *
 * Until `npm run db:types` has generated src/lib/supabase/database.types.ts,
 * the client has no schema to check against and every table resolves to
 * `never`. Repositories therefore own the row shapes by hand (see
 * repositories/mappers.ts) and this alias keeps that explicit rather than
 * scattering casts. Swap `any` for the generated `Database` type to upgrade
 * every query to compiler-checked columns in one edit.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = SupabaseClient<any, 'public', any>;

/**
 * Two server-side Supabase clients, for two different jobs.
 *
 * createSessionClient() runs AS THE USER. We use it only to answer "who is
 * signed in?" - it respects RLS, so it can read the caller's own profile and
 * nothing else.
 *
 * createAdminClient() runs as the service role and bypasses RLS. Every
 * repository uses it, because authorisation is decided in the policy layer
 * (src/domain/identity/policy.ts) before any query is issued. It must never be
 * imported into a client component - the service key would end up in the
 * browser bundle.
 */

export async function createSessionClient() {
  const cookieStore = await cookies();

  return createServerClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // middleware refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}

let adminClient: AdminClient | null = null;

export function createAdminClient(): AdminClient {
  if (typeof window !== 'undefined') {
    throw new Error('createAdminClient() must never be called from the browser.');
  }
  if (!adminClient) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    adminClient = createClient<any, 'public', any>(
      publicEnv.NEXT_PUBLIC_SUPABASE_URL,
      serverEnv().SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
  }
  return adminClient;
}
