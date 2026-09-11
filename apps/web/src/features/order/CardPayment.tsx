import { useState } from 'react';
import { api } from '../../api/endpoints';
import { useAsyncData } from '../../lib/useAsync';
import { formatMoney } from '../../lib/money';
import { Button, ErrorNote, RadioCard, Spinner } from '../../ui/controls';
import { useCardPayment } from './useCardPayment';

/**
 * The test payment form. It never accepts a real card number or CVC: the user
 * picks a sandbox card whose scenario (success/decline) drives the simulation.
 * Cancelling sends the `cancel` scenario. Declines and cancels keep the order so
 * the user can pay again with a new attempt.
 */
export function CardPayment({
  orderId,
  total,
  onPaid,
}: {
  readonly orderId: string;
  readonly total: number;
  readonly onPaid: () => void;
}) {
  const { phase, pay, retry } = useCardPayment(orderId, onPaid);
  const sandbox = useAsyncData((signal) => api.sandbox.get(signal), []);
  const [cardId, setCardId] = useState<string | null>(null);

  const cards = sandbox.state.status === 'success' ? sandbox.state.data.cards : [];
  const selectedCard = cards.find((card) => card.id === cardId) ?? cards[0] ?? null;

  if (phase.status === 'loading') {
    return (
      <section className="pay">
        <Spinner label="Готовим оплату…" />
      </section>
    );
  }

  if (phase.status === 'processing') {
    return (
      <section className="pay">
        <Spinner label="Ожидаем подтверждение оплаты…" />
        <p className="muted">Не закрывайте страницу. Статус обновится автоматически.</p>
      </section>
    );
  }

  if (phase.status === 'succeeded') {
    return (
      <section className="pay">
        <Spinner label="Оплата подтверждена, открываем заказ…" />
      </section>
    );
  }

  if (phase.status === 'error') {
    return (
      <section className="pay">
        <ErrorNote error={phase.error} onRetry={retry} />
      </section>
    );
  }

  const declined = phase.status === 'failed';
  const cancelled = phase.status === 'cancelled';

  if (declined || cancelled) {
    return (
      <section className="pay">
        <p className="notice notice--error" role="alert">
          {declined ? 'Банк отклонил оплату (CARD_DECLINED).' : 'Оплата отменена.'}
        </p>
        <Button onClick={retry}>Повторить оплату</Button>
      </section>
    );
  }

  // phase.status === 'ready'
  return (
    <section className="pay">
      <h2 className="pay__title">Оплата картой</h2>
      {sandbox.state.status === 'loading' ? <Spinner label="Загружаем тестовые карты…" /> : null}
      {sandbox.state.status === 'error' ? (
        <ErrorNote error={sandbox.state.error} onRetry={sandbox.reload} />
      ) : null}
      <div
        className="radio-group radio-group--column"
        role="radiogroup"
        aria-label="Тестовая карта"
      >
        {cards.map((card) => (
          <RadioCard
            key={card.id}
            name="test-card"
            checked={(selectedCard?.id ?? '') === card.id}
            onSelect={() => setCardId(card.id)}
            title={card.title}
            description={card.maskedNumber}
          />
        ))}
      </div>
      <div className="pay__actions">
        <Button onClick={() => selectedCard && pay(selectedCard.scenario)} disabled={!selectedCard}>
          Оплатить {formatMoney(total)}
        </Button>
        <Button variant="ghost" onClick={() => pay('cancel')}>
          Отменить оплату
        </Button>
      </div>
      <p className="muted">
        Настоящий номер карты и CVC вводить не нужно — выберите тестовую карту.
      </p>
    </section>
  );
}
