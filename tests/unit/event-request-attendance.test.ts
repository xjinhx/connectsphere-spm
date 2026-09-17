import { describe, it, expect } from 'vitest';
import { validateExpectedAttendance, isAttendanceEventLevelOnly } from '../../src/domain/event-request/policy';
import { eventRequestCoreSchema, eventRequestSaveSchema } from '../../src/domain/event-request/schema';

describe('SCRUM-78 — State expected attendance', () => {
  // US-5.1-TC01 (attendance slice of the happy-path create test)
  it('accepts a valid positive whole-number attendance value', () => {
    expect(validateExpectedAttendance(80)).toBe(80);
  });

  // US-5.1-TC04 — attendance held once, at event level, not duplicated
  it('treats attendance as a single event-level field, not duplicated in venue requirements', () => {
    const eventRequest = {
      name: 'Annual Tech Summit',
      expectedAttendance: 80,
      venueRequirements: { capacity: 100 }, // no separate attendance field here
    };
    expect(isAttendanceEventLevelOnly(eventRequest)).toBe(true);
  });

  it('flags it if a duplicate attendance field appears inside venue requirements', () => {
    const eventRequest = {
      name: 'Annual Tech Summit',
      expectedAttendance: 80,
      venueRequirements: { capacity: 100, expectedAttendance: 80 }, // duplicated — should fail
    };
    expect(isAttendanceEventLevelOnly(eventRequest)).toBe(false);
  });

  // Negative case, following the AC5 missing-mandatory-field pattern, applied to attendance
  it('rejects a missing attendance value', () => {
    expect(() => validateExpectedAttendance(undefined)).toThrow('Expected attendance is required');
  });

  it('rejects a zero or negative attendance value', () => {
    expect(() => validateExpectedAttendance(0)).toThrow('Expected attendance must be a positive whole number');
    expect(() => validateExpectedAttendance(-5)).toThrow('Expected attendance must be a positive whole number');
  });

  it('rejects a non-integer attendance value', () => {
    expect(() => validateExpectedAttendance(12.5)).toThrow('Expected attendance must be a positive whole number');
  });

  it('rejects a non-numeric attendance value, matching the AC2 message', () => {
    expect(() => validateExpectedAttendance('abc')).toThrow('Expected attendance must be a positive whole number');
  });

  it('full schema: a complete, valid core event request parses successfully', () => {
    const result = eventRequestCoreSchema.parse({
      name: 'Annual Tech Summit',
      purpose: 'Networking',
      description: 'Yearly gathering',
      proposedDate: '2026-11-15',
      timeSlots: ['pm'],
      expectedAttendance: 80,
    });
    expect(result.expectedAttendance).toBe(80);
  });

  // Regression test: expectedAttendance was silently dropped by the
  // eventRequestSaveSchema (the "Save request" / create path) even though
  // it was captured correctly in EventRequestForm.tsx and validated
  // correctly by eventRequestCoreSchema. Found via manual testing when a
  // saved request's expectedAttendance came back null despite the form
  // sending 200 in the request payload.
  it('is accepted and kept by the save schema, not just the core schema', () => {
    const result = eventRequestSaveSchema.parse({
      name: 'Annual Tech Summit',
      purpose: 'Networking',
      description: 'Yearly gathering',
      proposedDate: '2026-11-15',
      timeSlots: ['pm'],
      expectedAttendance: 200,
    });
    expect(result.expectedAttendance).toBe(200);
  });

  it('is still optional to save, matching AC3 (mandatory only at submission)', () => {
    const result = eventRequestSaveSchema.safeParse({
      name: 'Annual Tech Summit',
      purpose: 'Networking',
      description: 'Yearly gathering',
      proposedDate: '2026-11-15',
      timeSlots: ['pm'],
    });
    expect(result.success).toBe(true);
  });

  // Added after review: eventRequestSaveSchema now uses optionalFromBlank,
  // matching the draft schema's tolerance for an explicit null, not just an
  // omitted value.
  it('treats an explicit null the same as omitted — still optional to save', () => {
    const result = eventRequestSaveSchema.safeParse({
      name: 'Annual Tech Summit',
      purpose: 'Networking',
      description: 'Yearly gathering',
      proposedDate: '2026-11-15',
      timeSlots: ['pm'],
      expectedAttendance: null,
    });
    expect(result.success).toBe(true);
  });
});