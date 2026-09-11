import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
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
const delivery = { method: 'pickup', pickupPointId: 'point-center' };

async function fixture(t, options = {}) {
  let now = Date.now();
  const app = await buildApp({ now: () => now, paymentDelayMs: 1200, ...options });
  t.after(() => app.close());
  const doc = await SwaggerParser.dereference(structuredClone(app.swagger()));
  const ajv = addFormats(new Ajv({ strict: false }));
  const visited = new Set();
  let token;
  async function call(method, url, payload, status = 200, extra = {}) {
    const response = await app.inject({
      method,
      url,
      payload,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...extra },
    });
    assert.equal(response.statusCode, status, `${method} ${url}: ${response.body}`);
    const template = Object.keys(doc.paths).find((path) =>
      new RegExp(`^${path.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(url),
    );
    const operation = doc.paths[template]?.[method.toLowerCase()];
    assert.ok(operation, `Missing operation: ${method} ${url}`);
    const contract = operation.responses[status];
    assert.ok(contract, `Missing response: ${method} ${url} ${status}`);
    visited.add(`${method} ${template}`);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.match(response.headers['x-request-id'], /^[0-9a-f-]{36}$/);
    if ([204, 304].includes(status) || method === 'HEAD' || method === 'OPTIONS') {
      assert.equal(response.body, '');
      assert.ok(!contract.content);
    } else {
      const json = response.json();
      assert.ok(
        ajv.validate(contract.content['application/json'].schema, json),
        JSON.stringify(ajv.errors),
      );
      assert.equal(json.meta.requestId, response.headers['x-request-id']);
      assert.ok(!Object.hasOwn(json.data ?? {}, 'owner'));
      for (const { href, method: verb } of Object.values(json.links ?? {})) {
        assert.ok(app.findRoute({ method: verb, url: href }), `Broken link: ${verb} ${href}`);
      }
    }
    if ([201, 202].includes(status)) {
      assert.equal(response.headers.location, response.json().links.self.href);
      assert.ok(app.findRoute({ method: 'GET', url: response.headers.location }));
    }
    return response;
  }
  const session = (await call('POST', '/api/sessions', {}, 201)).json().data;
  token = session.token;
  assert.notEqual(session.id, token);
  await call('PUT', '/api/cart/items/lamp-orbit', { quantity: 1 }, 201);
  const cart = (await call('GET', '/api/cart')).json().data;
  const quote = (
    await call('POST', '/api/quotes', { cartVersion: cart.version, delivery }, 201)
  ).json().data;
  const body = { quoteId: quote.id, customer, paymentMethod: 'card' };
  const orderKey = randomUUID();
  const order = (
    await call('POST', '/api/orders', body, 201, { 'idempotency-key': orderKey })
  ).json().data;
  const paymentKey = randomUUID();
  const paymentUrl = `/api/orders/${order.id}/payments`;
  const payment = (
    await call('POST', paymentUrl, {}, 201, { 'idempotency-key': paymentKey })
  ).json().data;
  const simulationUrl = `/api/payments/${payment.id}/simulations`;
  const immediate = options.paymentDelayMs === 0;
  const accepted = await call(
    'POST',
    simulationUrl,
    { scenario: 'success' },
    immediate ? 201 : 202,
  );
  assert.equal(accepted.headers['retry-after'], immediate ? undefined : '1');
  const simulation = accepted.json().data;
  const paths = {
    '/api': ['GET'],
    '/api/sessions': ['POST'],
    '/api/products': ['GET'],
    '/api/sandbox': ['GET'],
    [`/api/sessions/${session.id}`]: ['GET'],
    '/api/cart': ['GET'],
    '/api/cart/items/lamp-orbit': ['GET', 'PUT', 'DELETE'],
    '/api/checkout/options': ['GET'],
    '/api/quotes': ['POST'],
    [`/api/quotes/${quote.id}`]: ['GET'],
    '/api/orders': ['GET', 'POST'],
    [`/api/orders/${order.id}`]: ['GET'],
    [paymentUrl]: ['GET', 'POST'],
    [`/api/payments/${payment.id}`]: ['GET'],
    [simulationUrl]: ['POST'],
    [`${simulationUrl}/${simulation.id}`]: ['GET'],
  };
  // Keep an item available for the GET/HEAD matrix after checkout emptied the cart.
  await call('PUT', '/api/cart/items/lamp-orbit', { quantity: 1 }, 201);
  return {
    app,
    doc,
    call,
    visited,
    session,
    paths,
    quote,
    order,
    body,
    orderKey,
    payment,
    paymentUrl,
    paymentKey,
    simulationUrl,
    simulation,
    advance: (ms) => {
      now += ms;
    },
  };
}

test('every API route: representation, HEAD, OPTIONS, Allow and wrong method', async (t) => {
  const f = await fixture(t);
  for (const [url, methods] of Object.entries(f.paths)) {
    const allowed = [...methods, ...(methods.includes('GET') ? ['HEAD'] : []), 'OPTIONS'].sort();
    if (methods.includes('GET')) {
      const get = await f.call('GET', url);
      const head = await f.call('HEAD', url);
      const conditionalGet = await f.call('GET', url, undefined, 304, { 'if-none-match': '*' });
      assert.equal(conditionalGet.headers['content-length'], get.headers['content-length']);
      const conditionalHead = await f.call('HEAD', url, undefined, 304, { 'if-none-match': '*' });
      assert.equal(conditionalHead.headers['content-length'], get.headers['content-length']);
      await f.call('GET', url, undefined, 412, { 'if-match': '"missing"' });
      assert.equal(head.headers['content-type'], get.headers['content-type']);
      if (head.headers['content-length'] !== undefined)
        assert.equal(head.headers['content-length'], get.headers['content-length']);
    }
    const options = await f.app.inject({ method: 'OPTIONS', url });
    assert.equal(options.statusCode, 204, url);
    assert.equal(options.body, '');
    assert.equal(options.headers['content-type'], undefined);
    assert.deepEqual(options.headers.allow.split(', ').sort(), allowed, url);
    const wrong = await f.app.inject({ method: 'PATCH', url });
    assert.equal(wrong.statusCode, 405, url);
    assert.equal(wrong.json().error.code, 'METHOD_NOT_ALLOWED');
    assert.equal(wrong.headers.allow, options.headers.allow);
    const preflight = await f.app.inject({
      method: 'OPTIONS',
      url,
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': methods[0],
        'access-control-request-headers': 'authorization,content-type,idempotency-key',
      },
    });
    assert.equal(preflight.statusCode, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], 'http://localhost:5173');
    assert.equal(preflight.headers['access-control-allow-methods'], options.headers.allow);
  }
  await f.call('DELETE', '/api/cart/items/lamp-orbit', undefined, 204);
  const business = [...f.visited].filter((value) => !value.startsWith('HEAD'));
  assert.equal(business.length, 20, 'Every published business operation was exercised');
  assert.equal([...f.visited].filter((value) => value.startsWith('HEAD')).length, 13);
  const allOperations = Object.values(f.doc.paths).flatMap((path) => Object.values(path));
  assert.equal(allOperations.length, 49);
  assert.equal(new Set(allOperations.map((op) => op.operationId)).size, 49);
});

test('GET, HEAD and OPTIONS never write payment or order state, including after settlement', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'checkout-http-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dataFile = join(directory, 'store.json');
  const f = await fixture(t, { dataFile });
  const before = await readFile(dataFile);
  const metadata = await stat(dataFile, { bigint: true });
  f.advance(2000);
  // Read the order first: completion must not depend on polling the payment.
  const order = (await f.call('GET', `/api/orders/${f.order.id}`)).json().data;
  assert.equal(order.status, 'paid');
  assert.equal(order.paymentStatus, 'succeeded');
  for (const [url, methods] of Object.entries(f.paths)) {
    if (methods.includes('GET')) {
      await f.call('GET', url);
      await f.call('HEAD', url);
    }
    await f.call('OPTIONS', url, undefined, 204);
  }
  assert.equal(
    (await f.call('GET', `/api/payments/${f.payment.id}`)).json().data.status,
    'succeeded',
  );
  assert.equal(
    (await f.call('GET', `${f.simulationUrl}/${f.simulation.id}`)).json().data.status,
    'succeeded',
  );
  assert.deepEqual(await readFile(dataFile), before);
  const after = await stat(dataFile, { bigint: true });
  assert.equal(after.mtimeNs, metadata.mtimeNs);
  assert.equal(after.ino, metadata.ino);
});

test('PUT and DELETE are idempotent; POST replays and asynchronous monitor have accurate status codes', async (t) => {
  const f = await fixture(t);
  const itemUrl = '/api/cart/items/lamp-orbit';
  const version = (await f.call('GET', '/api/cart')).json().data.version;
  await f.call('PUT', itemUrl, { quantity: 1 });
  await f.call('PUT', itemUrl, { quantity: 1 });
  assert.equal((await f.call('GET', '/api/cart')).json().data.version, version);
  await f.call('PUT', itemUrl, { quantity: 2 });
  assert.equal((await f.call('GET', '/api/cart')).json().data.version, version + 1);
  const removed = await f.call('DELETE', itemUrl, undefined, 204);
  assert.equal(removed.headers.link, '</api/cart>; rel="collection"');
  assert.equal(removed.headers['content-length'], undefined);
  await f.call('DELETE', itemUrl, undefined, 204);
  assert.equal((await f.call('GET', '/api/cart')).json().data.version, version + 2);
  assert.equal(
    (await f.call('POST', '/api/orders', f.body, 200, { 'idempotency-key': f.orderKey })).json()
      .data.id,
    f.order.id,
  );
  assert.equal(
    (await f.call('POST', f.paymentUrl, {}, 200, { 'idempotency-key': f.paymentKey })).json().data
      .id,
    f.payment.id,
  );
  const replay = await f.call('POST', f.simulationUrl, { scenario: 'success' }, 202);
  assert.equal(replay.json().data.id, f.simulation.id);
  assert.equal((await f.call('GET', replay.headers.location)).json().data.status, 'processing');
  f.advance(2000);
  const terminal = await f.call('POST', f.simulationUrl, { scenario: 'success' });
  assert.equal(terminal.json().data.id, f.simulation.id);
  assert.equal(terminal.json().data.status, 'succeeded');
  assert.equal(terminal.headers['retry-after'], undefined);
  assert.equal(terminal.headers.location, undefined);
});

test('authentication challenges, unsupported media, malformed bodies and public utility routes', async (t) => {
  const f = await fixture(t);
  const protectedPaths = Object.entries(f.paths).filter(
    ([path, methods]) =>
      methods.includes('GET') && !['/api', '/api/products', '/api/sandbox'].includes(path),
  );
  for (const [url] of protectedPaths) {
    for (const method of ['GET', 'HEAD']) {
      const missing = await f.app.inject({ method, url });
      assert.equal(missing.statusCode, 401, url);
      assert.equal(missing.headers['www-authenticate'], 'Bearer realm="checkout"');
      if (method === 'HEAD') assert.equal(missing.body, '');
      const invalid = await f.app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${randomUUID()}` },
      });
      assert.equal(invalid.statusCode, 401);
      assert.equal(
        invalid.headers['www-authenticate'],
        'Bearer realm="checkout", error="invalid_token"',
      );
    }
  }
  for (const [method, url] of [
    ['GET', '/api/cart'],
    ['HEAD', '/api/cart'],
    ['DELETE', '/api/cart/items/lamp-orbit'],
  ]) {
    const result = await f.app.inject({
      method,
      url,
      payload: {},
      headers: { authorization: `Bearer ${f.session.token}` },
    });
    assert.equal(result.statusCode, 400);
    if (method !== 'HEAD') assert.equal(result.json().error.code, 'REQUEST_BODY_NOT_ALLOWED');
  }
  for (const [contentType, payload, expected] of [
    ['text/plain', '{}', 415],
    ['application/xml', '<x/>', 415],
    ['application/json', '{', 400],
    ['application/json', '{"extra":true}', 400],
    ['application/json', JSON.stringify({ value: 'x'.repeat(33000) }), 413],
  ]) {
    const result = await f.app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload,
      headers: { 'content-type': contentType },
    });
    assert.equal(result.statusCode, expected, `${contentType} ${expected}`);
  }
  assert.equal(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/sessions',
        payload: '{}',
        headers: { 'content-type': 'application/json; charset=utf-8' },
      })
    ).statusCode,
    201,
  );
  for (const method of ['GET', 'HEAD', 'OPTIONS', 'PATCH']) {
    assert.equal((await f.app.inject({ method, url: '/api/unknown' })).statusCode, 404);
  }
  const query = await f.app.inject({ method: 'GET', url: '/api?test=1' });
  assert.equal(query.statusCode, 200);
  assert.equal(query.headers['cache-control'], 'no-store');
  for (const url of ['/health', '/openapi.json', '/docs/', '/docs/static/swagger-ui-bundle.js']) {
    assert.equal((await f.app.inject({ method: 'GET', url })).statusCode, 200, url);
    const head = await f.app.inject({ method: 'HEAD', url });
    assert.equal(head.statusCode, 200, url);
    assert.equal(head.body, '');
    assert.equal((await f.app.inject({ method: 'OPTIONS', url })).statusCode, 204, url);
    const wrong = await f.app.inject({ method: 'POST', url });
    assert.equal(wrong.statusCode, 405, url);
    assert.equal(wrong.headers.allow, 'GET, HEAD, OPTIONS');
  }
  const root = await f.app.inject({ method: 'GET', url: '/' });
  assert.equal(root.statusCode, 302);
  assert.equal(root.headers.location, '/docs/');
  const productsOperation = f.doc.paths['/api/products'].get;
  assert.deepEqual(Object.keys(productsOperation.responses).sort(), [
    '200',
    '304',
    '400',
    '412',
    '500',
  ]);
});

