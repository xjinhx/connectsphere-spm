import { z } from 'zod';

// Same convention as review/schema.ts's own EventRequestIdSchema: each
// domain validates the id shape locally rather than importing another
// domain's copy of the same one-liner.
export const EventRequestIdSchema = z.string().uuid();
