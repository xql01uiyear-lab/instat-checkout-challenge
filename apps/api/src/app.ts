import { preconditions, conditionalRead } from './http.js';
import Fastify, {
  type FastifySchema,
  type FastifyReply,
  type FastifyRequest,
  type HTTPMethods,
} from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { randomUUID } from 'node:crypto';
import { isUtf8 } from 'node:buffer';
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import * as C from '@checkout/contracts';
import { deliveryMethods, paymentMethods, products, testCards } from './catalog.js';
import { DomainError, Store } from './store.js';

declare module 'fastify' {
  interface FastifyRequest {
    sessionToken: string;
  }
}
type Options = {
  dataFile?: string;
  paymentDelayMs?: number;
  logger?: boolean;
  corsOrigins?: string[];
  now?: () => number;
};
type Request = FastifyRequest<{ Params: Record<string, string>; Body: unknown }>;
type Links = Static<typeof C.Links>;
type Route = {
  current?: (request: Request) => boolean;
  tag: string;
  id: string;
  summary: string;
  data?: TSchema;
  statuses?: number[];
  errors?: Record<number, string>;
  body?: TSchema;
  params?: TSchema;
  headers?: TSchema;
  description?: string;
  public?: boolean;
};
const link = (href: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET') => ({
  href,
  method,
});
const idParams = (name: string) => Type.Object({ [name]: C.Id }, { additionalProperties: false });
const productParams = Type.Object(
  { productId: Type.String({ minLength: 1, maxLength: 100 }) },
  { additionalProperties: false },
);
const metadataHeaders = { 'X-Request-Id': Type.String(), 'Cache-Control': Type.String() };
const isApiUrl = (url: string) => /^\/api(?:\/|$)/.test(url.split('?')[0]);

// OpenAPI 3.0 uses example; JSON Schema uses examples.
function openApiAnnotations(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(openApiAnnotations);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) =>
      key === 'examples' && Array.isArray(item)
        ? ['example', item[0]]
        : [key, openApiAnnotations(item)],
    ),
  );
}

