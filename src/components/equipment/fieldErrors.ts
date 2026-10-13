/**
 * Pulls Zod's flattened fieldErrors out of an API error body without casting
 * to any, so the equipment forms can pin each message on the field it belongs
 * to (SCRUM-240 AC1 "each missing field is identified", AC4 "the quantity
 * field is identified").
 *
 * Same shape as the venue form's fieldErrorsFrom (VenueForm.tsx); kept here so
 * both the add form and the row editor can read it.
 */
export type FieldErrors = Record<string, string[]>;

export function fieldErrorsFrom(details: unknown): FieldErrors {
  if (typeof details !== 'object' || details === null) return {};
  const flattened = (details as { fieldErrors?: unknown }).fieldErrors;
  if (typeof flattened !== 'object' || flattened === null) return {};

  const result: FieldErrors = {};
  for (const [field, messages] of Object.entries(flattened as Record<string, unknown>)) {
    if (Array.isArray(messages)) {
      const strings = messages.filter((message): message is string => typeof message === 'string');
      if (strings.length > 0) result[field] = strings;
    }
  }
  return result;
}
