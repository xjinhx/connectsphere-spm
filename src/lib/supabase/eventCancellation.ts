import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './admin';
import type { Database } from './database.types';

/**
 * Event cancellation queries (SCRUM-105 Cancel an event at any stage).
 *
 * The rules live in 20261030070000_cancel_event.sql: these call it, and
 * src/domain/event-status/service.ts decides who may. Each returns the raw
 * Supabase result, through the service-role client, as the other files here do.
 */

function db(): SupabaseClient<Database> {
  return createAdminClient();
}

/**
 * AC1, AC3, AC6: one call to cancel_event, which locks the event, cancels it
 * from Submitted to Preparation, and releases its bookings and reservations in
 * the same transaction. Resolves to its JSON outcome.
 */
export async function runCancelEvent(eventRequestId: string, reason: string, cancelledBy: string) {
  return db().rpc('cancel_event', { p_event_request_id: eventRequestId, p_reason: reason, p_cancelled_by: cancelledBy });
}

/** AC1: why the event was cancelled, by whom and when (all null if it was not). */
export async function fetchEventCancellation(eventRequestId: string) {
  return db()
    .from('event_request')
    .select('cancellation_reason, cancelled_by, cancelled_at')
    .eq('id', eventRequestId)
    .maybeSingle();
}
