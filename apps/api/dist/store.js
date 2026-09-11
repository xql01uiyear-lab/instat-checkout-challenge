import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { products } from './catalog.js';
import { DomainError } from './http.js';
export { DomainError } from './http.js';
const initialState = () => ({
    version: 1,
    nextOrder: 1,
    sessions: {},
    quotes: {},
    orders: {},
    payments: {},
    idempotency: {},
});
const canonical = (value) => {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map(canonical).join(',')}]`;
    return `{${Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
        .join(',')}}`;
};
/** The data file is owned by one API process. */
export class Store {
    file;
    paymentDelayMs;
    now;
    state;
    constructor(file, paymentDelayMs = 1200, now = Date.now) {
        this.file = file;
        this.paymentDelayMs = paymentDelayMs;
        this.now = now;
        this.state =
            file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : initialState();
        if (this.state.version !== 1)
            throw new Error('Unsupported data file. Stop the API and run npm run data:reset.');
        for (const session of Object.values(this.state.sessions))
            session.id ??= session.cart.id;
        for (const payment of Object.values(this.state.payments)) {
            if (payment.scenario)
                payment.simulationId ??= payment.id;
        }
    }
    commit(action) {
        const previous = structuredClone(this.state);
        try {
            const result = action();
            if (this.file) {
                mkdirSync(dirname(this.file), { recursive: true });
                writeFileSync(`${this.file}.tmp`, JSON.stringify(this.state), { mode: 0o600 });
                renameSync(`${this.file}.tmp`, this.file);
            }
            return result;
        }
        catch (error) {
            this.state = previous;
            throw error;
        }
    }
    iso() {
        return new Date(this.now()).toISOString();
    }
    session(token) {
        const session = Object.hasOwn(this.state.sessions, token)
            ? this.state.sessions[token]
            : undefined;
        if (!session)
            throw new DomainError(401, 'SESSION_INVALID', 'Сессия не найдена. Создайте новую гостевую сессию.');
        return session;
    }
    createSession() {
        return this.commit(() => {
            const token = randomUUID();
            const session = {
                id: randomUUID(),
                token,
                cart: {
                    id: randomUUID(),
                    version: 0,
                    items: [],
                    quantity: 0,
                    subtotal: 0,
                    currency: 'RUB',
                },
            };
            this.state.sessions[token] = session;
            return session;
        });
    }
    cart(token) {
        return this.session(token).cart;
    }
    sessionInfo(token, id) {
        const session = this.session(token);
        if (session.id !== id)
            throw new DomainError(404, 'SESSION_NOT_FOUND', 'Сессия не найдена.');
        return { id, cartId: session.cart.id };
    }
    item(token, productId) {
        const item = this.cart(token).items.find((i) => i.productId === productId);
        if (!item)
            throw new DomainError(404, 'CART_ITEM_NOT_FOUND', 'Позиция отсутствует в корзине.');
        return item;
    }
    checkVersion(cart, version) {
        if (cart.version !== version)
            throw new DomainError(409, 'CART_VERSION_CONFLICT', 'Корзина изменилась. Обновите её и повторите действие.');
    }
    recalculate(cart) {
        cart.quantity = cart.items.reduce((sum, item) => sum + item.quantity, 0);
        cart.subtotal = cart.items.reduce((sum, item) => sum + item.lineTotal, 0);
        cart.version += 1;
    }
    setItem(token, productId, quantity) {
        return this.commit(() => {
            const cart = this.cart(token);
            const product = products.find((p) => p.id === productId);
            if (!product)
                throw new DomainError(404, 'PRODUCT_NOT_FOUND', 'Товар не найден.');
            if (quantity > product.stock)
                throw new DomainError(409, 'INSUFFICIENT_STOCK', `Доступно не более ${product.stock} шт.`);
            const index = cart.items.findIndex((item) => item.productId === productId);
            if (index !== -1 && cart.items[index].quantity === quantity)
                return { item: cart.items[index], created: false };
            const item = {
                productId,
                title: product.title,
                unitPrice: product.price,
                quantity,
                lineTotal: quantity * product.price,
            };
            if (index === -1)
                cart.items.push(item);
            else
                cart.items[index] = item;
            this.recalculate(cart);
            return { item, created: index === -1 };
        });
    }
    removeItem(token, productId) {
        return this.commit(() => {
            const cart = this.cart(token);
            if (!cart.items.some((i) => i.productId === productId))
                return;
            cart.items = cart.items.filter((i) => i.productId !== productId);
            this.recalculate(cart);
        });
    }
    getQuote(token, id) {
        return this.owned(this.state.quotes, id, token, 'QUOTE_NOT_FOUND');
    }
    quote(token, version, delivery) {
        return this.commit(() => {
            const cart = this.cart(token);
            this.checkVersion(cart, version);
            if (!cart.items.length)
                throw new DomainError(422, 'CART_EMPTY', 'Добавьте товары в корзину.');
            const shipping = delivery.method === 'courier' && cart.subtotal < 500000 ? 39000 : 0;
            const quote = {
                id: randomUUID(),
                owner: token,
                cartVersion: cart.version,
                items: structuredClone(cart.items),
                delivery,
                subtotal: cart.subtotal,
                shipping,
                total: cart.subtotal + shipping,
                currency: 'RUB',
                expiresAt: new Date(this.now() + 10 * 60 * 1000).toISOString(),
            };
            this.state.quotes[quote.id] = quote;
            return quote;
        });
    }
    owned(record, id, token, code) {
        this.session(token);
        const entity = Object.hasOwn(record, id) ? record[id] : undefined;
        if (!entity || entity.owner !== token)
            throw new DomainError(404, code, 'Объект не найден в текущей сессии.');
        return entity;
    }
    deduplicate(token, scope, key, body, create, read) {
        const index = `${token}:${scope}:${key}`;
        const fingerprint = createHash('sha256').update(canonical(body)).digest('hex');
        const previous = this.state.idempotency[index];
        if (previous) {
            if (previous.fingerprint !== fingerprint)
                throw new DomainError(409, 'IDEMPOTENCY_CONFLICT', 'Этот ключ уже использован с другими данными.');
            return { data: read(previous.resourceId), created: false };
        }
        const resource = create();
        this.state.idempotency[index] = { fingerprint, resourceId: resource.id };
        return { data: resource, created: true };
    }
    createOrder(token, body, key) {
        return this.commit(() => this.deduplicate(token, 'orders', key, body, () => {
            const quote = this.owned(this.state.quotes, body.quoteId, token, 'QUOTE_NOT_FOUND');
            if (Date.parse(quote.expiresAt) <= this.now())
                throw new DomainError(409, 'QUOTE_EXPIRED', 'Расчёт устарел. Рассчитайте доставку заново.');
            const cart = this.cart(token);
            this.checkVersion(cart, quote.cartVersion);
            const order = {
                id: randomUUID(),
                owner: token,
                number: `DEMO-${String(this.state.nextOrder++).padStart(6, '0')}`,
                status: body.paymentMethod === 'card' ? 'awaiting_payment' : 'confirmed',
                paymentStatus: 'unpaid',
                paymentMethod: body.paymentMethod,
                customer: body.customer,
                items: structuredClone(quote.items),
                delivery: quote.delivery,
                subtotal: quote.subtotal,
                shipping: quote.shipping,
                total: quote.total,
                currency: 'RUB',
                createdAt: this.iso(),
            };
            this.state.orders[order.id] = order;
            cart.items = [];
            this.recalculate(cart);
            return order;
        }, (id) => this.order(token, id)));
    }
    paymentView(payment, now = this.now()) {
        if (payment.status !== 'processing' || payment.settlesAt > now)
            return { ...payment };
        const status = payment.scenario === 'success'
            ? 'succeeded'
            : payment.scenario === 'decline'
                ? 'failed'
                : 'cancelled';
        return { ...payment, status, failureCode: status === 'failed' ? 'CARD_DECLINED' : null };
    }
    orderView(order, now = this.now()) {
        const latest = Object.values(this.state.payments)
            .filter((p) => p.orderId === order.id)
            .at(-1);
        if (!latest)
            return { ...order };
        const payment = this.paymentView(latest, now);
        return {
            ...order,
            status: payment.status === 'succeeded' ? 'paid' : 'awaiting_payment',
            paymentStatus: payment.status === 'processing' ? 'pending' : payment.status,
        };
    }
    order(token, id) {
        return this.orderView(this.owned(this.state.orders, id, token, 'ORDER_NOT_FOUND'));
    }
    orders(token) {
        this.session(token);
        const now = this.now();
        return Object.values(this.state.orders)
            .filter((o) => o.owner === token)
            .reverse()
            .map((o) => this.orderView(o, now));
    }
    payments(token, orderId) {
        this.order(token, orderId);
        const now = this.now();
        return Object.values(this.state.payments)
            .filter((p) => p.owner === token && p.orderId === orderId)
            .reverse()
            .map((p) => this.paymentView(p, now));
    }
    payment(token, id) {
        return this.paymentView(this.owned(this.state.payments, id, token, 'PAYMENT_NOT_FOUND'));
    }
    createPayment(token, orderId, key) {
        return this.commit(() => this.deduplicate(token, `payments:${orderId}`, key, {}, () => {
            const order = this.order(token, orderId);
            if (order.paymentMethod !== 'card')
                throw new DomainError(409, 'PAYMENT_NOT_REQUIRED', 'Этот заказ оплачивается при получении.');
            if (order.paymentStatus === 'succeeded')
                throw new DomainError(409, 'ORDER_ALREADY_PAID', 'Заказ уже оплачен.');
            if (this.payments(token, orderId).some((p) => p.status === 'pending' || p.status === 'processing'))
                throw new DomainError(409, 'PAYMENT_IN_PROGRESS', 'У заказа уже есть активная попытка оплаты.');
            const payment = {
                id: randomUUID(),
                owner: token,
                orderId,
                status: 'pending',
                amount: order.total,
                currency: 'RUB',
                createdAt: this.iso(),
                failureCode: null,
            };
            this.state.payments[payment.id] = payment;
            this.state.orders[orderId].paymentStatus = 'pending';
            return payment;
        }, (id) => this.payment(token, id)));
    }
    simulate(token, id, scenario) {
        return this.commit(() => {
            const payment = this.owned(this.state.payments, id, token, 'PAYMENT_NOT_FOUND');
            if (payment.scenario) {
                if (payment.scenario !== scenario)
                    throw new DomainError(409, 'PAYMENT_FINALIZED', 'Сценарий этой попытки уже выбран. Создайте новую попытку после отказа или отмены.');
                return { data: this.simulation(token, id, payment.simulationId), created: false };
            }
            payment.scenario = scenario;
            payment.simulationId = randomUUID();
            payment.status = 'processing';
            payment.settlesAt = this.now() + this.paymentDelayMs;
            return { data: this.simulation(token, id, payment.simulationId), created: true };
        });
    }
    simulation(token, paymentId, simulationId) {
        const payment = this.payment(token, paymentId);
        if (!payment.scenario || payment.simulationId !== simulationId)
            throw new DomainError(404, 'SIMULATION_NOT_FOUND', 'Имитация оплаты не найдена.');
        return { id: simulationId, paymentId, scenario: payment.scenario, status: payment.status };
    }
}
