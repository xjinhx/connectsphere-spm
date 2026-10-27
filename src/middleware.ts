import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { publicEnv } from '@/lib/env';
import { isSessionIdleExpired, isSignedOutPage } from '@/domain/session/policy';

/** Only the login page itself is reachable without a session. */

/** SCRUM-75 AC2: last-activity marker used to detect a 30-minute idle session. */
const LAST_ACTIVITY_COOKIE = 'csp_last_activity';

function rejectUnauthenticated(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith('/api')) {
    return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
  }
  return NextResponse.redirect(new URL('/login', request.url));
}

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    if (isSignedOutPage(request.nextUrl.pathname)) {
      return response;
    }
    return rejectUnauthenticated(request);
  }

  const lastActivityRaw = request.cookies.get(LAST_ACTIVITY_COOKIE)?.value;
  const lastActivityAt = lastActivityRaw ? new Date(lastActivityRaw) : null;
  const now = new Date();

  if (lastActivityAt && !Number.isNaN(lastActivityAt.getTime()) && isSessionIdleExpired(lastActivityAt, now)) {
    // Revoke the Supabase session server-side (not just the idle cookie) so a
    // captured access/refresh token cannot be replayed after the idle cutoff.
    await supabase.auth.signOut();
    const rejection = rejectUnauthenticated(request);
    for (const cookie of response.cookies.getAll()) {
      rejection.cookies.set(cookie);
    }
    rejection.cookies.delete(LAST_ACTIVITY_COOKIE);
    return rejection;
  }

  response.cookies.set(LAST_ACTIVITY_COOKIE, now.toISOString(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
