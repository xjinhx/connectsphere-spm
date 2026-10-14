import { NextRequest, NextResponse } from 'next/server';
import { createEquipmentItem, listEquipment } from '@/domain/equipment/service';
import { assertPermission } from '@/domain/identity/policy';
import { canViewEquipmentCatalogue } from '@/domain/equipment/policy';
import { ForbiddenError, ValidationError } from '@/domain/shared/errors';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * /api/equipment
 *
 * GET  SCRUM-240 AC1 and AC2, the catalogue list. Readable by whoever may
 *      choose from it (equipment_catalogue_view, AC5) and by Technical Support
 *      Staff, who maintain it.
 * POST SCRUM-240 AC1, add an item. Needs equipment_administration, so only
 *      Technical Support Staff ("Given I am Technical Support Staff"); every
 *      other role, and no session at all, is refused (AC3, TC-240-07,
 *      TC-240-08).
 *
 * Permission is checked before anything is parsed or read, as SCRUM-69 AC3
 * asks, so a refused caller never gets a partial result. getCurrentActor
 * throws UnauthenticatedError (401) when there is no session; a role that is
 * signed in but not permitted gets a ForbiddenError (403).
 */

export async function GET() {
  try {
    const actor = await getCurrentActor();
    if (!canViewEquipmentCatalogue(actor.roles)) {
      throw new ForbiddenError('Your role does not permit this action: equipment_catalogue_view.');
    }

    const equipment = await listEquipment();
    return NextResponse.json({ equipment });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'equipment_administration');

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }

    // The recorder is the signed-in account, never an id from the body.
    const item = await createEquipmentItem(body, actor.userId);
    return NextResponse.json({ equipment: item }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
