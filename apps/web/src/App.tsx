import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { ensureSession } from './api/http';
import { asApiError, type ApiError } from './api/errors';
import { ErrorNote, Spinner } from './ui/controls';
import { CartProvider } from './features/cart/CartContext';
import { HomePage } from './features/catalog/HomePage';
import { CheckoutPage } from './features/checkout/CheckoutPage';
import { OrderPage } from './features/order/OrderPage';

/** Boots a guest session before anything talks to the API. */
export function App() {
  const [state, setState] = useState<{ status: 'loading' | 'ready' | 'error'; error?: ApiError }>({
    status: 'loading',
  });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    ensureSession().then(
      () => active && setState({ status: 'ready' }),
      (error) => active && setState({ status: 'error', error: asApiError(error) }),
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = () => {
    setState({ status: 'loading' });
    setAttempt((n) => n + 1);
  };

  if (state.status === 'loading') {
    return (
      <main className="page page--center">
        <Spinner label="Подключаемся к магазину…" />
      </main>
    );
  }
  if (state.status === 'error') {
    return (
      <main className="page page--center">
        <ErrorNote error={state.error!} onRetry={retry} />
      </main>
    );
  }

  return (
    <CartProvider>
      <div className="app">
        <header className="app__header">
          <Link to="/" className="app__brand">
            Магазин «Пример»
          </Link>
          <Link to="/" className="app__nav-link">
            Каталог
          </Link>
        </header>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/order/:orderId" element={<OrderPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </CartProvider>
  );
}
