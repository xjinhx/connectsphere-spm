import { NextResponse } from 'next/server';
import { DomainError } from '@/domain/shared/errors';

const STATUS_BY_CODE: Record<string, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVALID_TRANSITION: 409,
  CAPACITY_EXCEEDED: 409,
  UNAVAILABLE: 409,
  INTERNAL_ERROR: 500,
};

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof DomainError) {
    return NextResponse.json(
      { error: error.code, message: error.message, details: error.details },
      { status: STATUS_BY_CODE[error.code] ?? 500 }
    );
  }
  console.error('Unhandled API error:', error);
  return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Something went wrong.' }, { status: 500 });
}