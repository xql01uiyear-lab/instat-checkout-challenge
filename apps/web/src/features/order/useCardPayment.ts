import { useCallback, useEffect, useRef, useState } from 'react';
import type { Payment, Scenario } from '@checkout/contracts';
import { api } from '../../api/endpoints';
import { asApiError, type ApiError } from '../../api/errors';
import { useIdempotencyKey } from '../../lib/idempotency';
import { poll, retryAfterMs } from '../../lib/poll';

/**
 * Card payment lifecycle for one order: create an attempt (idempotent), run a
 * simulation, poll it to a terminal state, resume an in-flight attempt after a
 * reload, and retry after a decline/cancel with a fresh key.
 *
 * Race protection: every poll is tied to an AbortController stored in a ref. A
 * new attempt, an unmount or a page change aborts the previous poll, and results
 * are applied only when the controller is still current — so a late response can
 * never overwrite newer state.
 */
export type PaymentPhase =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly payment: Payment }
  | { readonly status: 'processing'; readonly payment: Payment }
  | { readonly status: 'succeeded'; readonly payment: Payment }
  | { readonly status: 'failed'; readonly payment: Payment }
  | { readonly status: 'cancelled'; readonly payment: Payment }
  | { readonly status: 'error'; readonly error: ApiError; readonly payment: Payment | null };

const POLL_FALLBACK_MS = 700;
const isTerminal = (p: Payment) =>
  p.status === 'succeeded' || p.status === 'failed' || p.status === 'cancelled';

function terminalPhase(payment: Payment): PaymentPhase {
  switch (payment.status) {
    case 'succeeded':
      return { status: 'succeeded', payment };
    case 'failed':
      return { status: 'failed', payment };
    case 'cancelled':
      return { status: 'cancelled', payment };
    default:
      return { status: 'ready', payment };
  }
}

export function useCardPayment(orderId: string, onSucceeded: () => void) {
  const [phase, setPhase] = useState<PaymentPhase>({ status: 'loading' });
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const attemptKey = useIdempotencyKey();
  const pollAbort = useRef<AbortController | null>(null);
  const creating = useRef(false);
  const onSucceededRef = useRef(onSucceeded);
  onSucceededRef.current = onSucceeded;

  const settle = useCallback((payment: Payment) => {
    setPhase(terminalPhase(payment));
    if (payment.status === 'succeeded') onSucceededRef.current();
  }, []);

  const startPoll = useCallback(
    (payment: Payment, intervalMs = POLL_FALLBACK_MS) => {
      pollAbort.current?.abort();
      const controller = new AbortController();
      pollAbort.current = controller;
      setPhase({ status: 'processing', payment });
      poll({
        fetchOnce: (signal) => api.payments.get(payment.id, signal),
        isDone: isTerminal,
        intervalMs,
        signal: controller.signal,
      }).then(
        (final) => {
          if (!controller.signal.aborted) settle(final);
        },
        (error) => {
          if (!controller.signal.aborted) {
            setPhase({ status: 'error', error: asApiError(error), payment });
          }
        },
      );
    },
    [settle],
  );

  /** Create a brand-new attempt. Keeps the key on a network error so a lost
   * response can be retried idempotently; a genuine new attempt gets a new key. */
  const createAttempt = useCallback(async () => {
    if (creating.current) return;
    creating.current = true;
    setPhase({ status: 'loading' });
    try {
      const payment = await api.payments.create(orderId, attemptKey.current());
      attemptKey.reset();
      if (isTerminal(payment)) settle(payment);
      else if (payment.status === 'processing') startPoll(payment);
      else setPhase({ status: 'ready', payment });
    } catch (caught) {
      const error = asApiError(caught);
      if (!error.isNetwork) attemptKey.reset();
      if (error.code === 'ORDER_ALREADY_PAID') {
        onSucceededRef.current();
      } else if (error.code === 'PAYMENT_IN_PROGRESS') {
        await resume();
      } else {
        setPhase({ status: 'error', error, payment: null });
      }
    } finally {
      creating.current = false;
    }
    // resume is stable (defined below with useCallback); safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, attemptKey, settle, startPoll]);

  /** Adopt the latest server-side attempt (used on mount and PAYMENT_IN_PROGRESS). */
  const resume = useCallback(
    async (signal?: AbortSignal) => {
      const payments = await api.payments.list(orderId, signal);
      if (signal?.aborted) return;
      const latest = payments[0];
      if (!latest) {
        await createAttempt();
        return;
      }
      if (latest.status === 'processing') startPoll(latest);
      else if (latest.status === 'pending') setPhase({ status: 'ready', payment: latest });
      else settle(latest);
    },
    [orderId, startPoll, settle, createAttempt],
  );

  useEffect(() => {
    const controller = new AbortController();
    resume(controller.signal).catch((error) => {
      if (!controller.signal.aborted)
        setPhase({ status: 'error', error: asApiError(error), payment: null });
    });
    return () => {
      controller.abort();
      pollAbort.current?.abort();
    };
  }, [resume]);

  const pay = useCallback(
    async (scenario: Scenario) => {
      const current = phaseRef.current;
      if (current.status !== 'ready') return;
      const { payment } = current;
      setPhase({ status: 'processing', payment });
      try {
        const { data: simulation, res } = await api.payments.simulate(payment.id, scenario);
        if (simulation.status === 'processing') {
          startPoll(payment, retryAfterMs(res, POLL_FALLBACK_MS));
        } else {
          // Zero-delay sandbox: the simulation already finished. Read the payment.
          const fresh = await api.payments.get(payment.id);
          settle(fresh);
        }
      } catch (caught) {
        setPhase({ status: 'error', error: asApiError(caught), payment });
      }
    },
    [startPoll, settle],
  );

  const retry = useCallback(() => {
    void createAttempt();
  }, [createAttempt]);

  return { phase, pay, retry };
}
