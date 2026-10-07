import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAdminClient } from '@/lib/supabase/admin';
import { listNotifications, getUnreadCount, markAsRead } from '@/domain/notification/service';
import { assignCoordinator } from '@/domain/assignment/service';
import { approveEventRequest, rejectEventRequest, requestClarification } from '@/domain/review/service';
import { ensureTestClientOrganisation } from './fixtures/clientOrganisation';

/**
 * SCRUM-193 View my notifications, SCRUM-198 Notify organisers about review
 * outcomes.
 *
 * Runs against the local Supabase stack, like assign-coordinator.test.ts.
 * The first describe block proves SCRUM-193's own behaviour (list, unread
 * count, mark read) against notifications inserted directly. The second
 * proves SCRUM-198's hooks actually create a notification when each review
 * action succeeds - the thing assign-coordinator.test.ts (and the other
 * review/service.ts tests) flagged as "not covered here" before this story
 * existed.
 */

const supabase = createAdminClient();

const CLIENT_ORGANISATION_ID = '22222222-2222-2222-2222-222222222222';

let organiserId: string;
let coordinatorId: string;
let otherOrganiserId: string;
const createdRequestIds: string[] = [];
const createdUserIds: string[] = [];

async function createAccount(label: string, roles: string[]): Promise<string> {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const { data, error } = await supabase.auth.admin.createUser({
    email: `${slug}+${Date.now()}${Math.random().toString(36).slice(2, 8)}@connectsphere.example.com`,
    password: 'Password123!',
    email_confirm: true,
    user_metadata: { full_name: label },
  });
  if (error || !data.user) {
    throw new Error(`could not create test ${label}: ${error?.message ?? 'no user returned'}`);
  }
  const { error: profileError } = await supabase
    .from('profiles')
    .update({ roles, full_name: label })
    .eq('id', data.user.id);
  if (profileError) throw new Error(`could not set roles for ${label}: ${profileError.message}`);
  createdUserIds.push(data.user.id);
  return data.user.id;
}

async function createEventRequest(organiser: string, status: 'submitted' = 'submitted'): Promise<string> {
  const { data, error } = await supabase
    .from('event_request')
    .insert({
      organiser_id: organiser,
      client_organisation_id: CLIENT_ORGANISATION_ID,
      name: 'Notification Test Event',
    })
    .select('id')
    .single();
  if (error) throw new Error(`could not create test request: ${error.message}`);
  const id = data.id as string;
  createdRequestIds.push(id);

  if (status === 'submitted') {
    const { error: submitError } = await supabase
      .from('event_request')
      .update({ status: 'submitted' })
      .eq('id', id);
    if (submitError) throw new Error(`could not submit test request: ${submitError.message}`);
  }
  return id;
}

/** Inserted directly, bypassing createNotification, to test the read side in isolation. */
async function insertRawNotification(recipientId: string, eventRequestId: string, overrides: Partial<{ type: string; message: string }> = {}) {
  const { data, error } = await supabase
    .from('notifications')
    .insert({
      recipient_id: recipientId,
      event_request_id: eventRequestId,
      type: overrides.type ?? 'request_approved',
      message: overrides.message ?? 'Test notification',
    })
    .select('id')
    .single();
  if (error) throw new Error(`could not insert test notification: ${error.message}`);
  return data.id as string;
}

async function latestNotificationFor(recipientId: string, eventRequestId: string) {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, message, read_at')
    .eq('recipient_id', recipientId)
    .eq('event_request_id', eventRequestId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`could not read notification: ${error.message}`);
  return data;
}

beforeAll(async () => {
  await ensureTestClientOrganisation(supabase);
  organiserId = await createAccount('Notify Organiser', ['event_organiser']);
  coordinatorId = await createAccount('Notify Coordinator', ['coordinator']);
  otherOrganiserId = await createAccount('Other Organiser', ['event_organiser']);
});

afterAll(async () => {
  for (const id of createdRequestIds) {
    await supabase.from('event_request').delete().eq('id', id);
  }
  for (const id of createdUserIds) {
    await supabase.auth.admin.deleteUser(id);
  }
});

