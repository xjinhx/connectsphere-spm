import { z } from 'zod';

/**
 * Shown for both "no such account" and "wrong password" so the login form
 * never reveals which field was incorrect (PRD requirement).
 */
export const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password.';

export const loginSchema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

export type LoginInput = z.infer<typeof loginSchema>;
