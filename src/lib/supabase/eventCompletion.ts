import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from './admin';
import type { Database } from './database.types';

/**
 * Event completion queries (SCRUM-104 Mark an event as completed).
 *
 * The rules live in 20261025084357_event_completion.sql: these call its
 * functions, and src/domain/event-status/service.ts decides when. Each returns
 * the raw Supabase result, through the service-role client, as the other files
 * here do.
 */

function db(): SupabaseClient<Database> {
  return createAdminClient();
}

/** The event's end date: its last confirmed booking day, else its proposed date. Null with neither. */
export async function fetchEventEndDate(eventRequestId: string) {
  return db().rpc('event_end_date', { p_event_request_id: eventRequestId });
}

/** AC1, AC2: when the event was completed, and by whom (null for the completion check). */
export async function fetchEventCompletion(eventRequestId: string) {
  return db().from('event_request').select('completed_at, completed_by').eq('id', eventRequestId).maybeSingle();
}

/**
 * AC1, AC4, AC5: one call to complete_event, which locks the event and
 * completes it only from Preparation and after its end date. Resolves to
 * 'completed', 'not_preparation' or 'not_ended'.
 */
export async function markEventCompleted(eventRequestId: string, completedBy: string) {
  return db().rpc('complete_event', { p_event_request_id: eventRequestId, p_completed_by: completedBy });
}

/** AC2, AC3: run the completion check once, as pg_cron does daily. Resolves to how many it completed. */
export async function runCompletionCheck(today?: string) {
  return db().rpc('complete_past_events', today === undefined ? {} : { p_today: today });
}
