'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  EQUIPMENT_CATEGORY_LABELS,
  OPERATIONAL_STATUS_LABELS,
  DEFAULT_OPERATIONAL_STATUS,
  type EquipmentCategory,
} from '@/domain/equipment/schema';
import { quantityToSend } from './quantityInput';
import { fieldErrorsFrom, type FieldErrors } from './fieldErrors';

/**
 * SCRUM-240 AC1: Technical Support Staff add an equipment item with a name,
 * category, quantity and current location, and it is saved and listed in the
 * catalogue.
 *
 * Every one of the four is required, and the server answers with one message
 * per failing field, so leaving three boxes empty identifies all three rather
 * than only the first (TC-240-02).
 *
 * There is no operational status box: AC1 names four fields and no status, so
 * a new item starts Available (TC-240-03, interim rule to confirm at standup).
 * AC2's four statuses are set from the catalogue row afterwards.
 *
 * The quantity is type="text" with a numeric hint rather than type="number",
 * for the same reason as the venue form's capacity: a number input makes it
 * impossible to type "ten", which would leave TC-240-11 unexercisable by hand.
 * Validation is the server's job.
 */

const CATEGORIES = Object.entries(EQUIPMENT_CATEGORY_LABELS) as [EquipmentCategory, string][];

function FieldError({ messages }: { messages: string[] | undefined }) {
  if (!messages || messages.length === 0) return null;
  return (
    <p role="alert" className="mt-1 text-sm text-[var(--danger)]">
      {messages.join(' ')}
    </p>
  );
}

export default function AddEquipmentForm() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [quantity, setQuantity] = useState('');
  const [currentLocation, setCurrentLocation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [saved, setSaved] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});
    setSaved(null);
    try {
      const response = await fetch('/api/equipment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          // An unchosen category is sent as nothing, so the server answers
          // "Choose a category." rather than refusing an empty string.
          category: category === '' ? undefined : category,
          quantity: quantityToSend(quantity),
          currentLocation,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { message?: string; details?: unknown }
        | null;
      if (!response.ok) {
        setFieldErrors(fieldErrorsFrom(payload?.details));
        throw new Error(payload?.message ?? 'The equipment item could not be saved.');
      }
      setName('');
      setCategory('');
      setQuantity('');
      setCurrentLocation('');
      setSaved(
        `Item saved and listed as ${OPERATIONAL_STATUS_LABELS[DEFAULT_OPERATIONAL_STATUS]}.`,
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The equipment item could not be saved.');
    } finally {
      setSubmitting(false);
    }
  }

  const fieldClass =
    'mt-1 block w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm';

  return (
    <form onSubmit={onSubmit} className="space-y-3 rounded border border-[var(--border)] bg-[var(--surface)] p-4">
      <h2 className="text-sm font-medium">Add an equipment item</h2>

      <label className="block text-sm" htmlFor="equipment-name">
        Name
        <input
          id="equipment-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={fieldClass}
          aria-invalid={Boolean(fieldErrors.name?.length)}
        />
        <FieldError messages={fieldErrors.name} />
      </label>

      <label className="block text-sm" htmlFor="equipment-category">
        Category
        <select
          id="equipment-category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          className={fieldClass}
          aria-invalid={Boolean(fieldErrors.category?.length)}
        >
          <option value="">Choose a category</option>
          {CATEGORIES.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <FieldError messages={fieldErrors.category} />
      </label>

      <label className="block text-sm" htmlFor="equipment-quantity">
        Quantity
        <input
          id="equipment-quantity"
          type="text"
          inputMode="numeric"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
          className={fieldClass}
          aria-invalid={Boolean(fieldErrors.quantity?.length)}
        />
        <FieldError messages={fieldErrors.quantity} />
      </label>

      <label className="block text-sm" htmlFor="equipment-location">
        Current location
        <input
          id="equipment-location"
          value={currentLocation}
          onChange={(event) => setCurrentLocation(event.target.value)}
          className={fieldClass}
          aria-invalid={Boolean(fieldErrors.currentLocation?.length)}
        />
        <FieldError messages={fieldErrors.currentLocation} />
      </label>

      {error ? (
        <p role="alert" className="text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-sm text-[var(--success)]">
          {saved}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-[var(--brand)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--brand-dark)] disabled:opacity-60"
      >
        {submitting ? 'Saving...' : 'Add item'}
      </button>
    </form>
  );
}
