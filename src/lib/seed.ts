// Seed demo data for first-run experience
import type {
  Transaction, Budget, Goal, Member, Debt, Asset, Profile, ExchangeRates,
} from '../types';
import { DEFAULT_RATES } from '../constants';
import { uid, today, nowMonthKey } from './format';

export interface SeedBundle {
  members: Member[];
  goals: Goal[];
  debts: Debt[];
  assets: Asset[];
  transactions: Transaction[];
  budgets: Budget[];
  profile: Profile;
  exchangeRates: ExchangeRates;
}

export function buildSeed(): SeedBundle {
  const mk = nowMonthKey();
  const [y, m] = mk.split('-').map(Number);
  const prev1 = m === 1 ? `${y-1}-12` : `${y}-${String(m-1).padStart(2,'0')}`;
  const prev2m = m <= 2 ? (m === 1 ? 11 : 12) : m - 2;
  const prev2y = m <= 2 ? y - 1 : y;
  const prev2 = `${prev2y}-${String(prev2m).padStart(2,'0')}`;

  const alexId = uid(), samId = uid(), miaId = uid();

  const members: Member[] = [
    { id: alexId, name: 'Alex', role: 'primary' },
    { id: samId,  name: 'Sam',  role: 'partner' },
    { id: miaId,  name: 'Mia',  role: 'child'   },
  ];

  const goals: Goal[] = [
    { id: uid(), type:'emergency',  name:'6-Month Emergency Fund',  target:18000, current:9200, deadline:`${y+1}-06-30`, completed:false, currency:'USD' },
    { id: uid(), type:'savings',    name:'Family Vacation — Japan', target:6000,  current:2400, deadline:`${y}-12-01`,   completed:false, currency:'USD' },
    { id: uid(), type:'investment', name:'Index Fund Target',       target:25000, current:8400,                           completed:false, currency:'USD' },
    { id: uid(), type:'debt',       name:'Pay off Credit Card',     target:6500,  current:1200, deadline:`${y+1}-09-01`, completed:false, currency:'USD' },
  ];

  const debts: Debt[] = [
    { id: uid(), type:'mortgage',     name:'Home Mortgage',        lender:'Wells Fargo',    account:'7821', principal:380000, currentBalance:312500, interestRate:6.25,  minimumPayment:2340, tenureMonths:360, dueDate:`${y}-${String(m+1).padStart(2,'0')}-01`, currency:'USD' },
    { id: uid(), type:'auto_loan',    name:'Honda Civic Loan',     lender:'Honda Financial',account:'4412', principal:24000,  currentBalance:11200,  interestRate:4.95,  minimumPayment:485,  tenureMonths:60,  dueDate:`${y}-${String(m+1).padStart(2,'0')}-15`, currency:'USD' },
    { id: uid(), type:'credit_card',  name:'Chase Sapphire',       lender:'Chase Bank',     account:'9907', principal:5000,   currentBalance:5300,   interestRate:22.74, minimumPayment:140,                     dueDate:`${y}-${String(m+1).padStart(2,'0')}-22`, currency:'USD' },
    { id: uid(), type:'student_loan', name:'Federal Student Loan', lender:'Nelnet',         account:'2204', principal:42000,  currentBalance:18750,  interestRate:5.05,  minimumPayment:280,  tenureMonths:120, dueDate:`${y}-${String(m+1).padStart(2,'0')}-08`, currency:'USD' },
  ];

  const assets: Asset[] = [
    { id: uid(), type:'checking',    name:'Chase Checking',     value:6800,   currency:'USD', liquidity:'liquid', note:'Primary' },
    { id: uid(), type:'savings',     name:'Marcus High-Yield',  value:9200,   currency:'USD', liquidity:'liquid', note:'Emergency fund' },
    { id: uid(), type:'cash',        name:'Cash on Hand',       value:450,    currency:'USD', liquidity:'liquid' },
    { id: uid(), type:'investment',  name:'Vanguard Brokerage', value:48200,  currency:'USD', liquidity:'short' },
    { id: uid(), type:'retirement',  name:'401(k) — Alex',      value:124500, currency:'USD', liquidity:'long' },
    { id: uid(), type:'retirement',  name:'Roth IRA — Sam',     value:62300,  currency:'USD', liquidity:'long' },
    { id: uid(), type:'real_estate', name:'Primary Home',       value:485000, currency:'USD', liquidity:'long', note:'Market estimate' },
    { id: uid(), type:'vehicle',     name:'2020 Honda Civic',   value:18500,  currency:'USD', liquidity:'long' },
  ];

  const transactions: Transaction[] = [
    { id:uid(), type:'income',  amount:5200, category:'salary',      description:'Monthly Salary',     date:`${mk}-01`, memberId:alexId, recurring:'monthly', currency:'USD', paymentMethod:'chase' },
    { id:uid(), type:'income',  amount:4800, category:'salary',      description:"Sam's Salary",       date:`${mk}-01`, memberId:samId,  recurring:'monthly', currency:'USD', paymentMethod:'bofa' },
    { id:uid(), type:'income',  amount:950,  category:'freelance',   description:'Design Consulting',  date:`${mk}-08`, memberId:alexId, currency:'USD', note:'UI project', paymentMethod:'paypal' },
    { id:uid(), type:'expense', amount:2340, category:'rent_mortgage',        description:'Mortgage Payment',   date:`${mk}-01`, memberId:alexId, recurring:'monthly', currency:'USD', paymentMethod:'wells' },
    { id:uid(), type:'expense', amount:280,  category:'food_dining',        description:'Weekly Groceries',   date:`${mk}-05`, memberId:samId,  recurring:'weekly',  currency:'USD', note:'Whole Foods', paymentMethod:'visa' },
    { id:uid(), type:'expense', amount:95,   category:'transport',   description:'Bus Pass',           date:`${mk}-02`, memberId:alexId, recurring:'monthly', currency:'USD', paymentMethod:'cash' },
    { id:uid(), type:'expense', amount:44,   category:'entertainment',description:'Netflix & Spotify', date:`${mk}-03`, memberId:alexId, recurring:'monthly', currency:'USD', paymentMethod:'amex' },
    { id:uid(), type:'expense', amount:130,  category:'health',      description:'Gym Membership',     date:`${mk}-04`, memberId:samId,  recurring:'monthly', currency:'USD', paymentMethod:'visa' },
    { id:uid(), type:'expense', amount:185,  category:'shopping',    description:'Clothing',           date:`${mk}-10`, memberId:samId,  currency:'USD', paymentMethod:'mastercard' },
    { id:uid(), type:'expense', amount:88,   category:'utilities',   description:'Electricity Bill',   date:`${mk}-07`, memberId:alexId, recurring:'monthly', currency:'USD', paymentMethod:'chase' },
    { id:uid(), type:'expense', amount:62,   category:'utilities',   description:'Internet Bill',      date:`${mk}-07`, memberId:alexId, recurring:'monthly', currency:'USD', note:'Comcast', paymentMethod:'chase' },
    { id:uid(), type:'expense', amount:120,  category:'childcare',   description:"Mia's School Fees",  date:`${mk}-06`, memberId:miaId,  currency:'USD', paymentMethod:'check' },
    { id:uid(), type:'expense', amount:320,  category:'food_dining',        description:'Restaurants',        date:`${mk}-14`, memberId:alexId, currency:'USD', note:'Family', paymentMethod:'amex' },
    { id:uid(), type:'investment', amount:500, category:'', description:'Vanguard Buy',  date:`${mk}-15`, memberId:alexId, recurring:'monthly', currency:'USD', paymentMethod:'chase', note:'DCA into VTSAX' },
    { id:uid(), type:'expense', amount:18500, category:'travel',     description:'Trip to Mumbai',     date:`${mk}-12`, memberId:alexId, currency:'INR', note:'Foreign currency demo · stored in INR', paymentMethod:'hdfc' },
    // Last month
    { id:uid(), type:'income',  amount:5200, category:'salary',      description:'Monthly Salary',     date:`${prev1}-01`, memberId:alexId, recurring:'monthly', currency:'USD', paymentMethod:'chase' },
    { id:uid(), type:'income',  amount:4800, category:'salary',      description:"Sam's Salary",       date:`${prev1}-01`, memberId:samId,  recurring:'monthly', currency:'USD', paymentMethod:'bofa' },
    { id:uid(), type:'income',  amount:320,  category:'investment',  description:'Dividend Income',    date:`${prev1}-20`, memberId:alexId, currency:'USD', paymentMethod:'chase' },
    { id:uid(), type:'expense', amount:2340, category:'rent_mortgage',        description:'Mortgage',           date:`${prev1}-01`, memberId:alexId, recurring:'monthly', currency:'USD', paymentMethod:'wells' },
    { id:uid(), type:'expense', amount:310,  category:'food_dining',        description:'Groceries',          date:`${prev1}-05`, memberId:samId,  currency:'USD', paymentMethod:'visa' },
    { id:uid(), type:'expense', amount:240,  category:'shopping',    description:'Amazon',             date:`${prev1}-11`, memberId:samId,  currency:'USD', paymentMethod:'amex' },
    { id:uid(), type:'expense', amount:380,  category:'travel',      description:'Weekend Getaway',    date:`${prev1}-16`, memberId:alexId, currency:'USD', paymentMethod:'amex' },
    { id:uid(), type:'investment', amount:500, category:'', description:'Vanguard Buy',  date:`${prev1}-15`, memberId:alexId, recurring:'monthly', currency:'USD', paymentMethod:'chase' },
    // 2 months ago
    { id:uid(), type:'income',  amount:5200, category:'salary',      description:'Monthly Salary',     date:`${prev2}-01`, memberId:alexId, recurring:'monthly', currency:'USD', paymentMethod:'chase' },
    { id:uid(), type:'income',  amount:4800, category:'salary',      description:"Sam's Salary",       date:`${prev2}-01`, memberId:samId,  recurring:'monthly', currency:'USD', paymentMethod:'bofa' },
    { id:uid(), type:'expense', amount:2340, category:'rent_mortgage',        description:'Mortgage',           date:`${prev2}-01`, memberId:alexId, recurring:'monthly', currency:'USD', paymentMethod:'wells' },
    { id:uid(), type:'expense', amount:295,  category:'food_dining',        description:'Groceries',          date:`${prev2}-06`, memberId:samId,  currency:'USD', paymentMethod:'visa' },
    { id:uid(), type:'expense', amount:650,  category:'education',   description:'Online Courses',     date:`${prev2}-10`, memberId:alexId, currency:'USD', note:'Udemy', paymentMethod:'paypal' },
    { id:uid(), type:'income',  amount:600,  category:'freelance',   description:'Freelance Project',  date:`${prev2}-18`, memberId:alexId, currency:'USD', note:'Logo design', paymentMethod:'paypal' },
  ];

  const budgets: Budget[] = [
    { id:uid(), category:'food_dining',          limit:850, color:'#E8A87C', currency:'USD' },
    { id:uid(), category:'transport',     limit:200, color:'#4A6FA5', currency:'USD' },
    { id:uid(), category:'entertainment', limit:80,  color:'#6E4555', currency:'USD' },
    { id:uid(), category:'shopping',      limit:300, color:'#E26D5C', currency:'USD' },
    { id:uid(), category:'health',        limit:200, color:'#85A88A', currency:'USD' },
    { id:uid(), category:'utilities',     limit:200, color:'#F4D27A', currency:'USD' },
    { id:uid(), category:'childcare',     limit:300, color:'#F4B6A8', currency:'USD' },
  ];

  const profile: Profile = {
    name: 'Alex Morgan',
    email: 'alex@example.com',
    baseCurrency: 'USD',
    language: 'en',
    household: 'family',
    dateFormat: 'us',
    payoffStrategy: 'avalanche',
    extraPayment: 200,
  };

  return { members, goals, debts, assets, transactions, budgets, profile, exchangeRates: { ...DEFAULT_RATES } };
}
