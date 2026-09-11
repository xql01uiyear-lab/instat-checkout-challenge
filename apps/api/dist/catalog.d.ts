import type { Product } from '@checkout/contracts';
export declare const products: Product[];
export declare const deliveryMethods: ({
    id: "pickup";
    title: string;
    price: number;
    freeFrom: null;
    pickupPoints: {
        id: string;
        title: string;
        address: string;
    }[];
} | {
    id: "courier";
    title: string;
    price: number;
    freeFrom: number;
    pickupPoints: never[];
})[];
export declare const paymentMethods: ({
    id: "card";
    title: string;
} | {
    id: "cash_on_delivery";
    title: string;
})[];
export declare const testCards: ({
    id: string;
    title: string;
    maskedNumber: string;
    scenario: "success";
} | {
    id: string;
    title: string;
    maskedNumber: string;
    scenario: "decline";
})[];
