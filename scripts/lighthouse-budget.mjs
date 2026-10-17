// Lighthouse performance budget for the landing page (v10.53.0, master to-do #66).
//
// Runs Lighthouse (mobile, simulated throttling) RUNS times against a URL and fails if the
// MEDIAN performance score is under MIN. The median, because a single run on a shared CI
// runner swings by 10+ points. Needs a Chrome on the machine (CHROME_PATH, or the runner's).
//
//   node scripts/lighthouse-budget.mjs http://localhost:4180/ [min=90] [runs=3]
//
// Note: on localhost the analytics tag stays off (GA runs only on vyact.app; Contentsquare
// was removed in W0) and Userback waits for an interaction, so this measures the page itself.
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const url = process.argv[2] || 'http://localhost:4180/';
const MIN = Number(process.argv[3] || 90);
const RUNS = Number(process.argv[4] || 5);
const out = mkdtempSync(join(tmpdir(), 'lh-'));
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const results = [];
for (let i = 1; i <= RUNS; i++) {
  const file = join(out, `run${i}.json`);
  execFileSync(npx, ['--yes', 'lighthouse@12', url,
    '--only-categories=performance', '--form-factor=mobile', '--quiet',
    '--chrome-flags=--headless=new --no-sandbox', '--output=json', `--output-path=${file}`],
  { stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' });
  const lhr = JSON.parse(readFileSync(file, 'utf8'));
  const a = lhr.audits;
  const r = {
    score: Math.round(lhr.categories.performance.score * 100),
    fcp: a['first-contentful-paint'].displayValue,
    lcp: a['largest-contentful-paint'].displayValue,
    tbt: a['total-blocking-time'].displayValue,
    cls: a['cumulative-layout-shift'].displayValue,
  };
  results.push(r);
  console.log(`run ${i}: performance ${r.score} · FCP ${r.fcp} · LCP ${r.lcp} · TBT ${r.tbt} · CLS ${r.cls}`);
}

const median = results.map(r => r.score).sort((x, y) => x - y)[Math.floor(RUNS / 2)];
if (median < MIN) {
  console.error(`::error title=Landing performance budget::median performance ${median} < ${MIN} on ${url} (mobile)`);
  process.exit(1);
}
console.log(`✓ median performance ${median} ≥ ${MIN}`);
