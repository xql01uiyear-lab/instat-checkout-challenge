import Fastify from 'fastify';
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
export declare function buildApp(options?: Options): Promise<Fastify.FastifyInstance<import("http").Server<typeof import("http").IncomingMessage, typeof import("http").ServerResponse>, import("http").IncomingMessage, import("http").ServerResponse<import("http").IncomingMessage>, Fastify.FastifyBaseLogger, Fastify.FastifyTypeProviderDefault>>;
export {};
