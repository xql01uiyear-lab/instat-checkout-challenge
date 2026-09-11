import { useNavigate } from 'react-router-dom';
import { Button } from '../../ui/controls';
import { formatMoney } from '../../lib/money';
import { useCart } from './CartContext';
import { QuantityStepper } from './QuantityStepper';

/** Cart summary aside. Totals and line prices come straight from the server cart. */
export function CartPanel({ stockById }: { readonly stockById: ReadonlyMap<string, number> }) {
  const { cart, status } = useCart();
  const navigate = useNavigate();

  const isEmpty = !cart || cart.items.length === 0;

  return (
    <aside className="cart" aria-label="Корзина">
      <h2 className="cart__title">Корзина</h2>
      {status === 'loading' && !cart ? <p className="muted">Загрузка…</p> : null}
      {isEmpty ? (
        <p className="muted">Корзина пуста. Добавьте товары из каталога.</p>
      ) : (
        <>
          <ul className="cart__list">
            {cart.items.map((item) => (
              <li key={item.productId} className="cart__row">
                <div className="cart__info">
                  <span className="cart__name">{item.title}</span>
                  <span className="muted">{formatMoney(item.unitPrice)} / шт</span>
                </div>
                <QuantityStepper
                  productId={item.productId}
                  max={stockById.get(item.productId) ?? item.quantity}
                />
                <span className="cart__line">{formatMoney(item.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <div className="cart__total">
            <span>Итого товаров</span>
            <strong>{formatMoney(cart.subtotal)}</strong>
          </div>
          <Button className="cart__checkout" onClick={() => navigate('/checkout')}>
            Оформить заказ
          </Button>
        </>
      )}
    </aside>
  );
}
