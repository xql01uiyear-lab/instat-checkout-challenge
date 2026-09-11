/**
 * Field validators. One definition per rule, composed per field, mirroring the
 * server contract (email format, phone `+[1-9]…`, min lengths). Form errors are
 * produced here and stay separate from network/API errors.
 */
export type Validator = (value: string) => string | null;

export const required =
  (message = 'Заполните поле'): Validator =>
  (value) =>
    value.trim() ? null : message;

export const minLength =
  (n: number, message = `Минимум ${n} символа`): Validator =>
  (value) =>
    value.trim().length >= n ? null : message;

export const email: Validator = (value) =>
  /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim()) ? null : 'Введите корректный email';

export const phone: Validator = (value) =>
  /^\+[1-9]\d{9,14}$/.test(value.trim()) ? null : 'Телефон в формате +79990000000';

export const compose =
  (...validators: readonly Validator[]): Validator =>
  (value) => {
    for (const validate of validators) {
      const error = validate(value);
      if (error) return error;
    }
    return null;
  };
