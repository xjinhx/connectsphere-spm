/**
 * What the equipment form sends for a quantity typed into a text box
 * (SCRUM-240 AC4).
 *
 * The same approach as the venue form's capacityToSend (capacityInput.ts), and
 * for the same reason: a whole number is sent as a number so the server can
 * say exactly what is wrong with it ("cannot be below zero"), and anything
 * else is sent as typed so the server rejects it as not a whole number. Only
 * conversions that are exact are made - Number() alone reads "2e2" as 200 and
 * "1.9999999999999999" as 2, which would save a quantity nobody typed.
 *
 * An empty box sends nothing at all, so the server answers "Quantity is
 * required." rather than complaining about the shape of a value that was never
 * entered (TC-240-11).
 */
const WHOLE_NUMBER = /^-?\d+(\.0+)?$/;

export function quantityToSend(value: string): number | string | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  if (!WHOLE_NUMBER.test(trimmed)) return trimmed;
  const parsed = Number(trimmed);
  // Beyond 2^53 the number is no longer the one typed; let the server refuse
  // the text instead.
  return Number.isSafeInteger(parsed) ? parsed : trimmed;
}
