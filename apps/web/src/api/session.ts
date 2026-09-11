/**
 * Session token storage. Survives reloads via localStorage so the cart and any
 * in-flight order are recoverable. Kept separate from the transport so the token
 * is the single source of identity the HTTP layer reads on every request.
 */
const TOKEN_KEY = 'checkout.token';

let token: string | null = readInitial();

function readInitial(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return token;
}

export function setToken(next: string): void {
  token = next;
  try {
    localStorage.setItem(TOKEN_KEY, next);
  } catch {
    /* storage may be unavailable (private mode); memory token still works */
  }
}

export function clearToken(): void {
  token = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}
