import { useCallback, useRef, useState } from 'react';
import type { Validator } from './validation';

/**
 * Minimal controlled-form state shared by the checkout forms: values, per-field
 * errors, and touched flags with one validation rule per field. `validate` can
 * check a subset of fields (e.g. skip address fields for pickup) and returns its
 * result synchronously via a values ref. Values are never cleared by the form
 * itself, so a failed API request keeps user input.
 */
export type Form<K extends string> = {
  readonly values: Readonly<Record<K, string>>;
  readonly errors: Readonly<Partial<Record<K, string>>>;
  readonly touched: Readonly<Partial<Record<K, boolean>>>;
  setField: (key: K) => (value: string) => void;
  blurField: (key: K) => () => void;
  /** Validate the given keys (all by default); returns true when all pass. */
  validate: (keys?: readonly K[]) => boolean;
  setError: (key: K, message: string) => void;
};

export function useForm<K extends string>(
  initial: Record<K, string>,
  validators: Partial<Record<K, Validator>>,
): Form<K> {
  const [values, setValues] = useState<Record<K, string>>(initial);
  const [errors, setErrors] = useState<Partial<Record<K, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<K, boolean>>>({});
  // Mirror of `values` for synchronous reads inside validate()/blur().
  const valuesRef = useRef(values);
  // Validators may be a fresh object each render; ref keeps callbacks stable.
  const validatorsRef = useRef(validators);
  validatorsRef.current = validators;

  const write = useCallback((key: K, value: string) => {
    const next = { ...valuesRef.current, [key]: value };
    valuesRef.current = next;
    setValues(next);
  }, []);

  const setField = useCallback(
    (key: K) => (value: string) => {
      write(key, value);
      // Clear an existing error as the user types; re-validate on blur/submit.
      setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));
    },
    [write],
  );

  const blurField = useCallback(
    (key: K) => () => {
      setTouched((prev) => ({ ...prev, [key]: true }));
      const error = validatorsRef.current[key]?.(valuesRef.current[key]) ?? null;
      setErrors((prev) => ({ ...prev, [key]: error ?? undefined }));
    },
    [],
  );

  const validate = useCallback((keys?: readonly K[]): boolean => {
    const targetKeys = keys ?? (Object.keys(valuesRef.current) as K[]);
    const nextErrors: Partial<Record<K, string>> = {};
    const nextTouched: Partial<Record<K, boolean>> = {};
    let ok = true;
    for (const key of targetKeys) {
      const error = validatorsRef.current[key]?.(valuesRef.current[key]) ?? null;
      nextTouched[key] = true;
      if (error) {
        nextErrors[key] = error;
        ok = false;
      }
    }
    setErrors(nextErrors);
    setTouched((prev) => ({ ...prev, ...nextTouched }));
    return ok;
  }, []);

  const setError = useCallback((key: K, message: string) => {
    setErrors((prev) => ({ ...prev, [key]: message }));
    setTouched((prev) => ({ ...prev, [key]: true }));
  }, []);

  return { values, errors, touched, setField, blurField, validate, setError };
}
