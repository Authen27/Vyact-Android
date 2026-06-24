// Needs vs Wants mapping for expense categories
export const NEEDS_WANTS_MAP: Record<string, 'need' | 'want'> = {
  // v9 type-scoped expense keys (txn-redesign §3)
  food_dining: 'need',
  groceries: 'need',
  transport: 'need',
  rent_mortgage: 'need',
  utilities: 'need',
  shopping: 'want',
  health: 'need',
  entertainment: 'want',
  education: 'need',
  travel: 'want',
  childcare: 'need',
  insurance: 'need',
  loan_emi: 'need',
  other_expense: 'want',
};

export function needsWantsForCategory(catId: string): 'need' | 'want' | undefined {
  return NEEDS_WANTS_MAP[catId];
}
// Vyact v6 — All static lookup tables in one file.
// Categories · Currencies · Payment methods · Profile types · Goal/Asset/Debt metadata · Locales

import type { ProfileTypeKey, GoalType } from './types';

// ── CATEGORIES — v9 type-scoped sets (txn-redesign spec §3, BINDING) ─────────
// Expense = consumption only; income = source only. Transfers and investments
// carry NO category (enforced by CK_txn_category_by_type in the DB). Debt
// mechanics collapse into the single loan_emi expense category (system-split).
export const EXPENSE_CATEGORIES = [
  { id: 'food_dining',    label: 'Food & Dining',     icon: '🍽️', color: '#E8A87C' },
  { id: 'groceries',      label: 'Groceries',          icon: '🛒', color: '#85A88A' },
  { id: 'transport',      label: 'Transport',          icon: '🚗', color: '#4A6FA5' },
  { id: 'rent_mortgage',  label: 'Rent / Mortgage',    icon: '🏠', color: '#C44536' },
  { id: 'utilities',      label: 'Utilities',          icon: '⚡', color: '#F4D27A' },
  { id: 'shopping',       label: 'Shopping',           icon: '🛍️', color: '#E26D5C' },
  { id: 'health',         label: 'Health & Wellness',  icon: '💊', color: '#85A88A' },
  { id: 'entertainment',  label: 'Entertainment',      icon: '🎬', color: '#6E4555' },
  { id: 'education',      label: 'Education',          icon: '📚', color: '#6B7C53' },
  { id: 'travel',         label: 'Travel',             icon: '✈️', color: '#4A6FA5' },
  { id: 'childcare',      label: 'Childcare',          icon: '👶', color: '#F4B6A8' },
  { id: 'insurance',      label: 'Insurance',          icon: '🛡️', color: '#6B635C' },
  { id: 'loan_emi',       label: 'Loan / EMI payment', icon: '💳', color: '#C44536' }, // SYSTEM_SPLIT §6.3
  { id: 'other_expense',  label: 'Other',              icon: '📦', color: '#6B635C' },
] as const;

export const INCOME_CATEGORIES = [
  { id: 'salary',           label: 'Salary',           icon: '💼', color: '#85A88A' },
  { id: 'freelance',        label: 'Freelance',        icon: '💻', color: '#6B7C53' },
  { id: 'gift_bonus',       label: 'Gift / Bonus',     icon: '🎁', color: '#E26D5C' },
  { id: 'rental_income',    label: 'Rental income',    icon: '🏠', color: '#4A6FA5' },
  { id: 'business_revenue', label: 'Business revenue', icon: '🏢', color: '#6E4555' },
  { id: 'other_income',     label: 'Other income',     icon: '💰', color: '#85A88A' },
] as const;

// Legacy id aliases so PRE-migration local-only data still renders a sane label
// (cloud data was migrated in 20260608120000; local caches may lag one session).
export const LEGACY_CATEGORY_ALIASES: Record<string, string> = {
  food: 'food_dining', rent: 'rent_mortgage', other_exp: 'other_expense',
  gift: 'gift_bonus', rental: 'rental_income', business: 'business_revenue',
  other_inc: 'other_income', investment: 'other_income',
  debt_payment: 'loan_emi', debt_interest: 'loan_emi',
};

