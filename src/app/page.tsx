import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-start justify-center gap-3 px-4">
      <h1 className="text-2xl font-semibold">ConnectSphere Event Services</h1>
      <p className="text-[var(--text-muted)]">
        Event planning and venue booking. More features land here as sprints progress.
      </p>
      <Link
        href="/events/new"
        className="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)]"
      >
        Create an event request
      </Link>
    </main>
  );
}
