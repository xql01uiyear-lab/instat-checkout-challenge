import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Delivery, Quote } from '@checkout/contracts';
import { api } from '../../api/endpoints';
import { ApiError } from '../../api/errors';
import { formatMoney } from '../../lib/money';
import { useAsyncData, useMutation } from '../../lib/useAsync';
import { useForm } from '../../lib/useForm';
import { useIdempotencyKey } from '../../lib/idempotency';
import {
  compose,
  email as emailRule,
  minLength,
  phone as phoneRule,
  required,
} from '../../lib/validation';
import { rememberOrder } from '../../lib/persist';
import { Button, ErrorNote, RadioCard, Spinner, TextField } from '../../ui/controls';
import { useCart } from '../cart/CartContext';
import {
  buildDelivery,
  type CheckoutField,
  type DeliveryMethodId,
  isAddressComplete,
} from './delivery';

const VALIDATORS: Partial<Record<CheckoutField, ReturnType<typeof compose>>> = {
  name: compose(required('Укажите имя'), minLength(2)),
  email: compose(required('Укажите email'), emailRule),
  phone: compose(required('Укажите телефон'), phoneRule),
  city: compose(required('Укажите город'), minLength(2)),
  street: compose(required('Укажите улицу'), minLength(2)),
  house: required('Укажите дом'),
};

const INITIAL: Record<CheckoutField, string> = {
  name: '',
  email: '',
  phone: '',
  city: '',
  street: '',
  house: '',
  apartment: '',
};

/** Map a server field path (`body/customer/email`) to our form field. */
function fieldFromPath(path: string): CheckoutField | null {
  const leaf = path.split('/').pop() ?? '';
  return leaf in INITIAL ? (leaf as CheckoutField) : null;
}

