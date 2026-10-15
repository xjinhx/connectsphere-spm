import { NextResponse } from 'next/server';
import { getEquipmentFormOptions, listEquipmentOptions } from '@/domain/equipment/service';
import { canViewEquipmentCatalogue } from '@/domain/equipment/policy';
import { ForbiddenError } from '@/domain/shared/errors';
import { getCurrentActor } from '@/lib/auth/currentActor';
import { handleApiError } from '@/lib/api/handler';

/**
 * /api/equipment/options
 *
 * SCRUM-240 AC5: the items a coordinator may choose when recording an
 * equipment requirement, plus the fixed category and status lists the add and
 * edit forms fill their dropdowns from.
 *
 * Every catalogue item is offered, whatever its operational status: AC5 limits
 * the choice to items that exist, not to items free on the date (TC-240-16).
 * What is free on a date is equipment availability (SCRUM-166/167/170), not in
 * this sprint.
 *
 * This is the contract SCRUM-160's requirement form reads; the saving side
 * calls assertEquipmentInCatalogue (domain/equipment/service.ts) so an unknown
 * id posted straight at its API is refused too (TC-240-15).
 *
 * Needs equipment_catalogue_view, which Coordinators hold, or
 * equipment_administration. A static segment wins over the dynamic one, so
 * this does not collide with /api/equipment/[id].
 */

export async function GET() {
  try {
    const actor = await getCurrentActor();
    if (!canViewEquipmentCatalogue(actor.roles)) {
      throw new ForbiddenError('Your role does not permit this action: equipment_catalogue_view.');
    }

    const items = await listEquipmentOptions();
    return NextResponse.json({ equipment: items, options: getEquipmentFormOptions() });
  } catch (error) {
    return handleApiError(error);
  }
}
