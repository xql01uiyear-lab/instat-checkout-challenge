/**
 * An idempotency key identifies one logical create. It stays the same while we
 * retry a request whose response was lost to the network (same key + same body
 * => the server returns the already-created resource), and it is replaced when
 * the user starts a genuinely new attempt.
 *
 * Usage: keep a key in a ref, reuse it on a network-error retry, and call
 * {@link reset} after success or when the inputs change.
 */
import { useRef } from 'react';

export type IdempotencyKey = {
  /** Current key, creating one on first use. */
  current(): string;
  /** Drop the key so the next `current()` starts a new attempt. */
  reset(): void;
};

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export function useIdempotencyKey(): IdempotencyKey {
  const value = useRef<string | null>(null);
  // Stable handle across renders so it is safe in callback/effect dependencies.
  const handle = useRef<IdempotencyKey>({
    current: () => (value.current ??= newIdempotencyKey()),
    reset: () => {
      value.current = null;
    },
  });
  return handle.current;
}
