import { describe, expect, it } from 'vitest';
import { DomainError, NotFoundError } from '@/domain/shared/errors';

describe('DomainError', () => {
  it('carries a code and message', () => {
    const error = new DomainError('VALIDATION_ERROR', 'bad input');
    expect(error.code).toBe('VALIDATION_ERROR');
    expect(error.message).toBe('bad input');
  });

  it('NotFoundError builds a message from the entity name', () => {
    const error = new NotFoundError('Event');
    expect(error.code).toBe('NOT_FOUND');
    expect(error.message).toBe('Event was not found.');
  });

  it('sets a digest encoding the code, so src/app/error.tsx can still tell errors apart after Next strips the message in production', () => {
    const error = new DomainError('FORBIDDEN', 'nope');
    expect((error as { digest?: string }).digest).toBe('DOMAIN_ERROR:FORBIDDEN');
  });
});
