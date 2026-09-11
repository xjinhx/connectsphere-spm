import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { publicEnv, serverEnv } from '../env';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = SupabaseClient<any, 'public', any>;

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