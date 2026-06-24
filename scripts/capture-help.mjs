// Headless capture of FinFlow Help screenshots + GIFs.
// Drives the already-installed Chrome via puppeteer-core against a local
// preview build (localStorage-only mode, seeded demo data). Writes PNG frames
// straight to disk; encodes GIFs with gifenc+pngjs (pure JS, no native deps).
import puppeteer from 'puppeteer-core';
import { PNG } from 'pngjs';
import gifenc from 'gifenc';
const { GIFEncoder, quantize, applyPalette } = gifenc;
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = process.env.BASE || 'http://localhost:4178';
const OUT = path.resolve('scripts/shots');
fs.mkdirSync(OUT, { recursive: true });
const uid = () => crypto.randomUUID();

// ── seed bundle (mirrors src/lib/seed.ts, fixed to 2026-05) ──
function buildSeed() {
  const mk = '2026-05', prev1 = '2026-04', prev2 = '2026-03', y = 2026, m = 5;
  const alex = uid(), sam = uid(), mia = uid();
  const members = [
    { id: alex, name: 'Alex', role: 'primary' },
    { id: sam,  name: 'Sam',  role: 'partner' },
    { id: mia,  name: 'Mia',  role: 'child'   },
  ];
  const goals = [
    { id: uid(), type:'emergency',  name:'6-Month Emergency Fund',  target:18000, current:9200, deadline:`${y+1}-06-30`, completed:false, currency:'USD' },
    { id: uid(), type:'savings',    name:'Family Vacation — Japan', target:6000,  current:2400, deadline:`${y}-12-01`,   completed:false, currency:'USD' },
    { id: uid(), type:'investment', name:'Index Fund Target',       target:25000, current:8400,                          completed:false, currency:'USD' },
    { id: uid(), type:'debt',       name:'Pay off Credit Card',     target:6500,  current:1200, deadline:`${y+1}-09-01`, completed:false, currency:'USD' },
  ];
  const debts = [
    { id: uid(), type:'mortgage',     name:'Home Mortgage',        lender:'Wells Fargo',     account:'7821', principal:380000, currentBalance:312500, interestRate:6.25,  minimumPayment:2340, tenureMonths:360, dueDate:`${y}-06-01`, currency:'USD' },
    { id: uid(), type:'auto_loan',    name:'Honda Civic Loan',     lender:'Honda Financial', account:'4412', principal:24000,  currentBalance:11200,  interestRate:4.95,  minimumPayment:485,  tenureMonths:60,  dueDate:`${y}-06-15`, currency:'USD' },
    { id: uid(), type:'credit_card',  name:'Chase Sapphire',       lender:'Chase Bank',      account:'9907', principal:5000,   currentBalance:5300,   interestRate:22.74, minimumPayment:140,                    dueDate:`${y}-06-22`, currency:'USD' },
    { id: uid(), type:'student_loan', name:'Federal Student Loan', lender:'Nelnet',          account:'2204', principal:42000,  currentBalance:18750,  interestRate:5.05,  minimumPayment:280,  tenureMonths:120, dueDate:`${y}-06-08`, currency:'USD' },
  ];
  const assets = [
    { id: uid(), type:'checking',    name:'Chase Checking',     value:6800,   currency:'USD', liquidity:'liquid', note:'Primary' },
    { id: uid(), type:'savings',     name:'Marcus High-Yield',  value:9200,   currency:'USD', liquidity:'liquid', note:'Emergency fund' },
    { id: uid(), type:'cash',        name:'Cash on Hand',       value:450,    currency:'USD', liquidity:'liquid' },
    { id: uid(), type:'investment',  name:'Vanguard Brokerage', value:48200,  currency:'USD', liquidity:'short' },
    { id: uid(), type:'retirement',  name:'401(k) — Alex',      value:124500, currency:'USD', liquidity:'long' },
    { id: uid(), type:'retirement',  name:'Roth IRA — Sam',     value:62300,  currency:'USD', liquidity:'long' },
    { id: uid(), type:'real_estate', name:'Primary Home',       value:485000, currency:'USD', liquidity:'long', note:'Market estimate' },
    { id: uid(), type:'vehicle',     name:'2020 Honda Civic',   value:18500,  currency:'USD', liquidity:'long' },
  ];
  const transactions = [
    { id:uid(), type:'income',  amount:5200, category:'salary',       description:'Monthly Salary',    date:`${mk}-01`, memberId:alex, recurring:'monthly', currency:'USD', paymentMethod:'chase' },
    { id:uid(), type:'income',  amount:4800, category:'salary',       description:"Sam's Salary",      date:`${mk}-01`, memberId:sam,  recurring:'monthly', currency:'USD', paymentMethod:'bofa' },
    { id:uid(), type:'income',  amount:950,  category:'freelance',    description:'Design Consulting', date:`${mk}-08`, memberId:alex, currency:'USD', note:'UI project', paymentMethod:'paypal' },
    { id:uid(), type:'expense', amount:2340, category:'rent',         description:'Mortgage Payment',  date:`${mk}-01`, memberId:alex, recurring:'monthly', currency:'USD', paymentMethod:'wells' },
    { id:uid(), type:'expense', amount:280,  category:'food',         description:'Weekly Groceries',  date:`${mk}-05`, memberId:sam,  recurring:'weekly',  currency:'USD', note:'Whole Foods', paymentMethod:'visa' },
    { id:uid(), type:'expense', amount:95,   category:'transport',    description:'Bus Pass',          date:`${mk}-02`, memberId:alex, recurring:'monthly', currency:'USD', paymentMethod:'cash' },
    { id:uid(), type:'expense', amount:44,   category:'entertainment',description:'Netflix & Spotify', date:`${mk}-03`, memberId:alex, recurring:'monthly', currency:'USD', paymentMethod:'amex' },
    { id:uid(), type:'expense', amount:130,  category:'health',       description:'Gym Membership',    date:`${mk}-04`, memberId:sam,  recurring:'monthly', currency:'USD', paymentMethod:'visa' },
    { id:uid(), type:'expense', amount:185,  category:'shopping',     description:'Clothing',          date:`${mk}-10`, memberId:sam,  currency:'USD', paymentMethod:'mastercard' },
    { id:uid(), type:'expense', amount:88,   category:'utilities',    description:'Electricity Bill',  date:`${mk}-07`, memberId:alex, recurring:'monthly', currency:'USD', paymentMethod:'chase' },
    { id:uid(), type:'expense', amount:62,   category:'utilities',    description:'Internet Bill',     date:`${mk}-07`, memberId:alex, recurring:'monthly', currency:'USD', note:'Comcast', paymentMethod:'chase' },
    { id:uid(), type:'expense', amount:120,  category:'childcare',    description:"Mia's School Fees", date:`${mk}-06`, memberId:mia,  currency:'USD', paymentMethod:'check' },
    { id:uid(), type:'expense', amount:320,  category:'food',         description:'Restaurants',       date:`${mk}-14`, memberId:alex, currency:'USD', note:'Family', paymentMethod:'amex' },
    { id:uid(), type:'investment', amount:500, category:'investment_in', description:'Vanguard Buy',  date:`${mk}-15`, memberId:alex, recurring:'monthly', currency:'USD', paymentMethod:'chase', note:'DCA into VTSAX' },
    { id:uid(), type:'income',  amount:5200, category:'salary',       description:'Monthly Salary',    date:`${prev1}-01`, memberId:alex, recurring:'monthly', currency:'USD', paymentMethod:'chase' },
    { id:uid(), type:'income',  amount:4800, category:'salary',       description:"Sam's Salary",      date:`${prev1}-01`, memberId:sam,  recurring:'monthly', currency:'USD', paymentMethod:'bofa' },
    { id:uid(), type:'expense', amount:2340, category:'rent',         description:'Mortgage',          date:`${prev1}-01`, memberId:alex, recurring:'monthly', currency:'USD', paymentMethod:'wells' },
    { id:uid(), type:'expense', amount:310,  category:'food',         description:'Groceries',         date:`${prev1}-05`, memberId:sam,  currency:'USD', paymentMethod:'visa' },
    { id:uid(), type:'expense', amount:380,  category:'travel',       description:'Weekend Getaway',   date:`${prev1}-16`, memberId:alex, currency:'USD', paymentMethod:'amex' },
    { id:uid(), type:'income',  amount:5200, category:'salary',       description:'Monthly Salary',    date:`${prev2}-01`, memberId:alex, recurring:'monthly', currency:'USD', paymentMethod:'chase' },
    { id:uid(), type:'expense', amount:2340, category:'rent',         description:'Mortgage',          date:`${prev2}-01`, memberId:alex, recurring:'monthly', currency:'USD', paymentMethod:'wells' },
    { id:uid(), type:'expense', amount:295,  category:'food',         description:'Groceries',         date:`${prev2}-06`, memberId:sam,  currency:'USD', paymentMethod:'visa' },
  ];
  const budgets = [
    { id:uid(), category:'food',          limit:850, color:'#E8A87C', currency:'USD' },
    { id:uid(), category:'transport',     limit:200, color:'#4A6FA5', currency:'USD' },
    { id:uid(), category:'entertainment', limit:80,  color:'#6E4555', currency:'USD' },
    { id:uid(), category:'shopping',      limit:300, color:'#E26D5C', currency:'USD' },
    { id:uid(), category:'health',        limit:200, color:'#85A88A', currency:'USD' },
    { id:uid(), category:'utilities',     limit:200, color:'#F4D27A', currency:'USD' },
    { id:uid(), category:'childcare',     limit:300, color:'#F4B6A8', currency:'USD' },
  ];
  const profile = { name:'Alex Morgan', email:'alex@example.com', baseCurrency:'USD', language:'en', household:'family', dateFormat:'us', payoffStrategy:'avalanche', extraPayment:200 };
  const rates = { USD:1.00, EUR:0.92, GBP:0.79, INR:83.20, JPY:149.00, AUD:1.51, CAD:1.35, CHF:0.88, CNY:7.21, AED:3.67, SGD:1.34, BRL:5.05 };
  return { members, goals, debts, assets, transactions, budgets, profile, rates };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function shotBuf(page, clip) {
  return await page.screenshot({ type: 'png', ...(clip ? { clip } : {}) });
}
function writePng(name, buf) {
  const p = path.join(OUT, name + '.png');
  fs.writeFileSync(p, buf);
  console.log('wrote', p, buf.length, 'bytes');
}

// Encode an animated GIF from PNG buffers (RGBA via pngjs).
function encodeGif(name, pngBufs, delayMs) {
  const enc = GIFEncoder();
  let w = 0, h = 0;
  for (const b of pngBufs) {
    const png = PNG.sync.read(Buffer.from(b));
    w = png.width; h = png.height;
    const data = new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.length);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    enc.writeFrame(index, w, h, { palette, delay: delayMs });
  }
  enc.finish();
  const p = path.join(OUT, name + '.gif');
  fs.writeFileSync(p, enc.bytes());
  console.log('wrote', p, `${w}x${h}`, enc.bytes().length, 'bytes');
}