export const ALL_CATEGORIES = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];
export const BUDGET_COLORS = ['#E26D5C','#85A88A','#C44536','#E8A87C','#4A6FA5','#6E4555','#F4D27A','#6B7C53','#F4B6A8'];
export const MEMBER_COLORS = ['#E26D5C','#85A88A','#E8A87C','#4A6FA5','#6E4555','#6B7C53'];

export interface CategoryMeta {
  id: string;
  label: string;
  icon: string;
  color: string;
}

export const getCat = (id: string): CategoryMeta => {
  const resolved = LEGACY_CATEGORY_ALIASES[id] ?? id;
  return (ALL_CATEGORIES.find(c => c.id === resolved) as CategoryMeta)
    ?? { id, label: id, icon: '📦', color: '#6B635C' };
};

/** Money-model B2.1 — deterministic budget/category colour from a stable string
 *  hash into BUDGET_COLORS. Removes the colour picker (alpha item 2) while keeping
 *  colours consistent app-wide with zero user input. Pure + stable: the same key
 *  always maps to the same swatch. Prefers a known category's own colour. */
export function deterministicColor(key: string): string {
  const resolved = LEGACY_CATEGORY_ALIASES[key] ?? key;
  const known = ALL_CATEGORIES.find(c => c.id === resolved);
  if (known) return known.color;
  let h = 0;
  for (let i = 0; i < resolved.length; i++) h = (h * 31 + resolved.charCodeAt(i)) | 0;
  return BUDGET_COLORS[Math.abs(h) % BUDGET_COLORS.length];
}

// v9 — transfers AND investments carry no category (spec §3/§2.4): direction is
// a form control, the "kind" of a transfer is derived for display only.
export const CATEGORIES_BY_TYPE = {
  expense:    EXPENSE_CATEGORIES,
  income:     INCOME_CATEGORIES,
  investment: [] as ReadonlyArray<CategoryMeta>,
  transfer:   [] as ReadonlyArray<CategoryMeta>,
} as const;

// ── DEBT & ASSET TYPES ─────────────────────────────────────────
export const DEBT_TYPES: Record<string, { icon: string; label: string; liquidity: 'short'|'long' }> = {
  credit_card:    { icon: '💳', label: 'Credit Card',     liquidity: 'short' },
  mortgage:       { icon: '🏠', label: 'Mortgage',         liquidity: 'long' },
  auto_loan:      { icon: '🚗', label: 'Auto Loan',        liquidity: 'short' },
  student_loan:   { icon: '🎓', label: 'Student Loan',     liquidity: 'long' },
  personal_loan:  { icon: '📝', label: 'Personal Loan',    liquidity: 'short' },
  business_loan:  { icon: '🏢', label: 'Business Loan',    liquidity: 'short' },
  line_of_credit: { icon: '💼', label: 'Line of Credit',   liquidity: 'short' },
  medical:        { icon: '🏥', label: 'Medical Debt',     liquidity: 'short' },
  family:         { icon: '👪', label: 'Family Loan',      liquidity: 'short' },
  other:          { icon: '📦', label: 'Other',             liquidity: 'short' },
};

export const ASSET_TYPES: Record<string, { icon: string; label: string; liquidity: 'liquid'|'short'|'long' }> = {
  cash:        { icon: '💵', label: 'Cash',             liquidity: 'liquid' },
  checking:    { icon: '🏦', label: 'Checking',         liquidity: 'liquid' },
  savings:     { icon: '💰', label: 'Savings',          liquidity: 'liquid' },
  investment:  { icon: '📈', label: 'Investment',       liquidity: 'short' },
  retirement:  { icon: '🏛️', label: 'Retirement',       liquidity: 'long' },
  real_estate: { icon: '🏠', label: 'Real Estate',      liquidity: 'long' },
  vehicle:     { icon: '🚗', label: 'Vehicle',          liquidity: 'long' },
  business:    { icon: '🏢', label: 'Business Equity',  liquidity: 'long' },
  receivable:  { icon: '📋', label: 'Money Owed',       liquidity: 'short' },
  collectible: { icon: '💎', label: 'Collectible',      liquidity: 'long' },
};