export function CheckoutPage() {
  const navigate = useNavigate();
  const { cart } = useCart();
  const options = useAsyncData((signal) => api.checkout.options(signal), []);

  const form = useForm<CheckoutField>(INITIAL, VALIDATORS);
  const [method, setMethod] = useState<DeliveryMethodId>('pickup');
  const [pickupPointId, setPickupPointId] = useState<string | null>(null);
  const [payment, setPayment] = useState<'card' | 'cash_on_delivery'>('card');
  const [formError, setFormError] = useState<string | null>(null);

  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<ApiError | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  const createOrder = useMutation(api.orders.create);
  const orderKey = useIdempotencyKey();

  const pickupPoints = useMemo(() => {
    const pickup =
      options.state.status === 'success'
        ? options.state.data.deliveryMethods.find((m) => m.id === 'pickup')
        : undefined;
    return pickup?.pickupPoints ?? [];
  }, [options.state]);

  // Default the pickup point once options arrive so a quote can be priced.
  useEffect(() => {
    if (!pickupPointId && pickupPoints.length > 0) setPickupPointId(pickupPoints[0]!.id);
  }, [pickupPoints, pickupPointId]);

  const courierReady = isAddressComplete(form.values);
  // Shipping depends on method + pickup point + cart version, not address text.
  const quoteKey =
    method === 'pickup' ? `pickup:${pickupPointId ?? ''}` : `courier:${courierReady ? '1' : '0'}`;
  const cartVersion = cart?.version ?? null;
  const hasItems = !!cart && cart.items.length > 0;

  useEffect(() => {
    if (!hasItems || cartVersion === null) {
      setQuote(null);
      return;
    }
    const delivery = buildDelivery(method, pickupPointId, form.values);
    if (!delivery) {
      setQuote(null);
      return;
    }
    const controller = new AbortController();
    setQuoteLoading(true);
    setQuoteError(null);
    api.quotes.create({ cartVersion, delivery }, controller.signal).then(
      (fresh) => {
        if (controller.signal.aborted) return;
        setQuote(fresh);
        setQuoteLoading(false);
      },
      (error) => {
        if (controller.signal.aborted) return;
        setQuote(null);
        setQuoteError(error instanceof ApiError ? error : null);
        setQuoteLoading(false);
      },
    );
    return () => controller.abort();
    // form.values is intentionally read fresh inside; quoteKey captures what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey, cartVersion, hasItems]);

  const applyOrderError = (error: ApiError) => {
    if (!error.isNetwork) orderKey.reset();
    if (error.info.kind === 'http' && error.info.fields?.length) {
      let mappedAny = false;
      for (const issue of error.info.fields) {
        const field = fieldFromPath(issue.path);
        if (field) {
          form.setError(field, 'Проверьте значение');
          mappedAny = true;
        }
      }
      if (mappedAny) {
        setFormError('Проверьте выделенные поля.');
        return;
      }
    }
    if (error.code === 'CART_VERSION_CONFLICT' || error.code === 'QUOTE_EXPIRED') {
      setFormError('Корзина или расчёт обновились. Проверьте сумму и подтвердите заказ ещё раз.');
      return;
    }
    if (error.code === 'CART_EMPTY') {
      setFormError('Корзина пуста.');
      return;
    }
    setFormError(error.message);
  };

  const [placing, setPlacing] = useState(false);
  // Ref guard is synchronous: two clicks in the same render can't both pass.
  const placingRef = useRef(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (placingRef.current) return;
    setFormError(null);
    const keys: CheckoutField[] =
      method === 'courier'
        ? ['name', 'email', 'phone', 'city', 'street', 'house']
        : ['name', 'email', 'phone'];
    if (!form.validate(keys)) return;
    if (!hasItems || cartVersion === null) {
      setFormError('Корзина пуста.');
      return;
    }
    const delivery: Delivery | null = buildDelivery(method, pickupPointId, form.values);
    if (!delivery) {
      setFormError('Заполните адрес или выберите пункт выдачи.');
      return;
    }

    placingRef.current = true;
    setPlacing(true);
    try {
      // A fresh quote pins the exact chosen delivery to the current cart version.
      let freshQuote: Quote;
      try {
        freshQuote = await api.quotes.create({ cartVersion, delivery });
      } catch (error) {
        applyOrderError(
          error instanceof ApiError
            ? error
            : new ApiError({ kind: 'network', message: 'Ошибка сети.' }),
        );
        return;
      }

      const customer = {
        name: form.values.name.trim(),
        email: form.values.email.trim(),
        phone: form.values.phone.trim(),
      };
      const result = await createOrder.run(
        { quoteId: freshQuote.id, customer, paymentMethod: payment },
        orderKey.current(),
      );
      if (result.ok) {
        orderKey.reset();
        rememberOrder(result.data.id);
        navigate(`/order/${result.data.id}`);
      } else {
        applyOrderError(result.error);
      }
    } finally {
      placingRef.current = false;
      setPlacing(false);
    }
  };

  if (options.state.status === 'loading') {
    return (
      <main className="page">
        <Spinner label="Готовим оформление…" />
      </main>
    );
  }
  if (options.state.status === 'error') {
    return (
      <main className="page">
        <ErrorNote error={options.state.error} onRetry={options.reload} />
      </main>
    );
  }
  if (!hasItems) {
    return (
      <main className="page page--center">
        <p className="muted">Корзина пуста — оформлять нечего.</p>
        <Link className="btn btn--primary" to="/">
          Вернуться в каталог
        </Link>
      </main>
    );
  }

  if (options.state.status !== 'success') return null;
  const paymentMethods = options.state.data.paymentMethods;
  const subtotal = quote?.subtotal ?? cart!.subtotal;
  const shipping = quote?.shipping ?? null;
  const total = quote?.total ?? null;

  return (
    <main className="page checkout">
      <form className="checkout__form" onSubmit={submit} noValidate>
        <h1 className="page__title">Оформление заказа</h1>

        <fieldset className="section">
          <legend className="section__title">Контакты</legend>
          <TextField
            label="Имя"
            value={form.values.name}
            onChange={form.setField('name')}
            onBlur={form.blurField('name')}
            error={form.touched.name ? form.errors.name : undefined}
            autoComplete="name"
          />
          <TextField
            label="Email"
            type="email"
            value={form.values.email}
            onChange={form.setField('email')}
            onBlur={form.blurField('email')}
            error={form.touched.email ? form.errors.email : undefined}
            autoComplete="email"
          />
          <TextField
            label="Телефон"
            type="tel"
            value={form.values.phone}
            onChange={form.setField('phone')}
            onBlur={form.blurField('phone')}
            error={form.touched.phone ? form.errors.phone : undefined}
            hint="Формат +79990000000"
            autoComplete="tel"
          />
        </fieldset>

        <fieldset className="section">
          <legend className="section__title">Доставка</legend>
          <div className="radio-group">
            <RadioCard
              name="delivery"
              checked={method === 'pickup'}
              onSelect={() => setMethod('pickup')}
              title="Самовывоз"
              description="Бесплатно"
            />
            <RadioCard
              name="delivery"
              checked={method === 'courier'}
              onSelect={() => setMethod('courier')}
              title="Курьер"
              description="Бесплатно от 5 000 ₽"
            />
          </div>

          {method === 'pickup' ? (
            <div className="radio-group radio-group--column">
              {pickupPoints.map((point) => (
                <RadioCard
                  key={point.id}
                  name="pickup-point"
                  checked={pickupPointId === point.id}
                  onSelect={() => setPickupPointId(point.id)}
                  title={point.title}
                  description={point.address}
                />
              ))}
            </div>
          ) : (
            <div className="address-grid">
              <TextField
                label="Город"
                value={form.values.city}
                onChange={form.setField('city')}
                onBlur={form.blurField('city')}
                error={form.touched.city ? form.errors.city : undefined}
                autoComplete="address-level2"
              />
              <TextField
                label="Улица"
                value={form.values.street}
                onChange={form.setField('street')}
                onBlur={form.blurField('street')}
                error={form.touched.street ? form.errors.street : undefined}
                autoComplete="address-line1"
              />
              <TextField
                label="Дом"
                value={form.values.house}
                onChange={form.setField('house')}
                onBlur={form.blurField('house')}
                error={form.touched.house ? form.errors.house : undefined}
              />
              <TextField
                label="Квартира"
                value={form.values.apartment}
                onChange={form.setField('apartment')}
                hint="Необязательно"
              />
            </div>
          )}
        </fieldset>

        <fieldset className="section">
          <legend className="section__title">Оплата</legend>
          <div className="radio-group radio-group--column">
            {paymentMethods.map((option) => (
              <RadioCard
                key={option.id}
                name="payment"
                checked={payment === option.id}
                onSelect={() => setPayment(option.id)}
                title={option.title}
              />
            ))}
          </div>
        </fieldset>

        {formError ? (
          <p className="notice notice--error" role="alert">
            {formError}
          </p>
        ) : null}

        <Button type="submit" loading={placing} disabled={placing}>
          {payment === 'card' ? 'Перейти к оплате' : 'Оформить заказ'}
        </Button>
      </form>

      <aside className="summary" aria-label="Итог заказа">
        <h2 className="summary__title">Ваш заказ</h2>
        <ul className="summary__items">
          {cart!.items.map((item) => (
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
          <span>{formatMoney(subtotal)}</span>
        </div>
        <div className="summary__line">
          <span>Доставка</span>
          <span>
            {quoteLoading
              ? '…'
              : shipping === null
                ? '—'
                : shipping === 0
                  ? 'Бесплатно'
                  : formatMoney(shipping)}
          </span>
        </div>
        <div className="summary__line summary__line--total">
          <span>Итого</span>
          <strong>{total === null ? formatMoney(subtotal) : formatMoney(total)}</strong>
        </div>
        {quoteError ? (
          <p className="field__error" role="alert">
            {quoteError.message}
          </p>
        ) : null}
        {shipping === null && !quoteLoading ? (
          <p className="muted">
            {method === 'courier'
              ? 'Заполните адрес для расчёта доставки.'
              : 'Выберите пункт выдачи.'}
          </p>
        ) : null}
      </aside>
    </main>
  );
}
