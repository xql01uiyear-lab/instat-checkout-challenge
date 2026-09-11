import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const base = (process.env.BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const specResponse = await fetch(`${base}/openapi.json`, { signal: AbortSignal.timeout(5000) });
assert.ok(specResponse.ok, 'Start the API before running npm run smoke');
const spec = await SwaggerParser.validate(await specResponse.json());
const ajv = addFormats(new Ajv({ strict: false }));
const checks = [];
async function request(method, path, body, token, key, status = 200) {
  const response = await fetch(`${base}${path}`, {
    method,
    signal: AbortSignal.timeout(5000),
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json();
  assert.equal(response.status, status, `${method} ${path}: ${JSON.stringify(json)}`);
  const template = Object.keys(spec.paths).find((p) =>
    new RegExp(`^${p.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(path),
  );
  const schema =
    spec.paths[template][method.toLowerCase()].responses[String(status)].content['application/json']
      .schema;
  const valid = ajv.validate(schema, json);
  assert.ok(valid, JSON.stringify(ajv.errors));
  return json.data;
}
const token = (await request('POST', '/api/sessions', {}, undefined, undefined, 201)).token;
const products = await request('GET', '/api/products');
const product = products.find((p) => p.stock > 0);
const options = await request('GET', '/api/checkout/options', undefined, token);
assert.equal(options.paymentMethods.length, 2);
const sandbox = await request('GET', '/api/sandbox');
async function createOrder(method = 'card', courier = false) {
  const cart = await request('GET', '/api/cart', undefined, token);
  await request('PUT', `/api/cart/items/${product.id}`, { quantity: 1 }, token, undefined, 201);
  const updated = await request('GET', '/api/cart', undefined, token);
  const delivery = courier
    ? { method: 'courier', address: { city: 'Учебный', street: 'Примерная', house: '10' } }
    : { method: 'pickup', pickupPointId: 'point-center' };
  const quote = await request(
    'POST',
    '/api/quotes',
    { cartVersion: updated.version, delivery },
    token,
    undefined,
    201,
  );
  const body = {
    quoteId: quote.id,
    paymentMethod: method,
    customer: { name: 'Тестовый Покупатель', email: 'buyer@example.test', phone: '+79990000000' },
  };
  const key = randomUUID();
  const order = await request('POST', '/api/orders', body, token, key, 201);
  assert.equal((await request('POST', '/api/orders', body, token, key, 200)).id, order.id);
  assert.equal(order.total, quote.total);
  return order;
}
async function pay(order, scenario, expected) {
  const key = randomUUID();
  const payment = await request('POST', `/api/orders/${order.id}/payments`, {}, token, key, 201);
  assert.equal(
    (await request('POST', `/api/orders/${order.id}/payments`, {}, token, key, 200)).id,
    payment.id,
  );
  const started = await request(
    'POST',
    `/api/payments/${payment.id}/simulations`,
    { scenario },
    token,
    undefined,
    202,
  );
  assert.equal(started.status, 'processing');
  const deadline = Date.now() + sandbox.settlementDelayMs + 5000;
  let result;
  do {
    await pause(250);
    result = await request('GET', `/api/payments/${payment.id}`, undefined, token);
  } while (result.status === 'processing' && Date.now() < deadline);
  assert.equal(result.status, expected);
  return request('GET', `/api/orders/${order.id}`, undefined, token);
}
const order = await createOrder('card', true);
assert.equal((await pay(order, 'decline', 'failed')).status, 'awaiting_payment');
checks.push('declined card keeps the same unpaid order');
assert.equal((await pay(order, 'cancel', 'cancelled')).status, 'awaiting_payment');
checks.push('cancelled payment does not report success');
const paid = await pay(order, 'success', 'succeeded');
assert.equal(paid.status, 'paid');
assert.equal(paid.paymentStatus, 'succeeded');
checks.push('retry succeeds on the original order; 202 body and final order verified');
const cash = await createOrder('cash_on_delivery');
assert.equal(cash.status, 'confirmed');
assert.equal(cash.paymentStatus, 'unpaid');
checks.push('pickup / cash is confirmed, not paid online');
assert.equal((await request('GET', '/api/cart', undefined, token)).items.length, 0);
checks.push('cart cleared; idempotency replays preserve order/payment IDs');
console.log(
  `PASS: ${checks.length} HTTP scenarios; all observed responses validated against live OpenAPI.`,
);
for (const check of checks) console.log(`✓ ${check}`);
