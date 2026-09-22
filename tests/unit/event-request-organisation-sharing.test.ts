import { describe, it, expect } from 'vitest';
import { canEditRequest, canViewRequest } from '@/domain/event-request/policy';

/**
 * SCRUM-204 AC3 — two Event Organisers in the same client organisation see
 * that organisation's events under a view-only rule: the owner may open and
 * edit their own request at any status; a colleague may open a shared,
 * non-draft request but never edit it. A colleague's still-private draft is
 * neither shown nor openable at all (SCRUM-83 AC3, unchanged by this story).
 */
describe('SCRUM-204 AC3 — view-only sharing within a client organisation', () => {
  const owner = 'organiser-1';
  const colleague = 'organiser-2';
  const orgA = 'org-a';
  const orgB = 'org-b';

  describe('canViewRequest', () => {
    it('lets the owner open their own request at any status, including draft', () => {
      const request = { organiserId: owner, clientOrganisationId: orgA, status: 'draft' as const };
      expect(canViewRequest(request, { userId: owner, clientOrganisationId: orgA })).toBe(true);
    });

    it('lets a colleague in the same organisation open a submitted request', () => {
      const request = { organiserId: owner, clientOrganisationId: orgA, status: 'submitted' as const };
      expect(canViewRequest(request, { userId: colleague, clientOrganisationId: orgA })).toBe(true);
    });

    it('denies a colleague in the same organisation the owner\'s still-private draft', () => {
      const request = { organiserId: owner, clientOrganisationId: orgA, status: 'draft' as const };
      expect(canViewRequest(request, { userId: colleague, clientOrganisationId: orgA })).toBe(false);
    });

    it('denies an organiser in a different organisation, even once submitted', () => {
      const request = { organiserId: owner, clientOrganisationId: orgA, status: 'submitted' as const };
      expect(canViewRequest(request, { userId: colleague, clientOrganisationId: orgB })).toBe(false);
    });

    it('denies an unlinked organiser (no client organisation) another account\'s request', () => {
      const request = { organiserId: owner, clientOrganisationId: orgA, status: 'submitted' as const };
      expect(canViewRequest(request, { userId: colleague, clientOrganisationId: null })).toBe(false);
    });
  });

  describe('canEditRequest', () => {
    it('lets the owner edit their own editable request', () => {
      expect(canEditRequest({ organiserId: owner, status: 'draft' }, owner)).toBe(true);
    });

    it('denies a colleague editing a shared, still-editable request', () => {
      expect(canEditRequest({ organiserId: owner, status: 'clarification_requested' }, colleague)).toBe(false);
    });

    it('denies the owner editing their own request once it is no longer editable', () => {
      expect(canEditRequest({ organiserId: owner, status: 'submitted' }, owner)).toBe(false);
    });
  });
});
