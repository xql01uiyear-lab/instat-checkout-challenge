import type { FastifyRequest, FastifyReply } from 'fastify';
export declare class DomainError extends Error {
    readonly status: number;
    readonly code: string;
    constructor(status: number, code: string, message: string);
}
export declare function matchesETag(header: string, current?: string, weak?: boolean, exists?: boolean): boolean;
export declare function preconditions(request: FastifyRequest, exists?: boolean, etag?: string): 304 | undefined;
export declare function conditionalRead(request: FastifyRequest, reply: FastifyReply, payload: unknown): Promise<unknown>;
