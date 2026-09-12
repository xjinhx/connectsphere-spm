'use client';

import { FormEvent, useState } from 'react';
import { INVALID_CREDENTIALS_MESSAGE, loginSchema, type LoginInput } from '@/domain/identity/login';
import { Button } from '@/components/ui/Button';
import { FormField } from './FormField';
import { PasswordField } from './PasswordField';

type FieldErrors = Partial<Record<keyof LoginInput, string>>;

export type LoginResult = { ok: true } | { ok: false; message: string };

type LoginFormProps = {
  /** Left as a prop so this component carries no dependency on how auth is wired. */
  onSubmit: (input: LoginInput) => Promise<LoginResult>;
};

export function LoginForm({ onSubmit }: LoginFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const errors: FieldErrors = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof LoginInput;
        errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setIsSubmitting(true);
    try {
      const result = await onSubmit(parsed.data);
      if (!result.ok) setFormError(result.message);
    } catch {
      setFormError(INVALID_CREDENTIALS_MESSAGE);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex w-full max-w-sm flex-col gap-4">
      {formError && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-[var(--danger)]">
          {formError}
        </p>
      )}
      <FormField
        id="email"
        label="Email"
        type="email"
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={fieldErrors.email}
      />
      <PasswordField
        id="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={fieldErrors.password}
      />
      <Button type="submit" isLoading={isSubmitting}>
        Log in
      </Button>
    </form>
  );
}
