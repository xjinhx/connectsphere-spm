import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ChangeRequestList } from '@/components/change-request/ChangeRequestList';
import type { ChangeRequestSummary } from '@/domain/change-request/service';

/**
 * SCRUM-188 AC1: the coordinator opens a pending change request (from its
 * notification or from the event page, both of which land on the same list)
 * and sees, for each field, the current value beside the requested value,
 * and the organiser's reason. Test case IDs match the SCRUM-188 tab of the
 * Sprint 4 sheet.
 */

const pending: ChangeRequestSummary = {
  id: 'cr-1',
  status: 'pending',
  reason: 'Programme updated',
  createdAt: '2026-11-01T02:00:00.000Z',
  decidedAt: null,
  decisionReason: null,
  fields: [
    { field: 'expectedAttendance', currentValue: 150, proposedValue: 180 },
    { field: 'proposedDate', currentValue: '2026-11-10', proposedValue: '2026-11-15' },
  ],
};

describe('SCRUM-188 AC1: a change request shows current vs proposed for each field, and the reason', () => {
  it('TC-188-01: each changed field reads "<current> → <proposed>", the date as DD/MM/YYYY', () => {
    const html = renderToStaticMarkup(<ChangeRequestList changeRequests={[pending]} />);

    expect(html).toContain('150');
    expect(html).toContain('180');
    expect(html).toContain('10/11/2026');
    expect(html).toContain('15/11/2026');
    expect(html.match(/→/g)?.length).toBe(2);
  });

  it("TC-188-01: the organiser's reason and the Pending status are shown", () => {
    const html = renderToStaticMarkup(<ChangeRequestList changeRequests={[pending]} />);

    expect(html).toContain('Programme updated');
    expect(html).toContain('Pending');
  });

  it('TC-188-04: the accessibility features list reads by name, not by id', () => {
    const names = { accessibilityFeatures: new Map([['f-1', 'Step-free access'], ['f-2', 'Hearing loop']]) };
    const html = renderToStaticMarkup(
      <ChangeRequestList
        valueNames={names}
        changeRequests={[
          {
            ...pending,
            fields: [{ field: 'accessibilityFeatureIds', currentValue: ['f-1'], proposedValue: ['f-1', 'f-2'] }],
          },
        ]}
      />,
    );

    expect(html).toContain('Step-free access');
    expect(html).toContain('Step-free access, Hearing loop');
    expect(html).not.toContain('f-2');
  });

  it('an event with no change requests renders nothing (not a TC; keeps the shared list safe to mount)', () => {
    expect(renderToStaticMarkup(<ChangeRequestList changeRequests={[]} />)).toBe('');
  });
});