test('zero-delay simulation returns 201 when created, then 200 on replay', async (t) => {
  const f = await fixture(t, { paymentDelayMs: 0 });
  assert.equal(f.simulation.status, 'succeeded');
  const replay = await f.call('POST', f.simulationUrl, { scenario: 'success' });
  assert.equal(replay.json().data.id, f.simulation.id);
  assert.equal(replay.headers['retry-after'], undefined);
});

test('resource links follow checkout state and omit actions that are no longer available', async (t) => {
  const f = await fixture(t);
  const cart = await f.call('GET', '/api/cart');
  assert.equal(cart.json().links.createQuote.href, '/api/quotes');
  const quote = await f.call(
    'POST',
    '/api/quotes',
    { cartVersion: cart.json().data.version, delivery },
    201,
  );
  assert.equal(quote.json().links.createOrder.href, '/api/orders');
  f.advance(10 * 60 * 1000);
  assert.equal((await f.call('GET', quote.headers.location)).json().links.createOrder, undefined);
  await f.call('DELETE', '/api/cart/items/lamp-orbit', undefined, 204);
  assert.equal((await f.call('GET', '/api/cart')).json().links.createQuote, undefined);
  assert.equal((await f.call('GET', '/api/checkout/options')).json().links.createQuote, undefined);
  const paid = await f.call('GET', `/api/orders/${f.order.id}`);
  assert.equal(paid.json().data.status, 'paid');
  assert.equal(paid.json().links.createPayment, undefined);
  const payment = await f.call('GET', `/api/payments/${f.payment.id}`);
  assert.equal(payment.json().links.createSimulation, undefined);
});

