import { type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, useId } from 'react';
import type { ApiError } from '../api/errors';

/**
 * Reusable interface primitives. Field labelling, error association and the
 * disabled/busy behaviour of buttons live here once, so fixing accessibility or
 * loading behaviour is a single edit rather than a sweep across every screen.
 */

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly loading?: boolean;
  readonly variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
};

export function Button({
  loading = false,
  variant = 'primary',
  disabled,
  type = 'button',
  children,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`btn btn--${variant} ${className ?? ''}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="btn__spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

type TextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error?: string | undefined;
  readonly hint?: string;
};

export function TextField({ label, value, onChange, error, hint, id, ...rest }: TextFieldProps) {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;
  return (
    <div className="field">
      <label className="field__label" htmlFor={fieldId}>
        {label}
      </label>
      <input
        id={fieldId}
        className="field__input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
      />
      {error ? (
        <p id={errorId} className="field__error" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A selectable card backed by a native radio input for full keyboard support. */
export function RadioCard({
  name,
  checked,
  onSelect,
  title,
  description,
  disabled,
}: {
  readonly name: string;
  readonly checked: boolean;
  readonly onSelect: () => void;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly disabled?: boolean;
}) {
  return (
    <label className={`radio-card ${checked ? 'radio-card--checked' : ''}`.trim()}>
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onSelect}
        disabled={disabled}
        className="radio-card__input"
      />
      <span className="radio-card__body">
        <span className="radio-card__title">{title}</span>
        {description ? <span className="radio-card__desc">{description}</span> : null}
      </span>
    </label>
  );
}

export function Spinner({ label = 'Загрузка…' }: { readonly label?: string }) {
  return (
    <div className="spinner" role="status">
      <span className="spinner__dot" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

/** Normalized API error → a single presentational treatment with an optional retry. */
export function ErrorNote({
  error,
  onRetry,
}: {
  readonly error: ApiError;
  readonly onRetry?: () => void;
}) {
  return (
    <div className="notice notice--error" role="alert">
      <span>{error.message}</span>
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          Повторить
        </Button>
      ) : null}
    </div>
  );
}
