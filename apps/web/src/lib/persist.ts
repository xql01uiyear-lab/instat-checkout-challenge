// Pointer to the order the user is currently paying, so a reload can resume it.
const ORDER_KEY = 'checkout.currentOrderId';

export function rememberOrder(id: string): void {
  try {
    localStorage.setItem(ORDER_KEY, id);
  } catch {
    /* ignore unavailable storage */
  }
}

export function recallOrder(): string | null {
  try {
    return localStorage.getItem(ORDER_KEY);
  } catch {
    return null;
  }
}

export function forgetOrder(): void {
  try {
    localStorage.removeItem(ORDER_KEY);
  } catch {
    /* ignore */
  }
}
