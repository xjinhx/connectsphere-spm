import { describe, it } from 'vitest';
import { changeEventStatus } from '@/domain/event-status/service';
import { EventRequestStatusEnum } from '@/domain/event-request/schema';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * SCRUM-103 — manual-test harness, not an automated test.
 *
 * No screen or route moves an event's status yet: SCRUM-101's actions will call
 * changeEventStatus when they land. Until then, this is how a person runs the
 * real function against an event they chose, then checks the stored row
 * themselves (CLAUDE.md: testing a story "through its function" counts as
 * manual testing).
 *
 * Skipped unless both variables are set, so `npm test` never runs it. From
 * PowerShell:
 *
 *   $env:EVENT_ID='<event_request id>'; $env:TO_STATUS='confirmed'
 *   npx vitest run tests/manual/change-event-status.test.ts
 *   Remove-Item Env:EVENT_ID, Env:TO_STATUS
 *
 * It prints the status before, the outcome (moved, or refused with the reason)
 * and the status after, read back from the database.
 *
 * Local only: tests/setup.ts loads .env.test, and this refuses to run against
 * anything but a local Supabase, so it can never move a status in the cloud
 * project.
 */

const eventId = process.env.EVENT_ID;
const toStatus = process.env.TO_STATUS;

describe.runIf(Boolean(eventId && toStatus))('SCRUM-103 manual harness', () => {
  it(`moves event ${eventId ?? ''} to ${toStatus ?? ''}`, async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/.test(url)) {
      throw new Error(`Refusing to run: ${url || 'no Supabase URL'} is not the local stack.`);
    }

    const to = EventRequestStatusEnum.parse(toStatus);
    const id = eventId ?? '';
    const readStatus = async (): Promise<string> => {
      const { data } = await createAdminClient().from('event_request').select('status').eq('id', id).maybeSingle();
      return data ? String(data.status) : '(no such event)';
    };

    const before = await readStatus();
    let outcome: string;
    try {
      outcome = `MOVED to ${await changeEventStatus(id, to)}`;
    } catch (error) {
      outcome = `REFUSED: ${error instanceof Error ? error.message : String(error)}`;
    }
    const after = await readStatus();

    console.log(`\n  Event:   ${id}\n  Before:  ${before}\n  Asked:   ${to}\n  Outcome: ${outcome}\n  After:   ${after}\n`);
  });
});