describe('SCRUM-193: listNotifications, getUnreadCount, markAsRead', () => {
  it('T1 lists notifications with message, related event and time, newest first (AC1)', async () => {
    const eventId = await createEventRequest(organiserId);
    const firstId = await insertRawNotification(organiserId, eventId, { message: 'First' });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const secondId = await insertRawNotification(organiserId, eventId, { message: 'Second' });

    const notifications = await listNotifications(organiserId);
    const ids = notifications.map((n) => n.id);

    expect(ids.indexOf(secondId)).toBeLessThan(ids.indexOf(firstId));
    const found = notifications.find((n) => n.id === firstId);
    expect(found?.message).toBe('First');
    expect(found?.eventRequestId).toBe(eventId);
    expect(found?.createdAt).toBeTruthy();
  });

  it('T4 an unread notification is counted (AC2)', async () => {
    const eventId = await createEventRequest(organiserId);
    await insertRawNotification(organiserId, eventId);

    const before = await getUnreadCount(organiserId);
    const afterCount = await listNotifications(organiserId);
    expect(before.count).toBeGreaterThanOrEqual(1);
    expect(afterCount.length).toBeGreaterThanOrEqual(1);
  });

  it('T6/T7 opening a notification marks it read and the unread count decreases (AC3)', async () => {
    const eventId = await createEventRequest(organiserId);
    const notificationId = await insertRawNotification(organiserId, eventId);

    const before = await getUnreadCount(organiserId);
    const opened = await markAsRead(notificationId, organiserId);
    const after = await getUnreadCount(organiserId);

    expect(opened.readAt).not.toBeNull();
    expect(after.count).toBe(before.count - 1);
  });

  it('T9 re-opening an already-read notification does not change the unread count', async () => {
    const eventId = await createEventRequest(organiserId);
    const notificationId = await insertRawNotification(organiserId, eventId);
    await markAsRead(notificationId, organiserId);

    const before = await getUnreadCount(organiserId);
    const reopened = await markAsRead(notificationId, organiserId);
    const after = await getUnreadCount(organiserId);

    expect(reopened.readAt).toBe((await latestNotificationFor(organiserId, eventId))?.read_at);
    expect(after.count).toBe(before.count);
  });

  it('T10 a user only sees their own notifications', async () => {
    const eventId = await createEventRequest(organiserId);
    await insertRawNotification(organiserId, eventId, { message: 'Mine' });

    const otherEventId = await createEventRequest(otherOrganiserId);
    await insertRawNotification(otherOrganiserId, otherEventId, { message: 'Not mine' });

    const mine = await listNotifications(organiserId);
    expect(mine.every((n) => n.message !== 'Not mine')).toBe(true);
  });

  it('refuses to mark as read a notification that belongs to someone else', async () => {
    const eventId = await createEventRequest(organiserId);
    const notificationId = await insertRawNotification(organiserId, eventId);

    await expect(markAsRead(notificationId, otherOrganiserId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('SCRUM-198: review actions create a notification', () => {
  it('AC2 approving a request notifies the organiser', async () => {
    const eventId = await createEventRequest(organiserId);
    await assignCoordinator(eventId, { coordinatorId, actorId: coordinatorId });

    await approveEventRequest(eventId, { actorId: coordinatorId });

    const notification = await latestNotificationFor(organiserId, eventId);
    expect(notification?.type).toBe('request_approved');
    expect(notification?.message).toContain('approved');
  });

  it('AC3 rejecting a request notifies the organiser with the reason', async () => {
    const eventId = await createEventRequest(organiserId);
    await assignCoordinator(eventId, { coordinatorId, actorId: coordinatorId });

    await rejectEventRequest(eventId, { reason: 'Venue unavailable' }, coordinatorId);

    const notification = await latestNotificationFor(organiserId, eventId);
    expect(notification?.type).toBe('request_rejected');
    expect(notification?.message).toContain('Venue unavailable');
  });

  it('AC1 requesting clarification notifies the organiser with the note', async () => {
    const eventId = await createEventRequest(organiserId);
    await assignCoordinator(eventId, { coordinatorId, actorId: coordinatorId });

    await requestClarification(eventId, { note: 'Please confirm attendee count' }, coordinatorId);

    const notification = await latestNotificationFor(organiserId, eventId);
    expect(notification?.type).toBe('clarification_requested');
    expect(notification?.message).toContain('Please confirm attendee count');
  });

  it('AC5 assigning a coordinator notifies the coordinator', async () => {
    const eventId = await createEventRequest(organiserId);

    await assignCoordinator(eventId, { coordinatorId, actorId: coordinatorId });

    const notification = await latestNotificationFor(coordinatorId, eventId);
    expect(notification?.type).toBe('coordinator_assigned');
  });
});
