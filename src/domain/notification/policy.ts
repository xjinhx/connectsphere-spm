/**
 * Notifications: who may read or act on which row.
 *
 * SCRUM-193's implicit access rule: a notification was generated for one
 * person, and only that person may see or mark it read. No role check - any
 * account type can be a recipient (an Organiser gets review outcomes, a
 * Coordinator gets assignment/clarification notices per the DUMMY(SCRUM-24)
 * markers this story replaces). This is the same "connected to the thing"
 * pattern identity/policy.ts's comment describes for other narrowed reads,
 * just narrower still: connected means "is the recipient", not "shares a
 * role with it".
 */
export function canAccessNotification(recipientId: string, actorId: string): boolean {
  return recipientId === actorId;
}
