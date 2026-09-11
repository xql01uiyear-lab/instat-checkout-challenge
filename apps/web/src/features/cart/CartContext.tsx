import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Cart } from '@checkout/contracts';
import { api, type CartItem } from '../../api/endpoints';
import { asApiError, type ApiError } from '../../api/errors';
import type { Result } from '../../lib/useAsync';

type CartContextValue = {
  readonly cart: Cart | null;
  readonly status: 'loading' | 'success' | 'error';
  readonly error: ApiError | null;
  /** productId -> item, built once per cart for O(1) lookup instead of find(). */
  readonly itemsById: ReadonlyMap<string, CartItem>;
  /** productIds currently being mutated (UI guard against double submit). */
  readonly pending: ReadonlySet<string>;
  reload: () => void;
  setQuantity: (productId: string, quantity: number) => Promise<Result<void>>;
  remove: (productId: string) => Promise<Result<void>>;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { readonly children: ReactNode }) {
  const [cart, setCart] = useState<Cart | null>(null);
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [error, setError] = useState<ApiError | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());

  const load = useCallback(async (signal?: AbortSignal) => {
    setStatus((prev) => (prev === 'success' ? 'success' : 'loading'));
    setError(null);
    try {
      const fresh = await api.cart.get(signal);
      setCart(fresh);
      setStatus('success');
    } catch (caught) {
      if (signal?.aborted) return;
      setError(asApiError(caught));
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const itemsById = useMemo(() => {
    const map = new Map<string, CartItem>();
    if (cart) for (const item of cart.items) map.set(item.productId, item);
    return map;
  }, [cart]);

  const mutate = useCallback(
    async (productId: string, action: () => Promise<unknown>): Promise<Result<void>> => {
      setPending((prev) => new Set(prev).add(productId));
      try {
        await action();
        // Server owns cart totals and version: re-read after every change.
        const fresh = await api.cart.get();
        setCart(fresh);
        setStatus('success');
        return { ok: true, data: undefined };
      } catch (caught) {
        return { ok: false, error: asApiError(caught) };
      } finally {
        setPending((prev) => {
          const next = new Set(prev);
          next.delete(productId);
          return next;
        });
      }
    },
    [],
  );

  const setQuantity = useCallback(
    (productId: string, quantity: number) =>
      mutate(productId, () => api.cart.setItem(productId, quantity)),
    [mutate],
  );
  const remove = useCallback(
    (productId: string) => mutate(productId, () => api.cart.removeItem(productId)),
    [mutate],
  );

  const value = useMemo<CartContextValue>(
    () => ({
      cart,
      status,
      error,
      itemsById,
      pending,
      reload: () => void load(),
      setQuantity,
      remove,
    }),
    [cart, status, error, itemsById, pending, load, setQuantity, remove],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const value = useContext(CartContext);
  if (!value) throw new Error('useCart must be used within CartProvider');
  return value;
}
