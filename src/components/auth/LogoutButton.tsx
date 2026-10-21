'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';

/**
 * SCRUM-75 AC1: ends the session and sends the user back to login. Signing
 * out clears the Supabase session cookies the middleware checks on every
 * request, so returning to any protected page redirects to /login on its own
 * - this button only needs to trigger that and navigate there directly.
 */
export function LogoutButton() {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    setIsLoggingOut(true);
    // SCRUM-249 AC5: forget the "Working as" choice, so the next login starts on
    // the default role. Done before signing out, while the request is still
    // authenticated; a failure here must not stop the logout.
    await fetch('/api/me/working-as', { method: 'DELETE' }).catch(() => undefined);
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={isLoggingOut}
      className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--surface)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isLoggingOut ? 'Logging out…' : 'Log out'}
    </button>
  );
}
