import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const files = [
  {
    from: resolve(root, 'src/lib/query-ids.json'),
    to: resolve(root, 'dist/lib/query-ids.json'),
  },
  {
    from: resolve(root, 'src/lib/features.json'),
    to: resolve(root, 'dist/lib/features.json'),
  },
];

for (const file of files) {
  mkdirSync(dirname(file.to), { recursive: true });
  writeFileSync(file.to, readFileSync(file.from));
}
