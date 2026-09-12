import { forwardRef, InputHTMLAttributes } from 'react';
import { FormField } from './FormField';

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label?: string;
  error?: string;
};

/** Always renders as a masked input - the PRD requires the password field to be masked. */
export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(
  ({ label = 'Password', ...props }, ref) => (
    <FormField ref={ref} type="password" label={label} autoComplete="current-password" {...props} />
  ),
);

PasswordField.displayName = 'PasswordField';
