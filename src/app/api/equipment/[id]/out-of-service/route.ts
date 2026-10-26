import { NextRequest, NextResponse } from 'next/server';
import { recordOutOfService } from '@/domain/equipment-out-of-service/service';
import { assertPermission } from '@/domain/identity/policy';
import { ValidationError } from '@/domain/shared/errors';
import { handleApiError } from '@/lib/api/handler';
import { getCurrentActor } from '@/lib/auth/currentActor';

/**
 * PUT /api/equipment/[id]/out-of-service — SCRUM-170, record how many of an
 * item's units are out of service. Body: { unavailable, damaged,
 * underMaintenance }, each a whole number of units.
 *
 * 200 with { item } (AC1, AC2). 400 with the field named when a count is
 * below zero or the counts add up to more than the item has (AC4); nothing is
 * saved then.
 *
 * Technical Support Staff only (equipment_administration, the permission that
 * maintains the catalogue in SCRUM-69's matrix), checked before the body is
 * read.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    return NextResponse.json({ item: await recordOutOfService(id, body) });
  } catch (error) {
    return handleApiError(error);
  }
}
