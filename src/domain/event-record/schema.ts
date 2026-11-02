import type { EquipmentRequestStatus } from '@/domain/equipment-request/schema';
import type { EssentialArrangementProgress } from '@/domain/essential-arrangements/policy';
import type { EventRequest } from '@/domain/event-request/service';
import type { EventRequestStatus } from '@/domain/event-request/schema';
import type { EventBookingRequest, VenueBookingStatus } from '@/domain/venue-booking/schema';
import type { EventRecordViewer } from './policy';

/**
 * SCRUM-109 — what the event record page shows.
 *
 * AC2: a section the viewer may not see is left out of the object altogether
 * (the key is absent), never sent empty, so the page cannot render a heading
 * for it. A section the viewer may see but which holds nothing yet is present
 * and empty (an empty list, null), and the page says so.
 */
export interface EventRecord {
  id: string;
  reference: string;
  name: string;
  /** AC1, AC3. */
  status: EventRequestStatus;
  viewers: EventRecordViewer[];
  /** AC1: what the organiser submitted (SCRUM-76 to SCRUM-81). */
  details: EventRequest;
  /** AC1. Null while no coordinator is assigned; contact details only where SCRUM-98 gives them. */
  coordinator?: { name: string | null; email: string | null; contactNumber: string | null } | null;
  /** SCRUM-110's internal notes and client contact. */
  internal?: {
    internalNotes: string | null;
    clientContactName: string | null;
    clientContactEmail: string | null;
    clientContactPhone: string | null;
  };
  /** AC1: the venue bookings (SCRUM-231) and the booking requests behind them (SCRUM-236). */
  venue?: {
    bookings: { venueName: string; date: string; startTime: string; endTime: string; status: VenueBookingStatus }[];
    requests: EventBookingRequest[];
  };
  /** AC1: each requested item and whether it is reserved (SCRUM-160, 173), and the request's status (SCRUM-166). */
  equipment?: {
    status: EquipmentRequestStatus | null;
    lines: { equipmentName: string; quantity: number; reserved: boolean }[];
  };
  /** AC1: whether registration is required (SCRUM-81) and its period and capacity (SCRUM-185 AC5). */
  registration?: {
    required: boolean | null;
    startDate: string | null;
    endDate: string | null;
    capacity: number | null;
  };
  /** AC3: the arrangements marked essential (SCRUM-100), each with whether it is complete. */
  essential?: EssentialArrangementProgress[];
}
