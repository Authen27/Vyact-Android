// W8d (audit OPS-05) — build gate for Vercel PREVIEW builds: the bundle must not name the production
// Supabase project. vite.config.ts turns a preview local-only when it has no URL or production's URL;
// this proves it on the built files, so a future env mistake fails the preview instead of shipping a
// branch build that reads and writes real households. Production and local builds skip the check.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROD_SUPABASE_REF = 'dmxqkvploojokffuhxnz';

export function findProdRef(dir, ref = PROD_SUPABASE_REF) {
  const hits = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      if (/\.(m?js|html|json|webmanifest)$/.test(name) && readFileSync(p, 'utf8').includes(ref)) hits.push(relative(dir, p));
    }
  };
  walk(dir);
  return hits;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.env.VERCEL_ENV !== 'preview') process.exit(0);
  const dist = fileURLToPath(new URL('../dist', import.meta.url));
  const hits = findProdRef(dist);
  if (hits.length) {
    console.error(`✗ Preview build names the production Supabase project (OPS-05):\n  ${hits.join('\n  ')}`);
    process.exit(1);
  }
  console.log('✓ Preview build is isolated from production');
}
