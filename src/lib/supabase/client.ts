'use client';

import { createBrowserClient } from '@supabase/ssr';
import { publicEnv } from '../env';

/**
 * Browser Supabase client. Used ONLY for authentication (sign in, sign out,
 * session refresh). All data access goes through our API routes so that the
 * policy layer decides authorisation - RLS denies direct table reads anyway.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}