async function gotoRoute(page, route) {
  await page.goto(BASE + route, { waitUntil: 'networkidle0', timeout: 30000 });
  await sleep(900); // settle charts / animations
}

// boundingBox of first element whose className contains `frag`
async function boxByClassFrag(page, frag) {
  return await page.evaluate((f) => {
    const el = [...document.querySelectorAll('*')].find(e =>
      typeof e.className === 'string' && e.className.includes(f));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: r.width + 16, height: r.height + 16 };
  }, frag);
}

async function openTxnModal(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  const clicked = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /add transaction/i.test(b.innerText));
    if (btn) { btn.click(); return true; }
    return false;
  });
  if (!clicked) await page.keyboard.press('KeyN');
  await page.waitForFunction(() => !!document.querySelector('input[placeholder="e.g. Tesco grocery run"]'), { timeout: 8000 });
  await sleep(600);
}

(async () => {
  const seed = buildSeed();
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--hide-scrollbars', '--force-device-scale-factor=2'],
    defaultViewport: { width: 1340, height: 880, deviceScaleFactor: 2 },
  });
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error') console.log('PAGE ERR:', m.text()); });

  // seed localStorage before the app boots on every document
  await page.evaluateOnNewDocument((s) => {
    const set = (k, v) => localStorage.setItem(k, JSON.stringify(v));
    // Seed both new `vt_` keys and legacy `ff_` keys for compatibility.
    const list = JSON.stringify([
      { id:'local', name:'The Morgan Family', type:'family', baseCurrency:'USD', createdAt:new Date().toISOString() }]);
    localStorage.setItem('ff_profiles_list', list);
    localStorage.setItem('vt_profiles_list', list);
    localStorage.setItem('ff_active_profile', 'local');
    localStorage.setItem('vt_active_profile', 'local');
    set('ff_profile', s.profile); set('vt_profile', s.profile);
    set('ff_members', s.members); set('vt_members', s.members);
    set('ff_transactions', s.transactions); set('vt_transactions', s.transactions);
    set('ff_budgets', s.budgets); set('vt_budgets', s.budgets);
    set('ff_goals', s.goals); set('vt_goals', s.goals);
    set('ff_debts', s.debts); set('vt_debts', s.debts);
    set('ff_assets', s.assets); set('vt_assets', s.assets);
    set('ff_rates', s.rates); set('vt_rates', s.rates);
  }, seed);

  // ── static shots ──
  await gotoRoute(page, '/dashboard');
  writePng('getting-started', await shotBuf(page));
  const pulseBox = await boxByClassFrag(page, 'lg:grid-cols-[220px_1fr]');
  writePng('pulse', await shotBuf(page, pulseBox || undefined));

  await gotoRoute(page, '/budgets');
  writePng('budgets-goals', await shotBuf(page));

  await gotoRoute(page, '/debts');
  writePng('debt-networth', await shotBuf(page));

  await gotoRoute(page, '/planner');
  writePng('planner', await shotBuf(page));

  await gotoRoute(page, '/settings');
  writePng('settings', await shotBuf(page));

  // ── GIF: add a transaction ──
  await gotoRoute(page, '/dashboard');
  const addFrames = [];
  addFrames.push(await shotBuf(page));                 // dashboard
  await openTxnModal(page);
  addFrames.push(await shotBuf(page));                 // empty modal
  await page.type('input[placeholder="e.g. Tesco grocery run"]', 'Dinner with friends', { delay: 30 });
  addFrames.push(await shotBuf(page));                 // description typed
  await page.type('input[type=number][placeholder="0.00"]', '85.50', { delay: 40 });
  addFrames.push(await shotBuf(page));                 // amount typed
  await sleep(200);
  addFrames.push(await shotBuf(page));                 // hold last
  encodeGif('add-transaction', addFrames, 1100);

  // ── GIF: split a bill ──
  await gotoRoute(page, '/transactions');
  const splitFrames = [];
  await openTxnModal(page);
  splitFrames.push(await shotBuf(page));               // modal (expense default)
  await page.type('input[placeholder="e.g. Tesco grocery run"]', 'Group dinner', { delay: 25 });
  await page.type('input[type=number][placeholder="0.00"]', '120', { delay: 30 });
  splitFrames.push(await shotBuf(page));               // filled
  // tick split checkbox
  await page.evaluate(() => {
    const lbl = [...document.querySelectorAll('label')].find(l => l.innerText.includes('Split this bill'));
    lbl?.querySelector('input[type=checkbox]')?.click();
  });
  await sleep(500);
  splitFrames.push(await shotBuf(page));               // split panel open
  // add a participant row
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const add = btns.find(b => /add (participant|person|split)/i.test(b.innerText));
    add?.click();
  });
  await sleep(400);
  splitFrames.push(await shotBuf(page));               // participant row
  await sleep(150);
  splitFrames.push(await shotBuf(page));
  encodeGif('split-bill', splitFrames, 1200);

  await browser.close();
  console.log('DONE');
})().catch(e => { console.error('CAPTURE FAIL', e); process.exit(1); });
