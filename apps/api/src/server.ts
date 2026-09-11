import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
const port = Number(process.env.PORT ?? 4000);
const delay = Number(process.env.PAYMENT_DELAY_MS ?? 1200);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error('PORT must be an integer from 1 to 65535.');
if (!Number.isInteger(delay) || delay < 0 || delay > 30000)
  throw new Error('PAYMENT_DELAY_MS must be an integer from 0 to 30000.');
const host = process.env.HOST ?? '127.0.0.1';
const app = await buildApp({
  dataFile:
    process.env.DATA_FILE ?? fileURLToPath(new URL('../../../.data/store.json', import.meta.url)),
  paymentDelayMs: delay,
  logger: true,
  corsOrigins: process.env.CORS_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
});
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    void app.close().then(() => process.exit(0));
  });
await app.listen({ host, port });
console.log(`Swagger: http://${host}:${port}/docs/`);
