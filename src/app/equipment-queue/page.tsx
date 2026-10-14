import Link from 'next/link';

export default function TechSupportEquipmentQueuePage() {
  return (
    <main className="flex min-h-screen flex-col gap-2 p-8">
      <h1 className="text-2xl font-semibold">Equipment Requests</h1>
      <p className="text-[var(--text-muted)]">Technical Support Staff landing page. Equipment request queue lands here.</p>
      {/* SCRUM-240: the catalogue Technical Support Staff maintain. */}
      <Link href="/equipment" className="text-[var(--brand)] underline">
        Equipment catalogue
      </Link>
    </main>
  );
}
