import { rm } from 'node:fs/promises';
await rm(new URL('../.data/store.json', import.meta.url), { force: true });
await rm(new URL('../.data/store.json.tmp', import.meta.url), { force: true });
console.log(
  'Default local data cleared. Create a new session. Keep the API stopped while resetting.',
);
