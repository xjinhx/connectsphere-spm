/**
 * What the venue form sends for a capacity typed into a text box.
 *
 * A plain decimal number is sent as a number, so the server can say exactly
 * what is wrong with it ("must be greater than 0", "must be a whole number").
 * Anything else is sent as typed, and the server rejects it as not a number
 * (SCRUM-116 AC3, US-11.1-TC03).
 *
 * Number() alone was used before, and it also reads "2e2" as 200 and "0x1F" as
 * 31, so a slip of the keyboard saved a capacity nobody typed. Found reviewing
 * SCRUM-215.
 */
const PLAIN_DECIMAL = /^-?\d+(\.\d+)?$/;

export function capacityToSend(value: string): number | string {
  const trimmed = value.trim();
  return PLAIN_DECIMAL.test(trimmed) ? Number(trimmed) : trimmed;
}
