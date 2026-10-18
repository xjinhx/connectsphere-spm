import {
  EQUIPMENT_REQUEST_STATUS_LABELS,
  type EquipmentRequestStatus,
} from '@/domain/equipment-request/schema';

/**
 * SCRUM-164 — an equipment request's status (SCRUM-166's four). One place for
 * the colour; the label comes from the schema.
 */
const STATUS_CLASS: Record<EquipmentRequestStatus, string> = {
  under_review: 'bg-blue-50 text-[var(--brand)]',
  partially_fulfilled: 'bg-amber-50 text-amber-700',
  fulfilled: 'bg-green-50 text-green-700',
  unable_to_fulfil: 'bg-red-50 text-[var(--danger)]',
};

export function EquipmentRequestStatusBadge({ status }: { status: EquipmentRequestStatus }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CLASS[status]}`}>
      {EQUIPMENT_REQUEST_STATUS_LABELS[status]}
    </span>
  );
}