test('conditional writes fail before mutation; missing resources and authentication keep priority', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'checkout-conditions-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'store.json');
  const f = await fixture(t, { dataFile: file });
  const cart = (await f.call('GET', '/api/cart')).json().data;
  const cases = [
    ['POST', '/api/sessions', {}],
    ['PUT', '/api/cart/items/lamp-orbit', { quantity: 2 }],
    ['DELETE', '/api/cart/items/lamp-orbit'],
    ['POST', '/api/quotes', { cartVersion: cart.version, delivery }],
    ['POST', '/api/orders', f.body, f.orderKey],
    ['POST', f.paymentUrl, {}, f.paymentKey],
    ['POST', f.simulationUrl, { scenario: 'success' }],
  ];
  const before = await readFile(file, 'utf8');
  for (const [method, url, body, key] of cases) {
    await f.call(method, url, body, 412, {
      'if-none-match': '*',
      ...(key ? { 'idempotency-key': key } : {}),
    });
    assert.equal(await readFile(file, 'utf8'), before);
  }
  const missing = `/api/orders/${randomUUID()}`;
  await f.call('GET', missing, undefined, 404, { 'if-none-match': '*' });
  await f.call('POST', `${missing}/payments`, {}, 404, {
    'if-none-match': '*',
    'idempotency-key': randomUUID(),
  });
  assert.equal(
    (await f.app.inject({ method: 'GET', url: '/api/cart', headers: { 'if-none-match': '*' } }))
      .statusCode,
    401,
  );
  await f.call('DELETE', '/api/cart/items/lamp-orbit', undefined, 204);
  await f.call('PUT', '/api/cart/items/lamp-orbit', { quantity: 1 }, 412, { 'if-match': '*' });
  await f.call('PUT', '/api/cart/items/lamp-orbit', { quantity: 1 }, 201, { 'if-none-match': '*' });
  await f.call('PUT', '/api/cart/items/lamp-orbit', { quantity: 2 }, 412, { 'if-none-match': '*' });
  assert.equal((await f.call('GET', '/api/cart')).json().data.items[0].quantity, 1);
});

test('unsupported request coding is 415 and conditional lists accept empty members', async (t) => {
  const f = await fixture(t);
  for (const [method, url, body] of [
    ['POST', '/api/sessions', {}],
    ['PUT', '/api/cart/items/lamp-orbit', { quantity: 2 }],
  ]) {
    const rejected = await f.call(method, url, body, 415, { 'content-encoding': 'gzip' });
    assert.equal(rejected.json().error.code, 'UNSUPPORTED_CONTENT_ENCODING');
    assert.equal(rejected.headers['accept-encoding'], 'identity');
  }
  await f.call('POST', '/api/sessions', Buffer.from([0xff]), 400, {
    'content-type': 'application/json',
  });
  await f.call('GET', '/api', undefined, 200, { 'if-none-match': ', "unused",,' });
  await f.call('GET', '/api', undefined, 200, { 'if-none-match': '' });
  await f.call('GET', '/api', undefined, 412, { 'if-match': '' });
  await f.call('GET', '/api', undefined, 400, { 'if-match': '*, "other"' });
});
