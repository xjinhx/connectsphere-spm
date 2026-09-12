import Link from 'next/link';
import { describeTimeSlots } from '@/domain/event-request/policy';
import { getEventRequest } from '@/domain/event-request/service';
import { formatSingaporeDate, formatSingaporeDateTime } from '@/domain/shared/dates';

export const dynamic = 'force-dynamic';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-[var(--border)] py-3 last:border-b-0">
      <dt className="text-xs font-medium tracking-wide text-[var(--text-muted)] uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-sm whitespace-pre-wrap">{value}</dd>
    </div>
  );
}

export default async function EventRequestPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const request = await getEventRequest(id);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-semibold">{request.name}</h1>
      {/* AC2: the unique reference the database assigned on save. */}
      <p className="mt-1 font-mono text-sm text-[var(--text-muted)]">{request.reference}</p>

      {/* AC5: every date and time on this page is rendered in Singapore time. */}
      <dl className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4">
        <Row label="Purpose" value={request.purpose ?? 'Not yet provided'} />
        <Row label="Description" value={request.description ?? 'Not yet provided'} />
        <Row
          label="Proposed date"
          value={
            request.proposedDate ? formatSingaporeDate(request.proposedDate) : 'Not yet provided'
          }
        />
        {/* SCRUM-77 AC2: all three slots read as a full-day booking requirement. */}
        <Row label="Time slots" value={describeTimeSlots(request.timeSlots)} />
        <Row label="Created" value={formatSingaporeDateTime(request.createdAt)} />
        <Row label="Last updated" value={formatSingaporeDateTime(request.updatedAt)} />
      </dl>

      <Link
        href="/events/new"
        className="mt-6 inline-block text-sm text-[var(--brand)] hover:underline"
      >
        Create another request
      </Link>
    </main>
  );
}
