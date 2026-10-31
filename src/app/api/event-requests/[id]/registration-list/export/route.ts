import { NextResponse } from 'next/server';
import { exportRegistrationList } from '@/domain/registration-list/service';
import { assertPermission } from '@/domain/identity/policy';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * GET /api/event-requests/[id]/registration-list/export
 *
 * SCRUM-185 AC2: the Event Organiser responsible for the event downloads its
 * registration list as CSV: reference, full name, email, contact number,
 * registration date (DD/MM/YYYY) and status, one row per registration.
 *
 * 200 with the file; 401 with no session; 403 for any role but Event
 * Organiser, for an organiser in the same organisation who is not responsible
 * (AC3, TC-185-06), or an organiser of another organisation (AC4); 404 for an
 * unknown event.
 *
 * The permission is checked first, before anything is read.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'registration_list_export');

    const { id } = await params;
    const { fileName, csv } = await exportRegistrationList(id, actor);

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        // Attendee details: never kept by a shared cache.
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
