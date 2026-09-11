import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { buildApp } from '../dist/app.js';

const customer = {
  name: 'Тестовый Покупатель',
  email: 'buyer@example.test',
  phone: '+79990000000',
};
const pickup = { method: 'pickup', pickupPointId: 'point-center' };
const courier = {
  method: 'courier',
  address: { city: 'Учебный', street: 'Примерная', house: '10' },
};

async function harness(t, options = {}) {
  let now = Date.now();
  const app = await buildApp({ paymentDelayMs: 1200, now: () => now, ...options });
  t.after(() => app.close());
  const doc = await SwaggerParser.dereference(structuredClone(app.swagger()));
  const ajv = addFormats(new Ajv({ strict: false }));
  const validators = new Map();
  async function call(method, url, body, { token, key, status = 200, extraHeaders = {} } = {}) {
    const headers = {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'idempotency-key': key } : {}),
      ...extraHeaders,
    };
    const response = await app.inject({ method, url, payload: body, headers });
    assert.equal(response.statusCode, status, `${method} ${url}: ${response.body}`);
    if (status === 204) {
      assert.equal(response.body, '');
      assert.equal(response.headers['content-type'], undefined);
      return undefined;
    }
    const json = response.json();
    const template = Object.keys(doc.paths).find((path) =>
      new RegExp(`^${path.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(url),
    );
    const operation = doc.paths[template]?.[method.toLowerCase()];
    assert.ok(operation, `Undocumented route: ${method} ${url}`);
    const responseSchema =
      operation.responses[String(status)]?.content?.['application/json']?.schema;
    assert.ok(responseSchema, `Undocumented response ${status}: ${method} ${url}`);
    const index = `${method}:${template}:${status}`;
    if (!validators.has(index)) validators.set(index, ajv.compile(responseSchema));
    const validate = validators.get(index);
    assert.ok(validate(json), `${method} ${url} schema: ${JSON.stringify(validate.errors)}`);
    assert.equal(response.headers['x-request-id'], json.meta.requestId);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.ok(!JSON.stringify(json).includes('"owner"'), 'Internal ownership must not leak');
    return status >= 400 ? json.error : json.data;
  }
  async function session() {
    return (await call('POST', '/api/sessions', {}, { status: 201 })).token;
  }
  async function prepare(token, { delivery = pickup, quantity = 1, paymentMethod = 'card' } = {}) {
    const cart = await call('GET', '/api/cart', undefined, { token });
    await call('PUT', '/api/cart/items/lamp-orbit', { quantity }, { token, status: 201 });
    const updated = await call('GET', '/api/cart', undefined, { token });
    const quote = await call(
      'POST',
      '/api/quotes',
      { cartVersion: updated.version, delivery },
      { token, status: 201 },
    );
    const body = { quoteId: quote.id, customer, paymentMethod };
    const key = randomUUID();
    const order = await call('POST', '/api/orders', body, { token, key, status: 201 });
    return { quote, body, key, order };
  }
  return {
    app,
    call,
    session,
    prepare,
    advance: (ms) => {
      now += ms;
    },
  };
}

test('catalog → cart → courier → paid order; actual responses conform to OpenAPI', async (t) => {
  const h = await harness(t);
  const token = await h.session();
  const products = await h.call('GET', '/api/products');
  assert.equal(products.length, 4);
  assert.ok(products.some((p) => p.stock === 0));
  const sandbox = await h.call('GET', '/api/sandbox');
  assert.deepEqual(
    sandbox.cards.map((c) => c.scenario),
    ['success', 'decline'],
  );
  const options = await h.call('GET', '/api/checkout/options', undefined, { token });
  assert.equal(options.deliveryMethods.length, 2);
  assert.equal(options.paymentMethods.length, 2);
  const { order, quote } = await h.prepare(token, { delivery: courier });
  assert.equal(quote.total, 288000);
  assert.equal(order.total, quote.total);
  assert.equal(order.status, 'awaiting_payment');
  const payment = await h.call(
    'POST',
    `/api/orders/${order.id}/payments`,
    {},
    { token, key: randomUUID(), status: 201 },
  );
  assert.equal(payment.amount, 288000);
  const accepted = await h.call(
    'POST',
    `/api/payments/${payment.id}/simulations`,
    { scenario: 'success' },
    { token, status: 202 },
  );
  assert.equal(accepted.status, 'processing');
  assert.equal(
    (await h.call('GET', `/api/orders/${order.id}`, undefined, { token })).status,
    'awaiting_payment',
  );
  h.advance(1201);
  assert.equal(
    (await h.call('GET', `/api/payments/${payment.id}`, undefined, { token })).status,
    'succeeded',
  );
  const paid = await h.call('GET', `/api/orders/${order.id}`, undefined, { token });
  assert.equal(paid.status, 'paid');
  assert.equal(paid.paymentStatus, 'succeeded');
  assert.equal((await h.call('GET', '/api/cart', undefined, { token })).items.length, 0);
  assert.equal((await h.call('GET', '/api/orders', undefined, { token })).length, 1);
});

test('decline and cancel preserve order; retries cannot double-charge or overwrite final outcome', async (t) => {
  const h = await harness(t);
  const token = await h.session();
  const { order } = await h.prepare(token);
  for (const [scenario, expected] of [
    ['decline', 'failed'],
    ['cancel', 'cancelled'],
    ['success', 'succeeded'],
  ]) {
    const key = randomUUID();
    const payment = await h.call(
      'POST',
      `/api/orders/${order.id}/payments`,
      {},
      { token, key, status: 201 },
    );
    assert.equal(
      (await h.call('POST', `/api/orders/${order.id}/payments`, {}, { token, key, status: 200 }))
        .id,
      payment.id,
    );
    assert.equal(
      (
        await h.call(
          'POST',
          `/api/orders/${order.id}/payments`,
          {},
          { token, key: randomUUID(), status: 409 },
        )
      ).code,
      'PAYMENT_IN_PROGRESS',
    );
    await h.call(
      'POST',
      `/api/payments/${payment.id}/simulations`,
      { scenario },
      { token, status: 202 },
    );
    h.advance(1201);
    const terminal = await h.call('GET', `/api/payments/${payment.id}`, undefined, { token });
    assert.equal(terminal.status, expected);
    assert.equal(terminal.failureCode, expected === 'failed' ? 'CARD_DECLINED' : null);
    assert.equal(
      (
        await h.call(
          'POST',
          `/api/payments/${payment.id}/simulations`,
          { scenario },
          { token, status: 200 },
        )
      ).status,
      expected,
    );
    assert.equal(
      (
        await h.call(
          'POST',
          `/api/payments/${payment.id}/simulations`,
          { scenario: scenario === 'success' ? 'decline' : 'success' },
          { token, status: 409 },
        )
      ).code,
      'PAYMENT_FINALIZED',
    );
  }
  assert.equal(
    (await h.call('GET', `/api/orders/${order.id}/payments`, undefined, { token })).length,
    3,
  );
  assert.equal((await h.call('GET', '/api/orders', undefined, { token })).length, 1);
  assert.equal(
    (
      await h.call(
        'POST',
        `/api/orders/${order.id}/payments`,
        {},
        { token, key: randomUUID(), status: 409 },
      )
    ).code,
    'ORDER_ALREADY_PAID',
  );
});

test('order idempotency survives cart clearing, field reordering and concurrent duplicate requests', async (t) => {
  const h = await harness(t);
  const token = await h.session();
  const { order, key, body } = await h.prepare(token);
  const replies = await Promise.all(
    Array.from({ length: 5 }, () =>
      h.call(
        'POST',
        '/api/orders',
        { customer, paymentMethod: 'card', quoteId: body.quoteId },
        { token, key, status: 200 },
      ),
    ),
  );
  assert.ok(replies.every((r) => r.id === order.id));
  assert.equal((await h.call('GET', '/api/orders', undefined, { token })).length, 1);
  assert.equal(
    (
      await h.call(
        'POST',
        '/api/orders',
        { ...body, paymentMethod: 'cash_on_delivery' },
        { token, key, status: 409 },
      )
    ).code,
    'IDEMPOTENCY_CONFLICT',
  );
  assert.equal(
    (await h.call('POST', '/api/orders', body, { token, key: randomUUID(), status: 409 })).code,
    'CART_VERSION_CONFLICT',
  );
});

test('cart versions, stock, quote expiry, courier threshold and deletion', async (t) => {
  const h = await harness(t);
  const token = await h.session();
  assert.equal(
    (
      await h.call(
        'POST',
        '/api/quotes',
        { cartVersion: 0, delivery: pickup },
        { token, status: 422 },
      )
    ).code,
    'CART_EMPTY',
  );
  assert.equal(
    (await h.call('PUT', '/api/cart/items/clock-dot', { quantity: 1 }, { token, status: 409 }))
      .code,
    'INSUFFICIENT_STOCK',
  );
  assert.equal(
    (await h.call('PUT', '/api/cart/items/missing', { quantity: 1 }, { token, status: 404 })).code,
    'PRODUCT_NOT_FOUND',
  );
  await h.call('PUT', '/api/cart/items/lamp-orbit', { quantity: 3 }, { token, status: 201 });
  const cart = await h.call('GET', '/api/cart', undefined, { token });
  assert.equal(
    (
      await h.call(
        'POST',
        '/api/quotes',
        { cartVersion: 0, delivery: pickup },
        { token, status: 409 },
      )
    ).code,
    'CART_VERSION_CONFLICT',
  );
  const quote = await h.call(
    'POST',
    '/api/quotes',
    { cartVersion: cart.version, delivery: courier },
    { token, status: 201 },
  );
  assert.equal(quote.total, 747000);
  assert.equal(quote.shipping, 0);
  h.advance(10 * 60 * 1000 + 1);
  assert.equal(
    (
      await h.call(
        'POST',
        '/api/orders',
        { quoteId: quote.id, customer, paymentMethod: 'card' },
        { token, key: randomUUID(), status: 409 },
      )
    ).code,
    'QUOTE_EXPIRED',
  );
  await h.call('DELETE', '/api/cart/items/lamp-orbit', undefined, { token, status: 204 });
  const removed = await h.call('GET', '/api/cart', undefined, { token });
  assert.equal(removed.subtotal, 0);
  assert.equal(removed.items.length, 0);
});

test('session isolation, validation and protected Swagger operations', async (t) => {
  const h = await harness(t);
  const token = await h.session();
  const other = await h.session();
  assert.equal(
    (await h.call('GET', '/api/cart', undefined, { status: 401 })).code,
    'SESSION_REQUIRED',
  );
  assert.equal(
    (await h.call('GET', '/api/cart', undefined, { token: randomUUID(), status: 401 })).code,
    'SESSION_INVALID',
  );
  const bad = await h.call(
    'PUT',
    '/api/cart/items/lamp-orbit',
    { quantity: '1' },
    { token, status: 400 },
  );
  assert.equal(bad.code, 'VALIDATION_ERROR');
  assert.ok(bad.fields.length);
  await h.call(
    'PUT',
    '/api/cart/items/lamp-orbit',
    { quantity: 1, price: 1 },
    { token, status: 400 },
  );
  const { order, quote } = await h.prepare(token);
  const payment = await h.call(
    'POST',
    `/api/orders/${order.id}/payments`,
    {},
    { token, key: randomUUID(), status: 201 },
  );
  await h.call('GET', `/api/orders/${order.id}`, undefined, { token: other, status: 404 });
  await h.call('GET', `/api/payments/${payment.id}`, undefined, { token: other, status: 404 });
  await h.call(
    'POST',
    '/api/orders',
    { quoteId: quote.id, customer, paymentMethod: 'card' },
    { token: other, key: randomUUID(), status: 404 },
  );
  await h.call(
    'POST',
    `/api/payments/${payment.id}/simulations`,
    { scenario: 'success' },
    { token: other, status: 404 },
  );
  await h.call('POST', `/api/orders/${order.id}/payments`, {}, { token, status: 400 });
  await h.call(
    'POST',
    `/api/payments/${payment.id}/simulations`,
    { scenario: 'success', cardNumber: 'not-accepted' },
    { token, status: 400 },
  );
  assert.equal((await h.call('GET', '/api/orders', undefined, { token: other })).length, 0);
});

test('cash order is confirmed but unpaid', async (t) => {
  const h = await harness(t);
  const token = await h.session();
  const { order } = await h.prepare(token, { paymentMethod: 'cash_on_delivery' });
  assert.equal(order.status, 'confirmed');
  assert.equal(order.paymentStatus, 'unpaid');
  assert.equal(
    (
      await h.call(
        'POST',
        `/api/orders/${order.id}/payments`,
        {},
        { token, key: randomUUID(), status: 409 },
      )
    ).code,
    'PAYMENT_NOT_REQUIRED',
  );
});

test('sessions, processing payments and idempotency persist through API restart', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'checkout-persistence-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'store.json');
  let now = Date.now();
  const a = await harness(t, { dataFile: file, now: () => now });
  const token = await a.session();
  const { order, body, key } = await a.prepare(token);
  const payment = await a.call(
    'POST',
    `/api/orders/${order.id}/payments`,
    {},
    { token, key: randomUUID(), status: 201 },
  );
  await a.call(
    'POST',
    `/api/payments/${payment.id}/simulations`,
    { scenario: 'success' },
    { token, status: 202 },
  );
  await a.app.close();
  now += 1300;
  const b = await harness(t, { dataFile: file, now: () => now });
  assert.equal(
    (await b.call('GET', `/api/orders/${order.id}`, undefined, { token })).status,
    'paid',
  );
  assert.equal(
    (await b.call('GET', `/api/payments/${payment.id}`, undefined, { token })).status,
    'succeeded',
  );
  assert.equal(
    (await b.call('POST', '/api/orders', body, { token, key, status: 200 })).id,
    order.id,
  );
});

test('Swagger UI assets, JSON, CORS preflight, malformed JSON and request IDs', async (t) => {
  const h = await harness(t);
  for (const url of ['/docs/', '/docs/static/swagger-ui-bundle.js', '/openapi.json']) {
    const response = await h.app.inject({ url });
    assert.equal(response.statusCode, 200, url);
  }
  const preflight = await h.app.inject({
    method: 'OPTIONS',
    url: '/api/orders',
    headers: {
      origin: 'http://localhost:5173',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'authorization,content-type,idempotency-key',
    },
  });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], 'http://localhost:5173');
  assert.match(preflight.headers['access-control-allow-headers'], /Idempotency-Key/);
  const bad = await h.app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: '{broken',
    headers: { 'content-type': 'application/json' },
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error.code, 'INVALID_REQUEST');
  const tooLarge = await h.app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: { blob: 'x'.repeat(40000) },
  });
  assert.equal(tooLarge.statusCode, 413);
  assert.equal(tooLarge.json().error.code, 'PAYLOAD_TOO_LARGE');
  const unsupported = await h.app.inject({
    method: 'POST',
    url: '/api/sessions',
    payload: '<xml/>',
    headers: { 'content-type': 'application/xml' },
  });
  assert.equal(unsupported.statusCode, 415);
});
