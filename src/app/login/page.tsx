'use client';

import { useRouter } from 'next/navigation';
import { LoginForm, type LoginResult } from '@/components/auth/LoginForm';
import { INVALID_CREDENTIALS_MESSAGE, type LoginInput } from '@/domain/identity/login';
import { landingPathForRoles } from '@/domain/identity/roles';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

export default function LoginPage() {
  const router = useRouter();

  async function handleLogin(input: LoginInput): Promise<LoginResult> {
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.auth.signInWithPassword(input);

    // Wrong password and unregistered email both land here, so Supabase's
    // own error is never shown - the PRD requires one message either way.
    if (error || !data.user) {
      return { ok: false, message: INVALID_CREDENTIALS_MESSAGE };
    }

    // Roles live in the `profiles` table, not the auth session, so they're
    // looked up server-side rather than off the (unauthoritative) client
    // session. A missing/failed lookup still lets the user in - it only
    // affects which page they land on - so it falls through to the
    // Attendee default instead of blocking sign-in.
    const rolesResponse = await fetch(`/api/accounts/${data.user.id}/roles`);
    const roles = rolesResponse.ok ? ((await rolesResponse.json()).roles as unknown[]) : undefined;

    router.push(landingPathForRoles(roles));
    return { ok: true };
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="w-full max-w-sm rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
        <h1 className="mb-6 text-center text-xl font-semibold">Log in to ConnectSphere</h1>
        <LoginForm onSubmit={handleLogin} />
      </div>
    </main>
  );
}
