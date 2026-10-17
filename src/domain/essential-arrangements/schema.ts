import { z } from 'zod';

/**
 * SCRUM-100 — Record which arrangements are essential for an event.
 *
 * AC1: "when I mark venue as essential and equipment, technical support and
 * registration as not required, then that essential set is stored against the
 * event". The four arrangements and the two answers are the card's own words.
 *
 * Whichever story stops an event being confirmed while an essential
 * arrangement is incomplete (customer clarification #80) should read this set
 * through getEssentialArrangements; extend this file rather than duplicate it.
 */

/** The four arrangements AC1 names, in the order the card lists them. */
export const ARRANGEMENTS = ['venue', 'equipment', 'technicalSupport', 'registration'] as const;
export type Arrangement = (typeof ARRANGEMENTS)[number];

export const ARRANGEMENT_LABELS: Record<Arrangement, string> = {
  venue: 'Venue',
  equipment: 'Equipment',
  technicalSupport: 'Technical support',
  registration: 'Registration',
};

/** AC1: each arrangement is essential or not required, nothing else. */
export const ArrangementNeedSchema = z.enum(['essential', 'not_required']);
export type ArrangementNeed = z.infer<typeof ArrangementNeedSchema>;

export const ARRANGEMENT_NEED_LABELS: Record<ArrangementNeed, string> = {
  essential: 'Essential',
  not_required: 'Not required',
};

/** One arrangement's answer. A missing or unknown answer names the arrangement (TC-100-09). */
function needFor(arrangement: Arrangement) {
  const message = `${ARRANGEMENT_LABELS[arrangement]} must be marked as essential or not required.`;
  return z.enum(['essential', 'not_required'], { errorMap: () => ({ message }) });
}

/**
 * AC1: the set the coordinator saves. Every arrangement must be answered
 * (TC-100-09), and strict(), so an arrangement the card does not name (for
 * example catering) is refused rather than silently dropped.
 */
export const EssentialArrangementsInputSchema = z
  .object({
    venue: needFor('venue'),
    equipment: needFor('equipment'),
    technicalSupport: needFor('technicalSupport'),
    registration: needFor('registration'),
  })
  .strict({ message: 'Only venue, equipment, technical support and registration can be marked.' });

export type EssentialArrangementsInput = z.infer<typeof EssentialArrangementsInputSchema>;
export type ArrangementNeeds = Record<Arrangement, ArrangementNeed>;

/** What the event page shows (AC2) and whether it offers a change (AC1, AC3). */
export interface EssentialArrangementsView {
  needs: ArrangementNeeds;
  /** The arrangements marked essential, in card order. Empty means none outstanding (AC2). */
  essential: Arrangement[];
  /** True when the viewer is the assigned coordinator and the status allows a change. */
  canChange: boolean;
  /** Set when the status refuses a change, to say why (AC3: return it to Planning). */
  changeRefusal: string | null;
}
