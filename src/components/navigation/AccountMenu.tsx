'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ROLE_LABELS, type Role } from '@/domain/identity/roles';
import type { AccountDisplay } from '@/domain/navigation/schema';
import { LogoutButton } from '@/components/auth/LogoutButton';

/**
 * SCRUM-249 AC2 — the account menu: the signed-in name and email, the role
 * being worked as, and Log out. With no name recorded the email is shown once
 * (accountDisplay).
 */
export function AccountMenu({ account, workingRole }: { account: AccountDisplay; workingRole: Role }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Close when clicking anywhere outside the menu.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="account-menu"
        aria-label={`Account menu for ${account.primary}`}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex max-w-[12rem] items-center gap-2 rounded-md border border-[var(--border)] px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-slate-100"
      >
        {/* At phone width only the icon shows, so the button fits beside the
            menu button, ConnectSphere and the bell (AC2 with AC6). */}
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4 4-6 8-6s8 2 8 6" strokeLinecap="round" />
        </svg>
        <span className="hidden truncate sm:inline">{account.primary}</span>
      </button>

      {open && (
        <div
          id="account-menu"
          className="absolute right-0 z-20 mt-2 w-64 rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 shadow-md"
        >
          <p className="truncate text-sm font-semibold">{account.primary}</p>
          {account.secondary && <p className="truncate text-sm text-[var(--text-muted)]">{account.secondary}</p>}
          <p className="mt-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">Current role</p>
          <p className="text-sm">{ROLE_LABELS[workingRole]}</p>
          <div className="mt-3 border-t border-[var(--border)] pt-3">
            <LogoutButton />
          </div>
        </div>
      )}
    </div>
  );
}
