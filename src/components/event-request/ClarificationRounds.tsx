import { formatSingaporeDateTime } from '@/domain/shared/dates';
import type { ClarificationRound } from '@/domain/clarification/service';

/**
 * SCRUM-91 AC2/AC3 — the clarification exchange, oldest round first.
 *
 * AC3: "Given my request has been through two clarification rounds, when the
 * coordinator opens it, then both rounds are listed in order." Each round keeps
 * the note it was raised with and the answer it received, so a second round
 * never overwrites the first.
 *
 * AC2: two of the three things AC2 keeps are here — the original note and the
 * response. The amended values are the request's own fields, shown by the page
 * this sits on, rather than copied in here where they could drift from the
 * record they claim to show.
 *
 * Presentational only: it is given the rounds and renders them. Nothing is read
 * or decided here.
 */
export function ClarificationRounds({ rounds }: { rounds: readonly ClarificationRound[] }) {
  if (rounds.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="text-sm font-semibold text-[var(--text-muted)]">
        Clarification history
        {rounds.length > 1 ? ` — ${rounds.length} rounds` : null}
      </h2>

      <ol className="mt-2 space-y-3">
        {rounds.map((round) => (
          <li
            key={round.roundNumber}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
              Round {round.roundNumber}
            </p>

            <p className="mt-2 text-xs font-medium text-[var(--text-muted)]">Coordinator asked</p>
            <p className="mt-0.5 whitespace-pre-wrap text-sm">{round.note}</p>
            <p className="mt-0.5 text-xs text-[var(--text-muted)]">
              {formatSingaporeDateTime(round.requestedAt)}
            </p>

            {round.response ? (
              <>
                <p className="mt-3 text-xs font-medium text-[var(--text-muted)]">
                  Organiser replied
                </p>
                <p className="mt-0.5 whitespace-pre-wrap text-sm">{round.response}</p>
                {round.respondedAt ? (
                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                    {formatSingaporeDateTime(round.respondedAt)}
                  </p>
                ) : null}
              </>
            ) : (
              // An open round: the question has been asked and not yet answered.
              // Said explicitly rather than left blank, so the coordinator can
              // tell "waiting for a reply" from "replied with nothing".
              <p className="mt-3 text-sm italic text-[var(--text-muted)]">
                Waiting for the organiser to reply.
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
