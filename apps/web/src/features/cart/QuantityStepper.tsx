import { useState } from 'react';
import { Button } from '../../ui/controls';
import { useCart } from './CartContext';

/**
 * Quantity control bound to the server cart. Every change goes through the cart
 * context (which re-reads the authoritative cart), and the buttons disable while
 * a change is in flight so a double click cannot fire two writes.
 */
export function QuantityStepper({
  productId,
  max,
}: {
  readonly productId: string;
  readonly max: number;
}) {
  const { itemsById, pending, setQuantity, remove } = useCart();
  const [error, setError] = useState<string | null>(null);
  const quantity = itemsById.get(productId)?.quantity ?? 0;
  const busy = pending.has(productId);

  const apply = async (next: number) => {
    setError(null);
    const result = next <= 0 ? await remove(productId) : await setQuantity(productId, next);
    if (!result.ok) setError(result.error.message);
  };

  if (quantity === 0) {
    return (
      <div className="stepper-wrap">
        <Button onClick={() => apply(1)} loading={busy} disabled={max < 1}>
          В корзину
        </Button>
        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="stepper-wrap">
      <div className="stepper">
        <Button
          variant="secondary"
          aria-label="Уменьшить количество"
          onClick={() => apply(quantity - 1)}
          loading={busy}
        >
          −
        </Button>
        <span className="stepper__value" aria-live="polite">
          {quantity}
        </span>
        <Button
          variant="secondary"
          aria-label="Увеличить количество"
          onClick={() => apply(quantity + 1)}
          loading={busy}
          disabled={quantity >= max}
        >
          +
        </Button>
      </div>
      {error ? (
        <p className="field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
