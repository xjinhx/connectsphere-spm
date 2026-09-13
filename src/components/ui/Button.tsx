import { ButtonHTMLAttributes } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  isLoading?: boolean;
};

export function Button({ isLoading = false, disabled, children, className = '', ...props }: ButtonProps) {
  return (
    <button
      disabled={disabled || isLoading}
      className={`w-full rounded-md bg-[var(--brand)] px-4 py-2 font-medium text-white transition-colors hover:bg-[var(--brand-dark)] disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
      {...props}
    >
      {isLoading ? 'Loading…' : children}
    </button>
  );
}