export const GOAL_ICONS: Record<GoalType, string>  = { emergency:'🛡️', savings:'💰', debt:'⬇️', investment:'📈', purchase:'🎯', custom:'✨' };
export const GOAL_COLORS: Record<GoalType, string> = { emergency:'#4A6FA5', savings:'#85A88A', debt:'#C44536', investment:'#E8A87C', purchase:'#E26D5C', custom:'#6E4555' };
export const ROLE_LABELS: Record<string, string>   = { primary:'Primary', partner:'Partner', child:'Child', elder:'Elder' };

// ── PROFILE TYPES ──────────────────────────────────────────────
export const PROFILE_TYPES: Record<ProfileTypeKey, { icon: string; label: string; desc: string }> = {
  personal:  { icon: '👤', label: 'Personal',             desc: 'Just me' },
  family:    { icon: '👨‍👩‍👧‍👦', label: 'Family',                desc: 'Household with members' },
  business:  { icon: '🏢', label: 'Single Business',      desc: 'One company / venture' },
  multi_biz: { icon: '🏛️', label: 'Multiple Businesses',  desc: 'Holding co · several entities' },
  shared:    { icon: '🤝', label: 'Shared',               desc: 'Roommates · partner pool' },
};

// ── CURRENCIES & DEFAULT RATES ────────────────────────────────
export interface CurrencyMeta {
  symbol: string;
  name: string;
  locale: string;
  decimals: number;
}

export const CURRENCIES: Record<string, CurrencyMeta> = {
  USD: { symbol:'$',   name:'US Dollar',         locale:'en-US', decimals:2 },
  EUR: { symbol:'€',   name:'Euro',              locale:'de-DE', decimals:2 },
  GBP: { symbol:'£',   name:'British Pound',     locale:'en-GB', decimals:2 },
  INR: { symbol:'₹',   name:'Indian Rupee',      locale:'en-IN', decimals:2 },
  JPY: { symbol:'¥',   name:'Japanese Yen',      locale:'ja-JP', decimals:0 },
  AUD: { symbol:'A$',  name:'Australian Dollar', locale:'en-AU', decimals:2 },
  CAD: { symbol:'C$',  name:'Canadian Dollar',   locale:'en-CA', decimals:2 },
  CHF: { symbol:'CHF', name:'Swiss Franc',       locale:'de-CH', decimals:2 },
  CNY: { symbol:'¥',   name:'Chinese Yuan',      locale:'zh-CN', decimals:2 },
  AED: { symbol:'AED', name:'UAE Dirham',        locale:'en-AE', decimals:2 },
  SGD: { symbol:'S$',  name:'Singapore Dollar',  locale:'en-SG', decimals:2 },
  BRL: { symbol:'R$',  name:'Brazilian Real',    locale:'pt-BR', decimals:2 },
};

export const DEFAULT_RATES: Record<string, number> = {
  USD:1.00, EUR:0.92, GBP:0.79, INR:83.20, JPY:149.00,
  AUD:1.51, CAD:1.35, CHF:0.88, CNY:7.21, AED:3.67, SGD:1.34, BRL:5.05,
};

// ── PAYMENT METHODS ────────────────────────────────────────────
export interface PaymentMethodMeta {
  name: string;
  color: string;
  abbr: string;
  kind: 'cash'|'card'|'bank'|'wallet'|'crypto'|'transfer'|'check'|'other';
}

