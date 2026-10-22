import { redirect } from 'next/navigation';
import { landingPathFor } from '@/domain/navigation/policy';
import { getSignedInAccount } from '@/lib/auth/signedInAccount';

/**
 * SCRUM-249 AC3 — opening / takes a signed-in user to their landing page: the
 * landing page of the role they are working as (AC5). The middleware already
 * sends anyone signed out to /login before this runs.
 */
export default async function HomePage() {
  const account = await getSignedInAccount();
  redirect(account ? landingPathFor(account.workingRole) : '/login');
}