export async function buildApp(options: Options = {}) {
  const app = Fastify({
    logger: options.logger
      ? { redact: ['req.headers.authorization', 'req.headers["idempotency-key"]'] }
      : false,
    bodyLimit: 32768,
    genReqId: () => randomUUID(),
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false } },
  });
  const store = new Store(options.dataFile, options.paymentDelayMs ?? 1200, options.now);
  const parseJson = app.getDefaultJsonParser('error', 'error');
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    if (!isUtf8(body as Buffer))
      return done(new DomainError(400, 'INVALID_UTF8', 'JSON должен быть в UTF-8.'));
    parseJson(request, (body as Buffer).toString('utf8'), done);
  });

  const allowedMethods = (url: string) => {
    const path = url.split('?')[0];
    const methods: HTTPMethods[] = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'TRACE'];
    const allowed = methods.filter((method) => app.findRoute({ method, url: path }));
    return allowed.length ? [...allowed, 'OPTIONS'].sort() : undefined;
  };
  app.addSchema({ $id: 'ErrorResponse', ...C.ErrorResponse });
  app.decorateRequest('sessionToken', '');
  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Request-Id', request.id);
    if (isApiUrl(request.url)) reply.header('Cache-Control', 'no-store');
  });
  await app.register(cors, {
    origin(origin, callback) {
      callback(
        null,
        !origin ||
          /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin) ||
          Boolean(options.corsOrigins?.includes(origin)),
      );
    },
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'If-Match',
      'If-None-Match',
    ],
    exposedHeaders: [
      'X-Request-Id',
      'Location',
      'Link',
      'Retry-After',
      'WWW-Authenticate',
      'Allow',
      'Accept-Encoding',
    ],
    preflightContinue: true,
    strictPreflight: false,
  });
  app.addHook('onRequest', async (request, reply) => {
    const allowed = allowedMethods(request.url);
    if (request.method === 'OPTIONS') {
      if (request.url === '*')
        return reply.header('Allow', 'GET, HEAD, POST, PUT, DELETE, OPTIONS').code(204).send();
      if (!allowed) throw new DomainError(404, 'ROUTE_NOT_FOUND', 'Маршрут не найден.');
      reply.header('Allow', allowed.join(', ')).header('Cache-Control', 'no-store');
      if (request.headers.origin) reply.header('Access-Control-Allow-Methods', allowed.join(', '));
      return reply.code(204).send();
    }
    if (allowed && !allowed.includes(request.method)) {
      reply.header('Allow', allowed.join(', '));
      throw new DomainError(405, 'METHOD_NOT_ALLOWED', 'Метод не поддерживается для этого адреса.');
    }
    if (!isApiUrl(request.url)) return;
    const hasBody =
      Number(request.headers['content-length'] ?? 0) > 0 ||
      request.headers['transfer-encoding'] !== undefined;
    if (['GET', 'HEAD', 'DELETE'].includes(request.method) && hasBody)
      throw new DomainError(400, 'REQUEST_BODY_NOT_ALLOWED', 'Этот запрос не принимает тело.');
    if (
      hasBody &&
      request.headers['content-encoding'] !== undefined &&
      request.headers['content-encoding'].trim().toLowerCase() !== 'identity'
    ) {
      reply.header('Accept-Encoding', 'identity');
      throw new DomainError(
        415,
        'UNSUPPORTED_CONTENT_ENCODING',
        'Сжатое тело запроса не поддерживается.',
      );
    }
    if (
      ['POST', 'PUT'].includes(request.method) &&
      hasBody &&
      request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json'
    )
      throw new DomainError(
        415,
        'UNSUPPORTED_MEDIA_TYPE',
        'Передайте тело в формате application/json.',
      );
  });
  app.addHook('onSend', async (request, reply, payload) => {
    if (
      /^\/api(?:\/|$)/.test(request.url.split('?')[0]) ||
      request.url.split('?')[0] === '/assets/demo.svg'
    )
      return conditionalRead(request, reply, payload);
    return payload;
  });
  await app.register(swagger, {
    transform: ({ schema, url }) => ({ schema: openApiAnnotations(schema) as FastifySchema, url }),
    transformObject(document) {
      if (!('openapiObject' in document)) return document.swaggerObject;
      const { openapiObject } = document;
      for (const path of Object.values(openapiObject.paths ?? {})) {
        if (!path) continue;
        const baseOperation = path.get ?? path.post ?? path.put ?? path.delete;
        if (path.get)
          path.head = {
            ...path.get,
            operationId: `head_${path.get.operationId}`,
            summary: `Заголовки: ${path.get.summary}`,
            responses: Object.fromEntries(
              Object.entries(path.get.responses).map(([status, response]) => {
                const copy = { ...response };
                if ('content' in copy) delete copy.content;
                return [status, copy];
              }),
            ),
          };
        path.options = {
          operationId: `options_${baseOperation?.operationId}`,
          tags: ['HTTP'],
          summary: 'Разрешённые методы',
          security: [],
          responses: {
            '204': {
              description: 'Без тела.',
              headers: {
                Allow: { schema: { type: 'string' } },
                'X-Request-Id': { schema: { type: 'string' } },
                'Cache-Control': { schema: { type: 'string' } },
              },
            },
          },
        };
      }
      return openapiObject;
    },
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Checkout API',
        version: '1.0.0',
        description:
          'POST /api/sessions с телом {} создаёт гостевую сессию. Вставьте data.token в Authorize без слова Bearer. Суммы указаны в копейках. Данные сохраняются после перезапуска. Оплата тестовая.',
      },
      servers: [{ url: '/', description: 'Текущий сервер' }],
      components: {
        securitySchemes: {
          guestSession: { type: 'http', scheme: 'bearer', bearerFormat: 'Guest token' },
        },
      },
      tags: [
        'Discovery',
        'Session',
        'Catalog',
        'Cart',
        'Checkout',
        'Orders',
        'Payments',
        'Sandbox',
        'HTTP',
      ].map((name) => ({ name })),
    },
  });
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', persistAuthorization: true },
    staticCSP: true,
  });
  app.setErrorHandler((error, request, reply) => {
    const err = error as Error & {
      validation?: {
        instancePath: string;
        message?: string;
        params: { missingProperty?: string };
      }[];
      validationContext?: string;
      statusCode?: number;
    };
    const status =
      err instanceof DomainError
        ? err.status
        : err.validation
          ? 400
          : err.statusCode && err.statusCode < 500
            ? err.statusCode
            : 500;
    const code =
      err instanceof DomainError
        ? err.code
        : err.validation
          ? 'VALIDATION_ERROR'
          : status === 413
            ? 'PAYLOAD_TOO_LARGE'
            : status === 415
              ? 'UNSUPPORTED_MEDIA_TYPE'
              : status === 400
                ? 'INVALID_REQUEST'
                : 'INTERNAL_ERROR';
    const message =
      err instanceof DomainError
        ? err.message
        : status === 500
          ? 'Не удалось выполнить запрос.'
          : 'Проверьте формат и поля запроса.';
    const fields = err.validation?.map((issue) => ({
      path: `${err.validationContext ?? 'body'}${issue.instancePath}${issue.params.missingProperty ? `/${issue.params.missingProperty}` : ''}`,
      message: issue.message ?? 'Некорректное значение.',
    }));
    if (status === 401)
      reply.header(
        'WWW-Authenticate',
        code === 'SESSION_REQUIRED'
          ? 'Bearer realm="checkout"'
          : 'Bearer realm="checkout", error="invalid_token"',
      );
    if (status === 500) request.log.error({ err }, 'Request failed');
    reply.removeHeader('ETag').removeHeader('Location').removeHeader('Retry-After');
    reply.status(status).send({
      error: { code, message, ...(fields ? { fields } : {}) },
      meta: { requestId: request.id },
    });
  });
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: { code: 'ROUTE_NOT_FOUND', message: 'Маршрут не найден.' },
      meta: { requestId: request.id },
    }),
  );
  app.get('/', { schema: { hide: true } }, async (_r, reply) => reply.redirect('/docs/'));
  app.get('/health', { schema: { hide: true } }, async () => ({ status: 'ok' }));
  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  const authorize = async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    if (!header)
      throw new DomainError(401, 'SESSION_REQUIRED', 'Передайте токен сессии в Authorization.');
    const match = /^Bearer +([0-9a-f-]{36})$/i.exec(header);
    if (!match) throw new DomainError(401, 'SESSION_INVALID', 'Некорректный токен сессии.');
    store.session(match[1]);
    request.sessionToken = match[1];
  };
  function add(
    method: HTTPMethods,
    url: string,
    route: Route,
    handler: (request: Request, reply: FastifyReply) => unknown,
  ) {
    const errors = {
      400: 'VALIDATION_ERROR, INVALID_REQUEST или REQUEST_BODY_NOT_ALLOWED.',
      500: 'INTERNAL_ERROR.',
      412: 'PRECONDITION_FAILED: условие запроса не выполнено.',
      ...(!route.public ? { 401: 'SESSION_REQUIRED или SESSION_INVALID.' } : {}),
      ...(route.body
        ? {
            413: 'PAYLOAD_TOO_LARGE: максимум 32 КБ.',
            415: 'UNSUPPORTED_MEDIA_TYPE или UNSUPPORTED_CONTENT_ENCODING: нужен JSON без сжатия.',
          }
        : {}),
      ...route.errors,
    };
    const responses: Record<string, unknown> = Object.fromEntries(
      (route.statuses ?? [200]).map((status) => [
        status,
        status === 204
          ? {
              type: 'null',
              description: 'Без тела. Повторное удаление также возвращает 204.',
              headers: { ...metadataHeaders, Link: Type.String() },
            }
          : {
              ...C.envelope(route.data!),
              description:
                status === 201
                  ? 'Ресурс создан.'
                  : status === 202
                    ? 'Обработка принята и ещё не завершена.'
                    : 'Текущее состояние ресурса.',
              headers: {
                ...metadataHeaders,
                ...([201, 202].includes(status)
                  ? {
                      Location: Type.String({
                        description:
                          status === 202 ? 'Адрес проверки статуса.' : 'Адрес созданного ресурса.',
                      }),
                    }
                  : {}),
                ...(status === 202
                  ? {
                      'Retry-After': Type.String({
                        description: 'Рекомендуемая пауза в секундах.',
                      }),
                    }
                  : {}),
              },
            },
      ]),
    );
    if (method === 'GET')
      responses[304] = {
        type: 'null',
        description: 'Условие If-None-Match совпало; без тела.',
        headers: metadataHeaders,
      };
    for (const [status, description] of Object.entries(errors))
      responses[status] = {
        $ref: 'ErrorResponse#',
        description,
        headers: {
          ...metadataHeaders,
          ...(status === '401' ? { 'WWW-Authenticate': Type.String() } : {}),
          ...(status === '415'
            ? {
                'Accept-Encoding': Type.String({
                  description: 'Только при неподдерживаемом Content-Encoding: identity.',
                }),
              }
            : {}),
        },
      };
    app.route({
      method,
      url,
      schema: {
        tags: [route.tag],
        operationId: route.id,
        summary: route.summary,
        description: route.description,
        ...(route.body ? { body: route.body } : {}),
        ...(route.params ? { params: route.params } : {}),
        headers: Type.Object({
          'if-match': Type.Optional(
            Type.String({
              description:
                'Условие для ресурса по адресу запроса. ETag выдаётся только там, где указан в ответе.',
            }),
          ),
          'if-none-match': Type.Optional(
            Type.String({ description: 'Совпадение: 304 для GET/HEAD, 412 для изменения.' }),
          ),
          ...(route.headers?.properties ?? {}),
        }),
        response: responses,
        security: route.public ? [] : [{ guestSession: [] }],
      },
      onRequest: route.public ? undefined : authorize,
      preHandler: async (request) => {
        if (!['GET', 'HEAD'].includes(request.method)) {
          // Look up parent/item before conditions so a missing resource stays 404.
          if (
            request.headers['if-match'] !== undefined ||
            request.headers['if-none-match'] !== undefined
          )
            preconditions(request, route.current?.(request as Request) ?? true);
        }
      },
      handler,
    });
  }
  function respond<T>(r: FastifyRequest, reply: FastifyReply, data: T, links: Links, status = 200) {
    if ([201, 202].includes(status)) reply.header('Location', links.self.href);
    if (status === 202) reply.header('Retry-After', '1');
    return reply.code(status).send({ data, meta: { requestId: r.id }, links });
  }
  const orderLinks = (order: C.Order): Links => ({
    self: link(`/api/orders/${order.id}`),
    payments: link(`/api/orders/${order.id}/payments`),
    cart: link('/api/cart'),
    ...(order.paymentMethod === 'card' && !['succeeded', 'pending'].includes(order.paymentStatus)
      ? { createPayment: link(`/api/orders/${order.id}/payments`, 'POST') }
      : {}),
  });
  const paymentLinks = (payment: C.Payment): Links => ({
    self: link(`/api/payments/${payment.id}`),
    order: link(`/api/orders/${payment.orderId}`),
    ...(payment.status === 'pending'
      ? { createSimulation: link(`/api/payments/${payment.id}/simulations`, 'POST') }
      : {}),
  });
  const quoteLinks = (q: C.Quote, token: string): Links => ({
    self: link(`/api/quotes/${q.id}`),
    cart: link('/api/cart'),
    ...(Date.parse(q.expiresAt) > (options.now?.() ?? Date.now()) &&
    store.cart(token).version === q.cartVersion
      ? { createOrder: link('/api/orders', 'POST') }
      : {}),
  });
  const simulationLinks = (s: C.Simulation): Links => ({
    self: link(`/api/payments/${s.paymentId}/simulations/${s.id}`),
    payment: link(`/api/payments/${s.paymentId}`),
  });

  add(
    'GET',
    '/api',
    {
      tag: 'Discovery',
      id: 'getApi',
      summary: 'Ресурсы API',
      public: true,
      data: Type.Object({ name: Type.String(), version: Type.String() }),
    },
    (r, p) =>
      respond(
        r,
        p,
        { name: 'Checkout API', version: '1.0.0' },
        {
          self: link('/api'),
          createSession: link('/api/sessions', 'POST'),
          products: link('/api/products'),
          sandbox: link('/api/sandbox'),
          contract: link('/openapi.json'),
        },
      ),
  );
  add(
    'POST',
    '/api/sessions',
    {
      tag: 'Session',
      id: 'createSession',
      summary: 'Создать гостевую сессию',
      public: true,
      body: C.EmptyBody,
      data: C.SessionSchema,
      statuses: [201],
    },
    (r, p) => {
      const s = store.createSession();
      return respond(
        r,
        p,
        s,
        {
          self: link(`/api/sessions/${s.id}`),
          cart: link('/api/cart'),
          products: link('/api/products'),
          orders: link('/api/orders'),
        },
        201,
      );
    },
  );
  add(
    'GET',
    '/api/products',
    {
      tag: 'Catalog',
      id: 'listProducts',
      summary: 'Каталог товаров',
      public: true,
      data: Type.Array(C.ProductSchema),
    },
    (r, p) =>
      respond(r, p, products, {
        self: link('/api/products'),
        cart: link('/api/cart'),
        ...Object.fromEntries(
          products
            .filter((v) => v.stock > 0)
            .map((v) => [`add_${v.id}`, link(`/api/cart/items/${v.id}`, 'PUT')]),
        ),
      }),
  );
  add(
    'GET',
    '/api/sandbox',
    {
      tag: 'Sandbox',
      id: 'getSandbox',
      summary: 'Тестовые карты',
      public: true,
      data: C.SandboxSchema,
    },
    (r, p) =>
      respond(
        r,
        p,
        { cards: testCards, settlementDelayMs: store.paymentDelayMs },
        { self: link('/api/sandbox') },
      ),
  );
  add(
    'GET',
    '/api/sessions/:sessionId',
    {
      tag: 'Session',
      id: 'getSession',
      summary: 'Гостевая сессия',
      params: idParams('sessionId'),
      data: C.SessionInfoSchema,
      errors: { 404: 'SESSION_NOT_FOUND.' },
    },
    (r, p) =>
      respond(r, p, store.sessionInfo(r.sessionToken, r.params.sessionId), {
        self: link(`/api/sessions/${r.params.sessionId}`),
        cart: link('/api/cart'),
        orders: link('/api/orders'),
      }),
  );
  add(
    'GET',
    '/api/cart',
    { tag: 'Cart', id: 'getCart', summary: 'Корзина', data: C.CartSchema },
    (r, p) => {
      const cart = store.cart(r.sessionToken);
      return respond(r, p, cart, {
        self: link('/api/cart'),
        checkoutOptions: link('/api/checkout/options'),
        ...(cart.items.length ? { createQuote: link('/api/quotes', 'POST') } : {}),
        ...Object.fromEntries(
          cart.items.map((i) => [`item_${i.productId}`, link(`/api/cart/items/${i.productId}`)]),
        ),
      });
    },
  );
  add(
    'GET',
    '/api/cart/items/:productId',
    {
      tag: 'Cart',
      id: 'getCartItem',
      summary: 'Позиция корзины',
      params: productParams,
      data: C.CartItemSchema,
      errors: { 404: 'CART_ITEM_NOT_FOUND.' },
    },
    (r, p) =>
      respond(r, p, store.item(r.sessionToken, r.params.productId), {
        self: link(`/api/cart/items/${r.params.productId}`),
        cart: link('/api/cart'),
        replace: link(`/api/cart/items/${r.params.productId}`, 'PUT'),
        remove: link(`/api/cart/items/${r.params.productId}`, 'DELETE'),
      }),
  );
  add(
    'PUT',
    '/api/cart/items/:productId',
    {
      tag: 'Cart',
      id: 'setCartItem',
      current: (r) => {
        if (!products.some((p) => p.id === r.params.productId))
          throw new DomainError(404, 'PRODUCT_NOT_FOUND', 'Товар не найден.');
        return store.cart(r.sessionToken).items.some((i) => i.productId === r.params.productId);
      },
      summary: 'Установить количество товара',
      params: productParams,
      body: C.SetCartItemBody,
      data: C.CartItemSchema,
      statuses: [200, 201],
      errors: { 404: 'PRODUCT_NOT_FOUND.', 409: 'INSUFFICIENT_STOCK.' },
      description:
        'quantity — полное изменяемое состояние позиции; остальные поля вычисляет сервер. Количество абсолютное. Новая позиция: 201, существующая: 200. Повтор того же количества не меняет версию корзины. Новые итоги получите через GET /api/cart.',
    },
    (r, p) => {
      const value = store.setItem(
        r.sessionToken,
        r.params.productId,
        (r.body as Static<typeof C.SetCartItemBody>).quantity,
      );
      return respond(
        r,
        p,
        value.item,
        { self: link(`/api/cart/items/${r.params.productId}`), cart: link('/api/cart') },
        value.created ? 201 : 200,
      );
    },
  );
  add(
    'DELETE',
    '/api/cart/items/:productId',
    {
      tag: 'Cart',
      id: 'removeCartItem',
      current: (r) =>
        store.cart(r.sessionToken).items.some((i) => i.productId === r.params.productId),
      summary: 'Удалить позицию корзины',
      params: productParams,
      statuses: [204],
      description:
        'Тело запроса не принимается. Отсутствующая позиция также даёт 204. Итоги доступны через GET /api/cart.',
    },
    (r, p) => {
      store.removeItem(r.sessionToken, r.params.productId);
      return p.header('Link', '</api/cart>; rel="collection"').code(204).send();
    },
  );
  add(
    'GET',
    '/api/checkout/options',
    {
      tag: 'Checkout',
      id: 'getCheckoutOptions',
      summary: 'Способы доставки и оплаты',
      data: C.CheckoutOptionsSchema,
    },
    (r, p) => {
      const cart = store.cart(r.sessionToken);
      return respond(
        r,
        p,
        { cart, deliveryMethods, paymentMethods },
        {
          self: link('/api/checkout/options'),
          ...(cart.items.length ? { createQuote: link('/api/quotes', 'POST') } : {}),
          cart: link('/api/cart'),
        },
      );
    },
  );
  add(
    'POST',
    '/api/quotes',
    {
      tag: 'Checkout',
      id: 'createQuote',
      summary: 'Создать расчёт заказа',
      body: C.QuoteBody,
      data: C.QuoteSchema,
      statuses: [201],
      errors: { 409: 'CART_VERSION_CONFLICT.', 422: 'CART_EMPTY.' },
      description: 'Расчёт действует 10 минут и привязан к версии корзины и выбранной доставке.',
    },
    (r, p) => {
      const body = r.body as Static<typeof C.QuoteBody>;
      const q = store.quote(r.sessionToken, body.cartVersion, body.delivery);
      return respond(r, p, q, quoteLinks(q, r.sessionToken), 201);
    },
  );
  add(
    'GET',
    '/api/quotes/:quoteId',
    {
      tag: 'Checkout',
      id: 'getQuote',
      summary: 'Расчёт заказа',
      params: idParams('quoteId'),
      data: C.QuoteSchema,
      errors: { 404: 'QUOTE_NOT_FOUND.' },
      description:
        'Сохранённый расчёт остаётся доступен и после expiresAt; создать по нему заказ после этого времени нельзя.',
    },
    (r, p) => {
      const q = store.getQuote(r.sessionToken, r.params.quoteId);
      return respond(r, p, q, quoteLinks(q, r.sessionToken));
    },
  );
  add(
    'POST',
    '/api/orders',
    {
      tag: 'Orders',
      id: 'createOrder',
      summary: 'Создать заказ',
      body: C.CreateOrderBody,
      headers: C.IdempotencyHeaders,
      data: C.OrderSchema,
      statuses: [200, 201],
      errors: {
        404: 'QUOTE_NOT_FOUND.',
        409: 'QUOTE_EXPIRED, CART_VERSION_CONFLICT или IDEMPOTENCY_CONFLICT.',
      },
      description:
        'Корзина очищается после создания заказа. Повтор с теми же телом и ключом возвращает 200 и тот же заказ в его текущем состоянии.',
    },
    (r, p) => {
      const value = store.createOrder(
        r.sessionToken,
        r.body as C.CreateOrder,
        r.headers['idempotency-key'] as string,
      );
      return respond(r, p, value.data, orderLinks(value.data), value.created ? 201 : 200);
    },
  );
  add(
    'GET',
    '/api/orders',
    {
      tag: 'Orders',
      id: 'listOrders',
      summary: 'Заказы сессии',
      data: Type.Array(C.OrderSchema),
      description: 'От новых к старым.',
    },
    (r, p) => {
      const orders = store.orders(r.sessionToken);
      return respond(r, p, orders, {
        self: link('/api/orders'),
        ...Object.fromEntries(orders.map((o) => [`order_${o.id}`, link(`/api/orders/${o.id}`)])),
      });
    },
  );
  add(
    'GET',
    '/api/orders/:orderId',
    {
      tag: 'Orders',
      id: 'getOrder',
      summary: 'Заказ и статус оплаты',
      params: idParams('orderId'),
      data: C.OrderSchema,
      errors: { 404: 'ORDER_NOT_FOUND.' },
      description:
        'Для карты успех означает paid / succeeded. Для наличных: confirmed / unpaid. Запрос не меняет данные.',
    },
    (r, p) => {
      const o = store.order(r.sessionToken, r.params.orderId);
      return respond(r, p, o, orderLinks(o));
    },
  );
  add(
    'GET',
    '/api/orders/:orderId/payments',
    {
      tag: 'Payments',
      id: 'listPayments',
      summary: 'Попытки оплаты заказа',
      params: idParams('orderId'),
      data: Type.Array(C.PaymentSchema),
      errors: { 404: 'ORDER_NOT_FOUND.' },
      description: 'От новых к старым.',
    },
    (r, p) => {
      const values = store.payments(r.sessionToken, r.params.orderId);
      return respond(r, p, values, {
        self: link(`/api/orders/${r.params.orderId}/payments`),
        order: link(`/api/orders/${r.params.orderId}`),
        ...Object.fromEntries(
          values.map((v) => [`payment_${v.id}`, link(`/api/payments/${v.id}`)]),
        ),
      });
    },
  );
  add(
    'POST',
    '/api/orders/:orderId/payments',
    {
      tag: 'Payments',
      id: 'createPayment',
      current: (r) => Boolean(store.order(r.sessionToken, r.params.orderId)),
      summary: 'Создать попытку оплаты',
      params: idParams('orderId'),
      body: C.EmptyBody,
      headers: C.IdempotencyHeaders,
      data: C.PaymentSchema,
      statuses: [200, 201],
      errors: {
        404: 'ORDER_NOT_FOUND.',
        409: 'PAYMENT_NOT_REQUIRED, ORDER_ALREADY_PAID или PAYMENT_IN_PROGRESS.',
      },
      description:
        'Тело: {}. Повтор по ключу возвращает 200. После failed/cancelled используйте новый ключ. Одновременно у заказа может быть только одна активная попытка.',
    },
    (r, p) => {
      const value = store.createPayment(
        r.sessionToken,
        r.params.orderId,
        r.headers['idempotency-key'] as string,
      );
      return respond(r, p, value.data, paymentLinks(value.data), value.created ? 201 : 200);
    },
  );
  add(
    'GET',
    '/api/payments/:paymentId',
    {
      tag: 'Payments',
      id: 'getPayment',
      summary: 'Статус попытки оплаты',
      params: idParams('paymentId'),
      data: C.PaymentSchema,
      errors: { 404: 'PAYMENT_NOT_FOUND.' },
      description:
        'Опрашивайте раз в 500–1000 мс до succeeded, failed или cancelled. Запрос не меняет данные.',
    },
    (r, p) => {
      const value = store.payment(r.sessionToken, r.params.paymentId);
      return respond(r, p, value, paymentLinks(value));
    },
  );
  add(
    'POST',
    '/api/payments/:paymentId/simulations',
    {
      tag: 'Sandbox',
      id: 'createSimulation',
      current: (r) => Boolean(store.payment(r.sessionToken, r.params.paymentId)),
      summary: 'Создать имитацию оплаты',
      params: idParams('paymentId'),
      body: C.SimulateBody,
      data: C.SimulationSchema,
      statuses: [200, 201, 202],
      errors: { 404: 'PAYMENT_NOT_FOUND.', 409: 'PAYMENT_FINALIZED.' },
      description:
        'На попытку оплаты приходится одна имитация. 202 во время обработки; при нулевой задержке новая имитация сразу завершается и возвращает 201. Повтор сценария возвращает существующий результат: 202 во время обработки, 200 после завершения. Смена сценария запрещена.',
    },
    (r, p) => {
      const value = store.simulate(
        r.sessionToken,
        r.params.paymentId,
        (r.body as Static<typeof C.SimulateBody>).scenario,
      );
      return respond(
        r,
        p,
        value.data,
        simulationLinks(value.data),
        value.data.status === 'processing' ? 202 : value.created ? 201 : 200,
      );
    },
  );
  add(
    'GET',
    '/api/payments/:paymentId/simulations/:simulationId',
    {
      tag: 'Sandbox',
      id: 'getSimulation',
      summary: 'Статус имитации оплаты',
      params: Type.Object({ paymentId: C.Id, simulationId: C.Id }, { additionalProperties: false }),
      data: C.SimulationSchema,
      errors: { 404: 'PAYMENT_NOT_FOUND или SIMULATION_NOT_FOUND.' },
    },
    (r, p) => {
      const value = store.simulation(r.sessionToken, r.params.paymentId, r.params.simulationId);
      return respond(r, p, value, simulationLinks(value));
    },
  );
  await app.ready();
  return app;
}