export const PAYMENT_METHODS: Record<string, PaymentMethodMeta> = {
  cash:        { name:'Cash',           color:'#85A88A', abbr:'$',  kind:'cash'    },
  bank_xfer:   { name:'Bank Transfer',  color:'#4A6FA5', abbr:'🏦', kind:'transfer'},
  check:       { name:'Check',          color:'#6B635C', abbr:'✓',  kind:'check'   },
  visa:        { name:'Visa',           color:'#1A1F71', abbr:'V',  kind:'card'    },
  mastercard:  { name:'Mastercard',     color:'#EB001B', abbr:'M',  kind:'card'    },
  amex:        { name:'American Express', color:'#2E77BB', abbr:'AX', kind:'card' },
  discover:    { name:'Discover',       color:'#FF6F00', abbr:'D',  kind:'card'    },
  rupay:       { name:'RuPay',          color:'#1B4F92', abbr:'R',  kind:'card'    },
  chase:       { name:'Chase',          color:'#117ACA', abbr:'CH', kind:'bank'    },
  bofa:        { name:'Bank of America',color:'#012169', abbr:'BA', kind:'bank'    },
  wells:       { name:'Wells Fargo',    color:'#D71E28', abbr:'WF', kind:'bank'    },
  citi:        { name:'Citi',           color:'#003B70', abbr:'CI', kind:'bank'    },
  capone:      { name:'Capital One',    color:'#D03027', abbr:'C1', kind:'bank'    },
  ally:        { name:'Ally Bank',      color:'#6A11CB', abbr:'AL', kind:'bank'    },
  marcus:      { name:'Marcus',         color:'#1A1A1A', abbr:'MG', kind:'bank'    },
  paypal:      { name:'PayPal',         color:'#003087', abbr:'PP', kind:'wallet'  },
  venmo:       { name:'Venmo',          color:'#3D95CE', abbr:'V',  kind:'wallet'  },
  cashapp:     { name:'Cash App',       color:'#00D632', abbr:'$',  kind:'wallet'  },
  zelle:       { name:'Zelle',          color:'#6D1ED4', abbr:'Z',  kind:'wallet'  },
  applepay:    { name:'Apple Pay',      color:'#000000', abbr:'',  kind:'wallet'  },
  googlepay:   { name:'Google Pay',     color:'#4285F4', abbr:'G',  kind:'wallet'  },
  hdfc:        { name:'HDFC Bank',      color:'#004C8F', abbr:'HD', kind:'bank'    },
  icici:       { name:'ICICI Bank',     color:'#F58220', abbr:'IC', kind:'bank'    },
  sbi:         { name:'State Bank',     color:'#22409A', abbr:'SB', kind:'bank'    },
  axis:        { name:'Axis Bank',      color:'#97144D', abbr:'AX', kind:'bank'    },
  paytm:       { name:'Paytm',          color:'#00B9F5', abbr:'PT', kind:'wallet'  },
  phonepe:     { name:'PhonePe',        color:'#5F259F', abbr:'PP', kind:'wallet'  },
  upi:         { name:'UPI',            color:'#097969', abbr:'⟐',  kind:'wallet'  },
  revolut:     { name:'Revolut',        color:'#0075EB', abbr:'RV', kind:'wallet'  },
  wise:        { name:'Wise',           color:'#163300', abbr:'WS', kind:'wallet'  },
  monzo:       { name:'Monzo',          color:'#FF3B30', abbr:'MZ', kind:'bank'    },
  starling:    { name:'Starling',       color:'#7433FF', abbr:'SL', kind:'bank'    },
  n26:         { name:'N26',            color:'#36A18B', abbr:'N',  kind:'bank'    },
  coinbase:    { name:'Coinbase',       color:'#0052FF', abbr:'CB', kind:'crypto'  },
  binance:     { name:'Binance',        color:'#F0B90B', abbr:'BN', kind:'crypto'  },
  other_pm:    { name:'Other',          color:'#6B635C', abbr:'?',  kind:'other'   },
};

export const PM_KIND_LABELS: Record<string, string> = {
  cash:'Cash', card:'Card', bank:'Bank', wallet:'Wallet',
  crypto:'Crypto', transfer:'Transfer', check:'Check', other:'Other',
};

// ── KEYWORD AUTO-CATEGORIZE ────────────────────────────────────
export const KEYWORD_MAP: Record<string, string[]> = {
  transport:    ['uber','lyft','taxi','bus','train','subway','metro','gas','fuel','parking','toll','ola','rapido','petrol'],
  entertainment:['netflix','spotify','hulu','disney','youtube','concert','movie','cinema','game','steam','prime','apple tv'],
  food:         ['grocery','grocer','whole foods','trader joe','safeway','kroger','aldi','restaurant','cafe','coffee','starbucks','doordash','ubereats','swiggy','zomato','pizza','sushi','burger'],
  health:       ['gym','doctor','pharmacy','hospital','dental','medical','cvs','walgreens','clinic','therapy','vitamin'],
  utilities:    ['electric','water','gas bill','internet','phone','comcast','verizon','airtel','jio','broadband'],
  shopping:     ['amazon','target','walmart','costco','ikea','h&m','zara','flipkart','myntra','nykaa','uniqlo'],
  rent:         ['rent','mortgage','lease','hoa','housing'],
  education:    ['school','tuition','course','udemy','coursera','textbook','book','library'],
  childcare:    ['daycare','babysitter','nanny','preschool','kindergarten'],
  travel:       ['hotel','airbnb','flight','airline','booking.com','expedia','makemytrip'],
  debt_payment: ['credit card payment','loan payment','mortgage payment','emi','installment'],
};

