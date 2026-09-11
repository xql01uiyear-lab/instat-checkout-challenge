import { request } from './http';
import type {
  Cart,
  CreateOrder,
  Delivery,
  Order,
  Payment,
  Product,
  Quote,
  Scenario,
  Simulation,
} from '@checkout/contracts';

/** Element type of the cart's item array — reused so it never drifts from the contract. */
export type CartItem = Cart['items'][number];

// Response shapes the contract package does not export as named types.
export type DeliveryMethod = {
  readonly id: 'pickup' | 'courier';
  readonly title: string;
  readonly price: number;
  readonly freeFrom: number | null;
  readonly pickupPoints: ReadonlyArray<{ id: string; title: string; address: string }>;
};
export type PaymentMethodOption = {
  readonly id: 'card' | 'cash_on_delivery';
  readonly title: string;
};
export type CheckoutOptions = {
  readonly cart: Cart;
  readonly deliveryMethods: readonly DeliveryMethod[];
  readonly paymentMethods: readonly PaymentMethodOption[];
};
export type SandboxCard = {
  readonly id: string;
  readonly title: string;
  readonly maskedNumber: string;
  readonly scenario: 'success' | 'decline';
};
export type Sandbox = {
  readonly settlementDelayMs: number;
  readonly cards: readonly SandboxCard[];
};

/**
 * Typed endpoint catalogue. Adding an endpoint means declaring its path, method
 * and types here — the transport, error handling and parsing are inherited from
 * {@link request}. Components call `api.orders.create(...)` and receive parsed,
 * typed data or a normalized thrown error.
 */
export const api = {
  products: {
    list: (signal?: AbortSignal) =>
      request<Product[]>('/api/products', { auth: false, signal }).then((r) => r.data),
  },
  sandbox: {
    get: (signal?: AbortSignal) =>
      request<Sandbox>('/api/sandbox', { auth: false, signal }).then((r) => r.data),
  },
  cart: {
    get: (signal?: AbortSignal) => request<Cart>('/api/cart', { signal }).then((r) => r.data),
    setItem: (productId: string, quantity: number, signal?: AbortSignal) =>
      request<CartItem>(`/api/cart/items/${productId}`, {
        method: 'PUT',
        body: { quantity },
        signal,
      }).then((r) => r.data),
    removeItem: (productId: string, signal?: AbortSignal) =>
      request<void>(`/api/cart/items/${productId}`, { method: 'DELETE', signal }).then(() => {}),
  },
  checkout: {
    options: (signal?: AbortSignal) =>
      request<CheckoutOptions>('/api/checkout/options', { signal }).then((r) => r.data),
  },
  quotes: {
    create: (body: { cartVersion: number; delivery: Delivery }, signal?: AbortSignal) =>
      request<Quote>('/api/quotes', { method: 'POST', body, signal }).then((r) => r.data),
  },
  orders: {
    create: (body: CreateOrder, idempotencyKey: string, signal?: AbortSignal) =>
      request<Order>('/api/orders', { method: 'POST', body, idempotencyKey, signal }).then(
        (r) => r.data,
      ),
    get: (orderId: string, signal?: AbortSignal) =>
      request<Order>(`/api/orders/${orderId}`, { signal }).then((r) => r.data),
    list: (signal?: AbortSignal) => request<Order[]>('/api/orders', { signal }).then((r) => r.data),
  },
  payments: {
    create: (orderId: string, idempotencyKey: string, signal?: AbortSignal) =>
      request<Payment>(`/api/orders/${orderId}/payments`, {
        method: 'POST',
        body: {},
        idempotencyKey,
        signal,
      }).then((r) => r.data),
    get: (paymentId: string, signal?: AbortSignal) =>
      request<Payment>(`/api/payments/${paymentId}`, { signal }).then((r) => r.data),
    list: (orderId: string, signal?: AbortSignal) =>
      request<Payment[]>(`/api/orders/${orderId}/payments`, { signal }).then((r) => r.data),
    /** Returns the full response so the caller can read the `Retry-After` header. */
    simulate: (paymentId: string, scenario: Scenario, signal?: AbortSignal) =>
      request<Simulation>(`/api/payments/${paymentId}/simulations`, {
        method: 'POST',
        body: { scenario },
        signal,
      }),
  },
} as const;
