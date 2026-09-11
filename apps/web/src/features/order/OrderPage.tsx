import { useEffect } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import type { Order } from '@checkout/contracts';
import { api } from '../../api/endpoints';
import { useAsyncData } from '../../lib/useAsync';
import { formatMoney } from '../../lib/money';
import { forgetOrder } from '../../lib/persist';
import { ErrorNote, Spinner } from '../../ui/controls';
import { describeDelivery } from '../checkout/delivery';
import { CardPayment } from './CardPayment';

export function OrderPage() {
  const { orderId } = useParams();
  if (!orderId) return <Navigate to="/" replace />;
  // key resets all payment state when navigating between orders.
  return <OrderView key={orderId} orderId={orderId} />;
}

function OrderView({ orderId }: { readonly orderId: string }) {
  const { state, reload } = useAsyncData((signal) => api.orders.get(orderId, signal), [orderId]);

  if (state.status === 'loading') {
    return (
      <main className="page">
        <Spinner label="Загружаем заказ…" />
      </main>
    );
  }
  if (state.status === 'error') {
    return (
      <main className="page page--center">
        <ErrorNote error={state.error} onRetry={reload} />
        <Link className="btn btn--secondary" to="/">
          В каталог
        </Link>
      </main>
    );
  }

  if (state.status !== 'success') return null;
  const order = state.data;
  const cash = order.paymentMethod === 'cash_on_delivery';
  // Success is confirmed by the server order status, not by a payment POST.
  const cardPaid = order.status === 'paid' && order.paymentStatus === 'succeeded';

  if (cash || cardPaid) {
    return <OrderSuccess order={order} mode={cash ? 'cash' : 'paid'} />;
  }

  return (
    <main className="page order">
      <div className="order__main">
        <h1 className="page__title">Оплата заказа {order.number}</h1>
        <CardPayment orderId={orderId} total={order.total} onPaid={reload} />
      </div>
      <OrderSummary order={order} />
    </main>
  );
}

function OrderSuccess({ order, mode }: { readonly order: Order; readonly mode: 'cash' | 'paid' }) {
  useEffect(() => {
    forgetOrder();
  }, []);

  return (
    <main className="page order">
      <div className="order__main">
        <div className="success-badge">✓</div>
        <h1 className="page__title">{mode === 'cash' ? 'Заказ оформлен' : 'Заказ оплачен'}</h1>
        <p className="order__number">Номер заказа: {order.number}</p>
        {mode === 'cash' ? (
          <p className="notice notice--info">Заказ оформлен, оплата при получении.</p>
        ) : (
          <p className="notice notice--ok">Оплата прошла успешно.</p>
        )}
        <Link className="btn btn--secondary" to="/">
          Вернуться в каталог
        </Link>
      </div>
      <OrderSummary order={order} />
    </main>
  );
}

function OrderSummary({ order }: { readonly order: Order }) {
  return (
    <aside className="summary" aria-label="Состав заказа">
      <h2 className="summary__title">Состав заказа</h2>
      <ul className="summary__items">
        {order.items.map((item) => (
          <li key={item.productId} className="summary__row">
            <span>
              {item.title} × {item.quantity}
            </span>
            <span>{formatMoney(item.lineTotal)}</span>
          </li>
        ))}
      </ul>
      <div className="summary__line">
        <span>Товары</span>
        <span>{formatMoney(order.subtotal)}</span>
      </div>
      <div className="summary__line">
        <span>Доставка</span>
        <span>{order.shipping === 0 ? 'Бесплатно' : formatMoney(order.shipping)}</span>
      </div>
      <div className="summary__line summary__line--total">
        <span>Итого</span>
        <strong>{formatMoney(order.total)}</strong>
      </div>
      <p className="summary__delivery">{describeDelivery(order.delivery)}</p>
    </aside>
  );
}