export const smartCategory = (description: string, type: 'income' | 'expense'): string => {
  if (type === 'income') return 'salary';
  const low = description.toLowerCase();
  for (const [cat, kws] of Object.entries(KEYWORD_MAP)) {
    if (kws.some(k => low.includes(k))) return cat;
  }
  return 'other_exp';
};

// ── i18n ───────────────────────────────────────────────────────
export const LOCALES: Record<string, { name: string; strings: Record<string, string> }> = {
  en: { name: 'English', strings: {
    'dashboard':'Dashboard','transactions':'Transactions','budgets':'Budgets','goals':'Goals',
    'splits':'Splits','debts':'Debts','networth':'Net Worth','reports':'Reports',
    'recurring':'Recurring','planner':'Planner','chat':'Chat','households':'Households',
    'accounts':'Accounts','insights':'Insights',
    'settings':'Settings','help':'Help & Guide',
    'add-transaction':'Add Transaction',
    'total-balance':'Total Balance','monthly-income':'Monthly Income','monthly-expenses':'Monthly Expenses','savings-rate':'Savings Rate',
    'this-month':'This month','of-income-saved':'of income saved',
    'view-all':'View all →','income':'Income','expense':'Expense',
    'budget-progress':'Budget Progress','recent-transactions':'Recent Transactions',
    'active-goals':'Active Goals','spending-by-category':'Spending by Category',
    'net-worth-snapshot':'Net Worth Snapshot','debt-overview':'Debt Overview',
    'all-time-income':'All-Time Income','all-time-expenses':'All-Time Expenses',
    'income-vs-expenses':'Income vs Expenses','net-by-period':'Net by Period',
    'category-breakdown':'Category Breakdown','top-expenses':'Top Expense Categories',
  }},
  es: { name: 'Español', strings: {
    'dashboard':'Panel','transactions':'Transacciones','budgets':'Presupuestos','goals':'Metas',
    'splits':'Divisiones','debts':'Deudas','networth':'Patrimonio','reports':'Informes',
    'settings':'Ajustes','help':'Ayuda',
    'add-transaction':'Añadir Transacción',
    'total-balance':'Saldo Total','monthly-income':'Ingresos Mensuales','monthly-expenses':'Gastos Mensuales','savings-rate':'Tasa de Ahorro',
    'this-month':'Este mes','income':'Ingreso','expense':'Gasto',
  }},
  fr: { name: 'Français', strings: {
    'dashboard':'Tableau','transactions':'Transactions','budgets':'Budgets','goals':'Objectifs',
    'debts':'Dettes','networth':'Patrimoine','reports':'Rapports','settings':'Paramètres','help':'Aide',
    'add-transaction':'Ajouter Transaction','total-balance':'Solde Total',
  }},
  hi: { name: 'हिन्दी', strings: {
    'dashboard':'डैशबोर्ड','transactions':'लेनदेन','budgets':'बजट','goals':'लक्ष्य',
    'debts':'ऋण','networth':'कुल संपत्ति','reports':'रिपोर्ट','settings':'सेटिंग्स','help':'सहायता',
    'total-balance':'कुल बैलेंस',
  }},
  de: { name: 'Deutsch', strings: {
    'dashboard':'Übersicht','transactions':'Transaktionen','budgets':'Budgets','goals':'Ziele',
    'debts':'Schulden','networth':'Vermögen','reports':'Berichte','settings':'Einstellungen','help':'Hilfe',
  }},
  ja: { name: '日本語', strings: {
    'dashboard':'ダッシュボード','transactions':'取引','budgets':'予算','goals':'目標',
    'debts':'負債','networth':'純資産','reports':'レポート','settings':'設定','help':'ヘルプ',
  }},
};
