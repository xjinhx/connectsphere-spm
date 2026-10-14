import { NextRequest, NextResponse } from 'next/server';
import { getEquipmentItem, updateEquipmentItem } from '@/domain/equipment/service';
import { assertPermission } from '@/domain/identity/policy';
import { canViewEquipmentCatalogue } from '@/domain/equipment/policy';
import { ForbiddenError, ValidationError } from '@/domain/shared/errors';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * /api/equipment/[id]
 *
 * GET   SCRUM-240 AC2, one item read from its stored row.
 * PATCH SCRUM-240 AC2 and AC4, change an item's status, quantity, name,
 *       category or location. Needs equipment_administration (AC3).
 *
 * PATCH rather than PUT: a field left out is left unchanged, so a status
 * change does not blank the rest of the row (TC-240-06).
 *
 * Permission is checked first, before the id is even parsed (SCRUM-69 AC3).
 * An id that is not in the catalogue is a 404; a status outside AC2's four, or
 * a quantity AC4 refuses, is a 400 naming the field.
 */

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentActor();
    if (!canViewEquipmentCatalogue(actor.roles)) {
      throw new ForbiddenError('Your role does not permit this action: equipment_catalogue_view.');
    }

    const { id } = await params;
    const item = await getEquipmentItem(id);
    return NextResponse.json({ equipment: item });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getCurrentActor();
    assertPermission(actor.roles, 'equipment_administration');

    const { id } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ValidationError('Request body must be valid JSON.');
    }

    const item = await updateEquipmentItem(id, body);
    return NextResponse.json({ equipment: item });
  } catch (error) {
    return handleApiError(error);
  }
}
