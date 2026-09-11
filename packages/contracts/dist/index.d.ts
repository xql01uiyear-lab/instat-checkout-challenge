import { type Static, type TSchema } from '@sinclair/typebox';
export declare const Id: import("@sinclair/typebox").TString;
export declare const EmptyBody: import("@sinclair/typebox").TObject<{}>;
export declare const Meta: import("@sinclair/typebox").TObject<{
    requestId: import("@sinclair/typebox").TString;
}>;
export declare const Links: import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TObject<{
    href: import("@sinclair/typebox").TString;
    method: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"GET">, import("@sinclair/typebox").TLiteral<"POST">, import("@sinclair/typebox").TLiteral<"PUT">, import("@sinclair/typebox").TLiteral<"DELETE">]>;
}>>;
export declare const envelope: <T extends TSchema>(data: T) => import("@sinclair/typebox").TObject<{
    data: T;
    meta: import("@sinclair/typebox").TObject<{
        requestId: import("@sinclair/typebox").TString;
    }>;
    links: import("@sinclair/typebox").TRecord<import("@sinclair/typebox").TString, import("@sinclair/typebox").TObject<{
        href: import("@sinclair/typebox").TString;
        method: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"GET">, import("@sinclair/typebox").TLiteral<"POST">, import("@sinclair/typebox").TLiteral<"PUT">, import("@sinclair/typebox").TLiteral<"DELETE">]>;
    }>>;
}>;
export declare const ErrorResponse: import("@sinclair/typebox").TObject<{
    error: import("@sinclair/typebox").TObject<{
        code: import("@sinclair/typebox").TString;
        message: import("@sinclair/typebox").TString;
        fields: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
            path: import("@sinclair/typebox").TString;
            message: import("@sinclair/typebox").TString;
        }>>>;
    }>;
    meta: import("@sinclair/typebox").TObject<{
        requestId: import("@sinclair/typebox").TString;
    }>;
}>;
export declare const ProductSchema: import("@sinclair/typebox").TObject<{
    id: import("@sinclair/typebox").TString;
    sku: import("@sinclair/typebox").TString;
    title: import("@sinclair/typebox").TString;
    description: import("@sinclair/typebox").TString;
    price: import("@sinclair/typebox").TInteger;
    currency: import("@sinclair/typebox").TLiteral<"RUB">;
    stock: import("@sinclair/typebox").TInteger;
}>;
export declare const CartItemSchema: import("@sinclair/typebox").TObject<{
    productId: import("@sinclair/typebox").TString;
    title: import("@sinclair/typebox").TString;
    unitPrice: import("@sinclair/typebox").TInteger;
    quantity: import("@sinclair/typebox").TInteger;
    lineTotal: import("@sinclair/typebox").TInteger;
}>;
export declare const CartSchema: import("@sinclair/typebox").TObject<{
    id: import("@sinclair/typebox").TString;
    version: import("@sinclair/typebox").TInteger;
    items: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        productId: import("@sinclair/typebox").TString;
        title: import("@sinclair/typebox").TString;
        unitPrice: import("@sinclair/typebox").TInteger;
        quantity: import("@sinclair/typebox").TInteger;
        lineTotal: import("@sinclair/typebox").TInteger;
    }>>;
    quantity: import("@sinclair/typebox").TInteger;
    subtotal: import("@sinclair/typebox").TInteger;
    currency: import("@sinclair/typebox").TLiteral<"RUB">;
}>;
export declare const SetCartItemBody: import("@sinclair/typebox").TObject<{
    quantity: import("@sinclair/typebox").TInteger;
}>;
export declare const AddressSchema: import("@sinclair/typebox").TObject<{
    city: import("@sinclair/typebox").TString;
    street: import("@sinclair/typebox").TString;
    house: import("@sinclair/typebox").TString;
    apartment: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
}>;
export declare const DeliverySchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
    method: import("@sinclair/typebox").TLiteral<"pickup">;
    pickupPointId: import("@sinclair/typebox").TString;
}>, import("@sinclair/typebox").TObject<{
    method: import("@sinclair/typebox").TLiteral<"courier">;
    address: import("@sinclair/typebox").TObject<{
        city: import("@sinclair/typebox").TString;
        street: import("@sinclair/typebox").TString;
        house: import("@sinclair/typebox").TString;
        apartment: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
    }>;
}>]>;
export declare const PaymentMethodSchema: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"card">, import("@sinclair/typebox").TLiteral<"cash_on_delivery">]>;
export declare const CustomerSchema: import("@sinclair/typebox").TObject<{
    name: import("@sinclair/typebox").TString;
    email: import("@sinclair/typebox").TString;
    phone: import("@sinclair/typebox").TString;
}>;
export declare const CheckoutOptionsSchema: import("@sinclair/typebox").TObject<{
    cart: import("@sinclair/typebox").TObject<{
        id: import("@sinclair/typebox").TString;
        version: import("@sinclair/typebox").TInteger;
        items: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
            productId: import("@sinclair/typebox").TString;
            title: import("@sinclair/typebox").TString;
            unitPrice: import("@sinclair/typebox").TInteger;
            quantity: import("@sinclair/typebox").TInteger;
            lineTotal: import("@sinclair/typebox").TInteger;
        }>>;
        quantity: import("@sinclair/typebox").TInteger;
        subtotal: import("@sinclair/typebox").TInteger;
        currency: import("@sinclair/typebox").TLiteral<"RUB">;
    }>;
    deliveryMethods: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        id: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"pickup">, import("@sinclair/typebox").TLiteral<"courier">]>;
        title: import("@sinclair/typebox").TString;
        price: import("@sinclair/typebox").TInteger;
        freeFrom: import("@sinclair/typebox").TUnsafe<number | null>;
        pickupPoints: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
            id: import("@sinclair/typebox").TString;
            title: import("@sinclair/typebox").TString;
            address: import("@sinclair/typebox").TString;
        }>>;
    }>>;
    paymentMethods: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        id: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"card">, import("@sinclair/typebox").TLiteral<"cash_on_delivery">]>;
        title: import("@sinclair/typebox").TString;
    }>>;
}>;
export declare const QuoteBody: import("@sinclair/typebox").TObject<{
    cartVersion: import("@sinclair/typebox").TInteger;
    delivery: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
        method: import("@sinclair/typebox").TLiteral<"pickup">;
        pickupPointId: import("@sinclair/typebox").TString;
    }>, import("@sinclair/typebox").TObject<{
        method: import("@sinclair/typebox").TLiteral<"courier">;
        address: import("@sinclair/typebox").TObject<{
            city: import("@sinclair/typebox").TString;
            street: import("@sinclair/typebox").TString;
            house: import("@sinclair/typebox").TString;
            apartment: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        }>;
    }>]>;
}>;
export declare const QuoteSchema: import("@sinclair/typebox").TObject<{
    id: import("@sinclair/typebox").TString;
    cartVersion: import("@sinclair/typebox").TInteger;
    items: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        productId: import("@sinclair/typebox").TString;
        title: import("@sinclair/typebox").TString;
        unitPrice: import("@sinclair/typebox").TInteger;
        quantity: import("@sinclair/typebox").TInteger;
        lineTotal: import("@sinclair/typebox").TInteger;
    }>>;
    delivery: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
        method: import("@sinclair/typebox").TLiteral<"pickup">;
        pickupPointId: import("@sinclair/typebox").TString;
    }>, import("@sinclair/typebox").TObject<{
        method: import("@sinclair/typebox").TLiteral<"courier">;
        address: import("@sinclair/typebox").TObject<{
            city: import("@sinclair/typebox").TString;
            street: import("@sinclair/typebox").TString;
            house: import("@sinclair/typebox").TString;
            apartment: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        }>;
    }>]>;
    subtotal: import("@sinclair/typebox").TInteger;
    shipping: import("@sinclair/typebox").TInteger;
    total: import("@sinclair/typebox").TInteger;
    currency: import("@sinclair/typebox").TLiteral<"RUB">;
    expiresAt: import("@sinclair/typebox").TString;
}>;
export declare const CreateOrderBody: import("@sinclair/typebox").TObject<{
    quoteId: import("@sinclair/typebox").TString;
    customer: import("@sinclair/typebox").TObject<{
        name: import("@sinclair/typebox").TString;
        email: import("@sinclair/typebox").TString;
        phone: import("@sinclair/typebox").TString;
    }>;
    paymentMethod: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"card">, import("@sinclair/typebox").TLiteral<"cash_on_delivery">]>;
}>;
export declare const OrderSchema: import("@sinclair/typebox").TObject<{
    id: import("@sinclair/typebox").TString;
    number: import("@sinclair/typebox").TString;
    status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"awaiting_payment">, import("@sinclair/typebox").TLiteral<"paid">, import("@sinclair/typebox").TLiteral<"confirmed">]>;
    paymentStatus: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"unpaid">, import("@sinclair/typebox").TLiteral<"pending">, import("@sinclair/typebox").TLiteral<"succeeded">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"cancelled">]>;
    paymentMethod: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"card">, import("@sinclair/typebox").TLiteral<"cash_on_delivery">]>;
    customer: import("@sinclair/typebox").TObject<{
        name: import("@sinclair/typebox").TString;
        email: import("@sinclair/typebox").TString;
        phone: import("@sinclair/typebox").TString;
    }>;
    items: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        productId: import("@sinclair/typebox").TString;
        title: import("@sinclair/typebox").TString;
        unitPrice: import("@sinclair/typebox").TInteger;
        quantity: import("@sinclair/typebox").TInteger;
        lineTotal: import("@sinclair/typebox").TInteger;
    }>>;
    delivery: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TObject<{
        method: import("@sinclair/typebox").TLiteral<"pickup">;
        pickupPointId: import("@sinclair/typebox").TString;
    }>, import("@sinclair/typebox").TObject<{
        method: import("@sinclair/typebox").TLiteral<"courier">;
        address: import("@sinclair/typebox").TObject<{
            city: import("@sinclair/typebox").TString;
            street: import("@sinclair/typebox").TString;
            house: import("@sinclair/typebox").TString;
            apartment: import("@sinclair/typebox").TOptional<import("@sinclair/typebox").TString>;
        }>;
    }>]>;
    subtotal: import("@sinclair/typebox").TInteger;
    shipping: import("@sinclair/typebox").TInteger;
    total: import("@sinclair/typebox").TInteger;
    currency: import("@sinclair/typebox").TLiteral<"RUB">;
    createdAt: import("@sinclair/typebox").TString;
}>;
export declare const PaymentSchema: import("@sinclair/typebox").TObject<{
    id: import("@sinclair/typebox").TString;
    orderId: import("@sinclair/typebox").TString;
    status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"pending">, import("@sinclair/typebox").TLiteral<"processing">, import("@sinclair/typebox").TLiteral<"succeeded">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"cancelled">]>;
    amount: import("@sinclair/typebox").TInteger;
    currency: import("@sinclair/typebox").TLiteral<"RUB">;
    createdAt: import("@sinclair/typebox").TString;
    failureCode: import("@sinclair/typebox").TUnsafe<"CARD_DECLINED" | null>;
}>;
export declare const SimulateBody: import("@sinclair/typebox").TObject<{
    scenario: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"success">, import("@sinclair/typebox").TLiteral<"decline">, import("@sinclair/typebox").TLiteral<"cancel">]>;
}>;
export declare const SimulationSchema: import("@sinclair/typebox").TObject<{
    id: import("@sinclair/typebox").TString;
    paymentId: import("@sinclair/typebox").TString;
    scenario: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"success">, import("@sinclair/typebox").TLiteral<"decline">, import("@sinclair/typebox").TLiteral<"cancel">]>;
    status: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"pending">, import("@sinclair/typebox").TLiteral<"processing">, import("@sinclair/typebox").TLiteral<"succeeded">, import("@sinclair/typebox").TLiteral<"failed">, import("@sinclair/typebox").TLiteral<"cancelled">]>;
}>;
export declare const SandboxSchema: import("@sinclair/typebox").TObject<{
    settlementDelayMs: import("@sinclair/typebox").TInteger;
    cards: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
        id: import("@sinclair/typebox").TString;
        title: import("@sinclair/typebox").TString;
        maskedNumber: import("@sinclair/typebox").TString;
        scenario: import("@sinclair/typebox").TUnion<[import("@sinclair/typebox").TLiteral<"success">, import("@sinclair/typebox").TLiteral<"decline">]>;
    }>>;
}>;
export declare const SessionSchema: import("@sinclair/typebox").TObject<{
    id: import("@sinclair/typebox").TString;
    token: import("@sinclair/typebox").TString;
    cart: import("@sinclair/typebox").TObject<{
        id: import("@sinclair/typebox").TString;
        version: import("@sinclair/typebox").TInteger;
        items: import("@sinclair/typebox").TArray<import("@sinclair/typebox").TObject<{
            productId: import("@sinclair/typebox").TString;
            title: import("@sinclair/typebox").TString;
            unitPrice: import("@sinclair/typebox").TInteger;
            quantity: import("@sinclair/typebox").TInteger;
            lineTotal: import("@sinclair/typebox").TInteger;
        }>>;
        quantity: import("@sinclair/typebox").TInteger;
        subtotal: import("@sinclair/typebox").TInteger;
        currency: import("@sinclair/typebox").TLiteral<"RUB">;
    }>;
}>;
export declare const SessionInfoSchema: import("@sinclair/typebox").TObject<{
    id: import("@sinclair/typebox").TString;
    cartId: import("@sinclair/typebox").TString;
}>;
export declare const IdempotencyHeaders: import("@sinclair/typebox").TObject<{
    'idempotency-key': import("@sinclair/typebox").TString;
}>;
export type Product = Static<typeof ProductSchema>;
export type Cart = Static<typeof CartSchema>;
export type Delivery = Static<typeof DeliverySchema>;
export type Customer = Static<typeof CustomerSchema>;
export type Quote = Static<typeof QuoteSchema>;
export type Order = Static<typeof OrderSchema>;
export type Payment = Static<typeof PaymentSchema>;
export type Simulation = Static<typeof SimulationSchema>;
export type Scenario = Static<typeof SimulateBody>['scenario'];
export type CreateOrder = Static<typeof CreateOrderBody>;
export type ApiResult<T> = {
    data: T;
    meta: {
        requestId: string;
    };
    links: Static<typeof Links>;
};
export type ApiError = Static<typeof ErrorResponse>;
