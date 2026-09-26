/**
 * What the venue form sends for a capacity typed into a text box.
 *
 * A whole number is sent as a number, so the server can say exactly what is
 * wrong with it ("must be greater than 0", "is too large"). Anything else is
 * sent as typed, and the server rejects it as not a whole number (SCRUM-116
 * AC3, US-11.1-TC03). Only conversions that are exact are made: Number()
 * alone reads "2e2" as 200, "0x1F" as 31 and "1.9999999999999999" as 2, so a
 * slip of the keyboard saved a capacity nobody typed. Found reviewing
 * SCRUM-215.
 */
const WHOLE_NUMBER = /^-?\d+(\.0+)?$/;

export function capacityToSend(value: string): number | string {
  const trimmed = value.trim();
  if (!WHOLE_NUMBER.test(trimmed)) return trimmed;
  const parsed = Number(trimmed);
  // Beyond 2^53 the number is no longer the one typed; let the server refuse
  // the text instead.
  return Number.isSafeInteger(parsed) ? parsed : trimmed;
}

/**
 * SCRUM-119: what the venue form sends for setup, teardown or turnaround
 * minutes. Unlike capacity, these are optional - a blank box means "leave
 * this unchanged", not "clear it", so blank is sent as undefined rather
 * than as text the server would reject.
 */
export function minutesToSend(value: string): number | string | undefined {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  if (!WHOLE_NUMBER.test(trimmed)) return trimmed;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : trimmed;
}
