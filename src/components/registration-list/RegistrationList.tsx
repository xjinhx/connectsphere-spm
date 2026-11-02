import { REGISTRATION_STATUS_LABELS } from '@/domain/event-registration/schema';
import { registrationDate } from '@/domain/registration-list/policy';
import type { RegistrationListView } from '@/domain/registration-list/schema';

/**
 * SCRUM-185 AC1-AC3 — the event's registrations, with the number registered,
 * the capacity and the places remaining. AC2: the responsible organiser gets
 * Export; AC3: anyone else who can view gets none (and the API refuses them).
 *
 * A server component: nothing here changes without a reload.
 */
export function RegistrationList({ view }: { view: RegistrationListView }) {
  const counts: { label: string; value: string; testId: string }[] = [
    { label: 'Registered', value: String(view.registered), testId: 'count-registered' },
    { label: 'Capacity', value: view.capacity === null ? 'Not set' : String(view.capacity), testId: 'count-capacity' },
    {
      label: 'Places remaining',
      value: view.placesRemaining === null ? '–' : String(view.placesRemaining),
      testId: 'count-remaining',
    },
  ];

  return (
    <section className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Registration list</h2>
        {view.canExport ? (
          <a
            href={`/api/event-requests/${view.eventRequestId}/registration-list/export`}
            download
            className="rounded-md border border-[var(--border)] bg-white px-3 py-1.5 text-sm font-medium hover:bg-slate-50"
          >
            Export
          </a>
        ) : null}
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-3">
        {counts.map((count) => (
          <div key={count.label} className="rounded-md border border-[var(--border)] p-3">
            <dt className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">{count.label}</dt>
            <dd className="mt-1 text-lg font-semibold" data-testid={count.testId}>
              {count.value}
            </dd>
          </div>
        ))}
      </dl>

      {view.registrations.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--text-muted)]">No one has registered for this event yet.</p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs tracking-wide text-[var(--text-muted)] uppercase">
              <tr>
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 pr-3 font-medium">Email</th>
                <th className="py-2 pr-3 font-medium">Contact number</th>
                <th className="py-2 pr-3 font-medium">Registration date</th>
                <th className="py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {view.registrations.map((entry) => (
                <tr key={entry.id} className="border-t border-[var(--border)]">
                  <td className="py-2 pr-3">{entry.fullName}</td>
                  <td className="py-2 pr-3 break-all">{entry.email}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{entry.contactNumber}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">{registrationDate(entry.registeredAt)}</td>
                  <td className="py-2">{REGISTRATION_STATUS_LABELS[entry.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
