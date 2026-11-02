/**
 * The message the change request form shows when the API refuses a request
 * (SCRUM-273, a bug on SCRUM-187 AC1).
 *
 * The API's envelope message only says "The change request is not valid.",
 * which does not tell the organiser what to fix. The reason is on the field,
 * in details.fieldErrors: "A reason is required." (TC-187-04) or "Give the
 * new value for each selected field." (TC-187-18). Every distinct field
 * message is shown, so a request with two problems names both. The same
 * approach as ClarificationResponseForm.
 *
 * A refusal with no field messages (the request can no longer be changed, or
 * it isn't yours) keeps the API's own message.
 */
export type ChangeRequestRefusal = {
  message?: string;
  details?: { formErrors?: string[]; fieldErrors?: Record<string, string[] | undefined> };
} | null;

export function refusalMessage(payload: ChangeRequestRefusal): string {
  const details = payload?.details;
  const messages = [...(details?.formErrors ?? []), ...Object.values(details?.fieldErrors ?? {}).flat()].filter(
    (message): message is string => Boolean(message),
  );
  if (messages.length > 0) return [...new Set(messages)].join(' ');
  return payload?.message ?? 'The change request could not be sent.';
}
