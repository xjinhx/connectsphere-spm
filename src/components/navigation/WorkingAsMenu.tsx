'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ROLE_LABELS, type Role } from '@/domain/identity/roles';

/**
 * SCRUM-249 AC5 — "Working as": shown only to an account holding more than one
 * role (AppHeader checks). Choosing a role saves it (POST /api/me/working-as)
 * and opens that role's landing page; the header then shows that role's nav.
 */
export function WorkingAsMenu({ roles, workingRole }: { roles: readonly Role[]; workingRole: Role }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function choose(role: Role) {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/me/working-as', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      const body = (await response.json()) as { landingPath?: string; message?: string };
      if (!response.ok || !body.landingPath) {
        setError(body.message ?? 'Could not switch role.');
        return;
      }
      router.push(body.landingPath);
      router.refresh();
    } catch {
      setError('Could not switch role.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="hidden text-[var(--text-muted)] sm:inline">Working as</span>
      <select
        aria-label="Working as"
        value={workingRole}
        disabled={saving}
        onChange={(event) => choose(event.target.value as Role)}
        className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
      >
        {roles.map((role) => (
          <option key={role} value={role}>
            {ROLE_LABELS[role]}
          </option>
        ))}
      </select>
      {error && (
        <span role="alert" className="text-xs text-[var(--danger)]">
          {error}
        </span>
      )}
    </label>
  );
}
