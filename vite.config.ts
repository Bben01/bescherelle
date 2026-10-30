import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Content hash of the data files, used as a cache-busting query string.
const dataVersion = createHash('sha256')
  .update(readFileSync('public/data/verbs.json'))
  .update(readFileSync('public/data/examples.json'))
  .digest('hex')
  .slice(0, 10);

export default defineConfig({
  define: { __DATA_V__: JSON.stringify(dataVersion) },
});
