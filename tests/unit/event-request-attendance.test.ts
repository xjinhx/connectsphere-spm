import { describe, it, expect } from 'vitest';
import { validateExpectedAttendance, isAttendanceEventLevelOnly } from '../../src/domain/event-request/policy';
import { eventRequestCoreSchema } from '../../src/domain/event-request/schema';

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
    expect(() => validateExpectedAttendance(0)).toThrow('Expected attendance must be greater than 0');
    expect(() => validateExpectedAttendance(-5)).toThrow('Expected attendance must be greater than 0');
  });

  it('rejects a non-integer attendance value', () => {
    expect(() => validateExpectedAttendance(12.5)).toThrow('Expected attendance must be a whole number');
  });

  it('full schema: a complete, valid core event request parses successfully', () => {
    const result = eventRequestCoreSchema.parse({
      name: 'Annual Tech Summit',
      purpose: 'Networking',
      description: 'Yearly gathering',
      proposedDate: '2026-11-15',
      timeSlots: ['PM'],
      expectedAttendance: 80,
    });
    expect(result.expectedAttendance).toBe(80);
  });
});