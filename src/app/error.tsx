'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Root error boundary for every route under app/ (see DomainError in
 * src/domain/shared/errors.ts for why `digest` carries the error code: Next
 * strips `error.message` from Server Component errors before they reach a
 * client boundary like this one in production, but preserves a digest we set
 * ourselves).
 *
 * Without this, an unhandled DomainError - e.g. a non-Organiser hitting
 * /events/new - crashed to Next's raw dev overlay / generic prod error page
 * instead of a handled "access denied" state.
 */
const DOMAIN_ERROR_PREFIX = 'DOMAIN_ERROR:';

const HEADING_BY_CODE: Record<string, string> = {
  FORBIDDEN: 'Access denied',
  NOT_FOUND: 'Not found',
};

const MESSAGE_BY_CODE: Record<string, string> = {
  FORBIDDEN: 'You do not have permission to view this page.',
  NOT_FOUND: 'The page you were looking for could not be found.',
  VALIDATION_ERROR: 'That request was not valid.',
  CONFLICT: 'That could not be completed because of a conflict with existing data.',
  INVALID_TRANSITION: "That action isn't allowed in the current state.",
  CAPACITY_EXCEEDED: 'That would exceed capacity.',
  UNAVAILABLE: 'That is not currently available.',
};

function domainErrorCode(digest: string | undefined): string | null {
  if (!digest?.startsWith(DOMAIN_ERROR_PREFIX)) return null;
  return digest.slice(DOMAIN_ERROR_PREFIX.length);
}

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const code = domainErrorCode(error.digest);

  // Consistent with middleware.ts: a session that's gone by the time the
  // page renders sends the user to /login, not to an error page.
  useEffect(() => {
    if (code === 'UNAUTHENTICATED') {
      router.replace('/login');
    }
  }, [code, router]);

  if (code === 'UNAUTHENTICATED') {
    return null;
  }

  return (
    <main className="mx-auto max-w-md px-4 py-16 text-center">
      <h1 className="text-lg font-semibold">{code ? (HEADING_BY_CODE[code] ?? 'Something went wrong') : 'Something went wrong'}</h1>
      <p className="mt-2 text-sm text-[var(--text-muted)]">
        {code ? (MESSAGE_BY_CODE[code] ?? 'Please try again.') : 'Please try again.'}
      </p>
      {!code && (
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--surface)]"
        >
          Try again
        </button>
      )}
    </main>
  );
}
