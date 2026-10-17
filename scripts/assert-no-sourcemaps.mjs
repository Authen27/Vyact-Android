// W7b (audit GATE-03) — build gate: the public build must not publish source maps of the private code.
// Fails (exit 1) when dist/ holds any *.map file or a JS/CSS file still points at one.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export function findSourceMapLeaks(dir) {
  const leaks = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (name.endsWith('.map')) leaks.push(`${relative(dir, p)} (map file)`);
      else if (/\.(m?js|css)$/.test(name) && /[#@] sourceMappingURL=/.test(readFileSync(p, 'utf8'))) {
        leaks.push(`${relative(dir, p)} (sourceMappingURL)`);
      }
    }
  };
  walk(dir);
  return leaks;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dist = fileURLToPath(new URL('../dist', import.meta.url));
  const leaks = findSourceMapLeaks(dist);
  if (leaks.length) {
    console.error(`✗ Source maps in the public build (GATE-03):\n  ${leaks.join('\n  ')}`);
    process.exit(1);
  }
  console.log('✓ No source maps in dist/');
}
