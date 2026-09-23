import type { Metadata } from 'next';
import './globals.css';
import { LogoutButton } from '@/components/auth/LogoutButton';
import { createSessionClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'ConnectSphere Event Services',
  description: 'Event planning and venue booking for ConnectSphere Event Services.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {user && (
          <header className="flex justify-end border-b border-[var(--border)] px-6 py-3">
            <LogoutButton />
          </header>
        )}
        {children}
      </body>
    </html>
  );
}