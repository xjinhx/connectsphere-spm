import { forwardRef, InputHTMLAttributes } from 'react';

type FormFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
};

export const FormField = forwardRef<HTMLInputElement, FormFieldProps>(
  ({ label, error, id, className = '', ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1">
        <label htmlFor={id} className="text-sm font-medium text-[var(--text)]">
          {label}
        </label>
        <input
          ref={ref}
          id={id}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          className={`rounded-md border bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--brand)] ${
            error ? 'border-[var(--danger)]' : 'border-[var(--border)]'
          } ${className}`}
          {...props}
        />
        {error && (
          <p id={`${id}-error`} className="text-sm text-[var(--danger)]">
            {error}
          </p>
        )}
      </div>
    );
  },
);

FormField.displayName = 'FormField';
