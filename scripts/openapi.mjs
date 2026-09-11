import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import SwaggerParser from '@apidevtools/swagger-parser';
import { buildApp } from '../apps/api/dist/app.js';

const app = await buildApp();
try {
  const spec = app.swagger();
  await SwaggerParser.validate(structuredClone(spec));
  const operations = Object.values(spec.paths).flatMap((path) =>
    Object.entries(path)
      .filter(([method]) => ['get', 'put', 'post', 'delete'].includes(method))
      .map(([, operation]) => operation),
  );
  assert.equal(operations.length, 20, 'All 20 API operations must be documented');
  assert.equal(
    new Set(operations.map((o) => o.operationId)).size,
    operations.length,
    'operationId must be unique',
  );
  const publicOperations = new Set(['getApi', 'createSession', 'listProducts', 'getSandbox']);
  for (const operation of operations) {
    assert.ok(
      operation.summary && operation.responses,
      `${operation.operationId}: documentation missing`,
    );
    if (!publicOperations.has(operation.operationId))
      assert.deepEqual(operation.security, [{ guestSession: [] }]);
  }
  const body202 =
    spec.paths['/api/payments/{paymentId}/simulations'].post.responses['202'].content[
      'application/json'
    ].schema;
  assert.ok(body202, '202 must document its JSON body');
  for (const path of Object.values(spec.paths)) {
    assert.ok(path.options?.responses['204']);
    if (path.get) {
      assert.ok(path.head);
      for (const response of Object.values(path.head.responses))
        assert.ok(!response.content, 'HEAD has no response content');
    }
    for (const operation of Object.values(path)) {
      if (!operation.responses) continue;
      for (const [status, response] of Object.entries(operation.responses)) {
        if (status === '204') assert.ok(!response.content);
        if (status === '201' || status === '202') assert.ok(response.headers.Location);
        if (status === '401') assert.ok(response.headers['WWW-Authenticate']);
      }
    }
  }
  const output = `${JSON.stringify(spec, null, 2)}\n`;
  const file = new URL('../docs/openapi.json', import.meta.url);
  if (process.argv.includes('--write')) await writeFile(file, output);
  else
    assert.equal(
      await readFile(file, 'utf8'),
      output,
      'OpenAPI changed. Run npm run docs:generate.',
    );
  console.log(
    `OpenAPI 3.0.3 valid: ${operations.length} operations; authentication and 202 response documented; snapshot current.`,
  );
} finally {
  await app.close();
}
