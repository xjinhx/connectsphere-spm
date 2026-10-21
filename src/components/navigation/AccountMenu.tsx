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
        onClick={() => setOpen((value) => !value)}
        className="max-w-[12rem] truncate rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium transition-colors hover:bg-slate-100"
      >
        {account.primary}
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
