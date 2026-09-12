import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { publicEnv } from '../env';

/**
 * Server-side Supabase client that runs AS THE USER. We use it only to
 * answer "who is signed in?" - it respects RLS, so it can read the
 * caller's own profile and nothing else.
 *
 * For the admin/service-role client, see admin.ts - it's deliberately
 * kept in a separate, Next.js-free file so domain/ code can import it
 * without pulling in next/headers transitively.
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

/** The signed-in caller, or null if there's no valid session. */
export async function getSessionUser() {
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
