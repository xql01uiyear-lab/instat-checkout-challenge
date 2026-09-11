import { useMemo } from 'react';
import { api } from '../../api/endpoints';
import { useAsyncData } from '../../lib/useAsync';
import { formatMoney } from '../../lib/money';
import { ErrorNote, Spinner } from '../../ui/controls';
import { CartPanel } from '../cart/CartPanel';
import { QuantityStepper } from '../cart/QuantityStepper';

export function HomePage() {
  const { state, reload } = useAsyncData((signal) => api.products.list(signal), []);
  const products = state.status === 'success' ? state.data : null;

  // Build a productId -> stock index once so the cart panel does O(1) lookups.
  const stockById = useMemo(() => {
    const map = new Map<string, number>();
    if (products) for (const product of products) map.set(product.id, product.stock);
    return map;
  }, [products]);

  return (
    <main className="page home">
      <section className="catalog" aria-label="Каталог товаров">
        <h1 className="page__title">Каталог</h1>
        {state.status === 'loading' ? <Spinner label="Загружаем товары…" /> : null}
        {state.status === 'error' ? <ErrorNote error={state.error} onRetry={reload} /> : null}
        {products ? (
          <ul className="catalog__grid">
            {products.map((product) => {
              const outOfStock = product.stock < 1;
              return (
                <li key={product.id} className="product">
                  <div className="product__head">
                    <h3 className="product__title">{product.title}</h3>
                    <span className="product__price">{formatMoney(product.price)}</span>
                  </div>
                  <p className="product__desc">{product.description}</p>
                  <div className="product__foot">
                    <span className={`badge ${outOfStock ? 'badge--muted' : 'badge--ok'}`}>
                      {outOfStock ? 'Нет в наличии' : `В наличии: ${product.stock}`}
                    </span>
                    <QuantityStepper productId={product.id} max={product.stock} />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>
      <CartPanel stockById={stockById} />
    </main>
  );
}
