import type { Metadata } from 'next';
import './globals.css';
import { AppHeader } from '@/components/navigation/AppHeader';
import { accountDisplay, landingPathFor } from '@/domain/navigation/policy';
import { ROLE_NAV } from '@/domain/navigation/roleNav';
import { getSignedInAccount } from '@/lib/auth/signedInAccount';

export const metadata: Metadata = {
  title: 'ConnectSphere Event Services',
  description: 'Event planning and venue booking for ConnectSphere Event Services.',
};

/**
 * SCRUM-249 — every page for a signed-in user gets the shared header, built
 * for the role being worked as (AC5). Signed-out pages (login) get none.
 */
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const account = await getSignedInAccount();

  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {account && (
          <AppHeader
            homeHref={landingPathFor(account.workingRole)}
            navItems={ROLE_NAV[account.workingRole]}
            account={accountDisplay(account.fullName, account.email)}
            roles={account.roles}
            workingRole={account.workingRole}
          />
        )}
        {children}
      </body>
    </html>
  );
}
