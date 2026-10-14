/**
 * Domain errors.
 *
 * Services throw these. The API layer (src/lib/api/handler.ts) is the ONLY
 * place that maps them onto HTTP status codes, which keeps every service free
 * of transport concerns and directly unit-testable.
 */

export type DomainErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_TRANSITION'
  | 'CAPACITY_EXCEEDED'
  | 'UNAVAILABLE'
  | 'INTERNAL_ERROR';

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details?: unknown;

  constructor(code: DomainErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
    this.details = details;
    // Next.js strips `message` from errors thrown during Server Component
    // rendering before they reach a client error boundary in production, but
    // it preserves a `digest` set before it generates its own - see
    // node_modules/next/dist/server/app-render/create-error-handler.js
    // ("If the error already has a digest, respect the original digest").
    // src/app/error.tsx reads this to render the right message per code.
    (this as { digest?: string }).digest = `DOMAIN_ERROR:${code}`;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('VALIDATION_ERROR', message, details);
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(message = 'You must sign in to perform this action.') {
    super('UNAUTHENTICATED', message);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'You do not have permission to perform this action.') {
    super('FORBIDDEN', message);
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string) {
    super('NOT_FOUND', entity + ' was not found.');
  }
}

/**
 * Raised when a venue slot is already taken, i.e. Postgres rejected the write
 * through the partial unique index. Q#35 requires a hard block, not a warning.
 */
export class ConflictError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('CONFLICT', message, details);
  }
}

export class InvalidTransitionError extends DomainError {
  constructor(from: string, to: string) {
    super('INVALID_TRANSITION', 'An event cannot move from ' + from + ' to ' + to + '.', {
      from,
      to,
    });
  }
}

export class CapacityExceededError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('CAPACITY_EXCEEDED', message, details);
  }
}

export class UnavailableError extends DomainError {
  constructor(message: string, details?: unknown) {
    super('UNAVAILABLE', message, details);
  }
}

/** Postgres SQLSTATE codes we translate into domain errors. */
export const PG_UNIQUE_VIOLATION = '23505';
export const PG_CHECK_VIOLATION = '23514';
/** An exclusion constraint, e.g. venue_booking_no_overlap (two confirmed bookings overlapping). */
export const PG_EXCLUSION_VIOLATION = '23P01';

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === PG_UNIQUE_VIOLATION
  );
}

export function isExclusionViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === PG_EXCLUSION_VIOLATION
  );
}

export function isCheckViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === PG_CHECK_VIOLATION
  );
}
