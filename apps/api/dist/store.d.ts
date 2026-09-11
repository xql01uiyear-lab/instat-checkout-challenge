import type { Cart, CreateOrder, Delivery, Order, Payment, Quote, Scenario, Simulation } from '@checkout/contracts';
export { DomainError } from './http.js';
type Session = {
    id: string;
    token: string;
    cart: Cart;
};
type OwnedQuote = Quote & {
    owner: string;
};
type OwnedOrder = Order & {
    owner: string;
};
type OwnedPayment = Payment & {
    owner: string;
    scenario?: Scenario;
    simulationId?: string;
    settlesAt?: number;
};
/** The data file is owned by one API process. */
export declare class Store {
    private file?;
    readonly paymentDelayMs: number;
    private now;
    private state;
    constructor(file?: string | undefined, paymentDelayMs?: number, now?: () => number);
    private commit;
    private iso;
    session(token: string): Session;
    createSession(): Session;
    cart(token: string): {
        id: string;
        currency: "RUB";
        version: number;
        items: {
            title: string;
            quantity: number;
            productId: string;
            unitPrice: number;
            lineTotal: number;
        }[];
        quantity: number;
        subtotal: number;
    };
    sessionInfo(token: string, id: string): {
        id: string;
        cartId: string;
    };
    item(token: string, productId: string): {
        title: string;
        quantity: number;
        productId: string;
        unitPrice: number;
        lineTotal: number;
    };
    private checkVersion;
    private recalculate;
    setItem(token: string, productId: string, quantity: number): {
        item: {
            title: string;
            quantity: number;
            productId: string;
            unitPrice: number;
            lineTotal: number;
        };
        created: boolean;
    };
    removeItem(token: string, productId: string): void;
    getQuote(token: string, id: string): OwnedQuote;
    quote(token: string, version: number, delivery: Delivery): OwnedQuote;
    private owned;
    private deduplicate;
    createOrder(token: string, body: CreateOrder, key: string): {
        data: OwnedOrder;
        created: boolean;
    };
    private paymentView;
    private orderView;
    order(token: string, id: string): OwnedOrder;
    orders(token: string): OwnedOrder[];
    payments(token: string, orderId: string): OwnedPayment[];
    payment(token: string, id: string): OwnedPayment;
    createPayment(token: string, orderId: string, key: string): {
        data: OwnedPayment;
        created: boolean;
    };
    simulate(token: string, id: string, scenario: Scenario): {
        data: {
            id: string;
            status: "pending" | "succeeded" | "failed" | "cancelled" | "processing";
            scenario: "success" | "decline" | "cancel";
            paymentId: string;
        };
        created: boolean;
    };
    simulation(token: string, paymentId: string, simulationId: string): Simulation;
}
