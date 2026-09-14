import mediaManifest from './helpMedia.json' with { type: 'json' };

export interface HelpTopic {
  id: string;
  group: 'Start here' | 'Everyday money' | 'Planning' | 'Access and support';
  question: string;
  answer: string;
  steps?: string[];
  note?: string;
  keywords: string[];
  link: { to: string; label: string };
  image?: { src: string; alt: string; width: number; height: number };
}

const media: Record<string, { width: number; height: number }> = mediaManifest;
const screenshot = (name: string, alt: string): HelpTopic['image'] =>
  media[name] ? { src: `/help/current/${name}.png`, alt, ...media[name] } : undefined;

export const HELP_TOPICS: readonly HelpTopic[] = [
  {
    id: 'first-transaction', group: 'Start here',
    question: 'Where should I start?',
    answer: 'Start with an account you actually use, then record one expense. You can build up the rest of your household over time.',
    steps: [
      'Open Accounts under Plan. Cash in Hand is already provided; add a bank account or credit card if needed.',
      'Use Add transaction and choose Expense or Income.',
      'Enter the amount, choose a category and the account that paid or received the money, then save.',
      'Find the entry in Transactions. Open it there when you need to correct it.',
    ],
    note: 'Bank accounts and cards belong in Accounts, loans in Debts, and investments in Net Worth.',
    keywords: ['onboarding', 'setup', 'begin', 'first expense'],
    link: { to: '/accounts', label: 'Open Accounts' },
  },
  {
    id: 'expense-income', group: 'Everyday money',
    question: 'How do I record or correct an expense or income?',
    answer: 'Expense is money you spend; Income is money you receive. Choose the account involved so its balance stays connected to your entries.',
    steps: [
      'Open Add transaction and select Expense or Income.',
      'Enter the amount and choose a category from the dropdown. Options show an icon and full label; only listed values can be selected.',
      'Check the date, account, description and household member before saving.',
      'To correct an existing entry, open it from Transactions and save your changes instead of adding a duplicate.',
    ],
    note: 'Categories depend on the transaction type. A payment mode describes how you paid; it does not create another movement of money.',
    keywords: ['category', 'receipt', 'edit', 'payment mode', 'date', 'salary', 'purchase'],
    link: { to: '/transactions', label: 'Open Transactions' },
    image: screenshot('expense', 'Expense entry with the select-only category dropdown and paying account'),
  },
  {
    id: 'cash-reconcile', group: 'Everyday money',
    question: 'How do I check the cash I am holding?',
    answer: 'Cash in Hand has its own summary in Accounts, separate from Bank and Credit Card. Reconcile it against the cash you count.',
    steps: [
      'Open Accounts and choose Reconcile in the Cash in Hand summary.',
      'Enter Cash counted and review the difference.',
      'If the amount matches, Confirm records that you checked it. Otherwise, find a missing entry or explicitly post the adjustment.',
      'Use Ledger to review cash entries and reconciliation history.',
    ],
    note: 'A reconciliation changes the account offset and records the check. It is not an expense or income. Cash in Hand can be renamed, but not deleted or archived.',
    keywords: ['cash', 'wallet', 'balance wrong', 'reconciliation', 'counted', 'adjustment'],
    link: { to: '/accounts', label: 'Check Cash in Hand' },
    image: screenshot('cash-reconcile', 'Cash reconciliation uses Cash counted, not a bank statement'),
  },
  {
    id: 'accounts-cards', group: 'Start here',
    question: 'Where do bank accounts and credit cards go?',
    answer: 'Use Accounts for money you can spend from: bank accounts, credit cards and the household cash balance. Every account uses the household currency.',
    steps: [
      'Choose Add account and select Bank or Credit Card.',
      'For a new card, enter its credit limit and available limit to establish the starting balance; add cycle and due days when known.',
      'Record purchases and repayments against the right accounts. Card outstanding and available credit are then derived from the ledger.',
      'When a later statement differs, use reconciliation rather than replacing the opening balance.',
    ],
    note: 'An account with linked history cannot simply be deleted. Use the available archive or history-move options and review the confirmation.',
    keywords: ['bank', 'credit card', 'limit', 'statement', 'default account', 'opening balance'],
    link: { to: '/accounts', label: 'Manage Accounts' },
  },
  {
    id: 'transfer', group: 'Everyday money',
    question: 'How do I move money between my own accounts?',
    answer: 'Use Transfer, not an expense followed by an income. One transfer records both sides without inflating your spending or earnings.',
    steps: [
      'Open Add transaction and choose Transfer.',
      'Choose the source account, destination account, amount and date.',
      'Review both accounts and save once.',
    ],
    note: 'Transfers have no category. Moving money into or out of an investment asset uses Investment instead.',
    keywords: ['transfer', 'repayment', 'move money', 'between accounts', 'neutral'],
    link: { to: '/transactions', label: 'Open Transactions' },
  },
  {
    id: 'split', group: 'Everyday money',
    question: 'How do I split a bill or share income?',
    answer: 'Start on Splits, using Add Split. Splits have their own form; they are not an option inside Add transaction.',
    steps: [
      'Choose Shared bill or Shared income and enter the total.',
      'Choose the category, date and account, then add the people and their shares.',
      'Check that the shares add up to the total before saving.',
      'Return to Splits to review who owes whom and record the relevant payment or settlement.',
    ],
    note: 'Only your share counts toward your expense or income. Changes are restricted once a participant has paid or settled. Cross-household sharing depends on the verified email used by the participant.',
    keywords: ['split', 'shared bill', 'shared income', 'IOU', 'settle', 'paid', 'friends'],
    link: { to: '/splits', label: 'Open Splits' },
    image: screenshot('split', 'The separate Add Split form for a shared bill'),
  },
  {
    id: 'investment', group: 'Planning',
    question: 'How do I add an investment and record a buy or withdrawal?',
    answer: 'An investment is an asset in Net Worth, not a bank account. Its cash movements are recorded with the Investment transaction type.',
    steps: [
      'Open Net Worth, choose Add Asset and select the investment type.',
      'For a purchase, add an Investment transaction with the asset and the account paying for it.',
      'For a withdrawal, select the asset and the account receiving the money.',
      'Use Update value on the asset when its market value changes without a cash movement.',
    ],
    note: 'Buys and withdrawals do not count as ordinary spending or income and have no category. Update value records a dated valuation adjustment, not a transaction. An asset with live buys cannot be deleted.',
    keywords: ['investment', 'asset', 'net worth', 'buy', 'withdrawal', 'valuation', 'market value'],
    link: { to: '/networth', label: 'Open Net Worth' },
    image: screenshot('investment-asset', 'An investment is created with Add Asset in Net Worth'),
  },
  {
    id: 'cashflow-networth', group: 'Start here',
    question: 'Why are Cash Flow and Net Worth different?',
    answer: 'Cash Flow describes income and spending over a period. Net Worth describes what you own minus what you owe. They answer different questions and need not move together.',
    note: 'Transfers and investment buys or withdrawals are neutral to spending and income. Debt remains part of Net Worth even when a debt summary is not shown on the Dashboard.',
    keywords: ['dashboard', 'cash flow', 'net worth', 'totals', 'liabilities', 'different'],
    link: { to: '/networth', label: 'Review Net Worth' },
  },
  {
    id: 'ask-unavailable', group: 'Access and support',
    question: 'Why is Ask Vyact unavailable?',
    answer: 'Ask Vyact needs to be configured and reachable. When it is not, Vyact shows an unavailable response instead of substituting a canned financial answer.',
    note: 'You can still use Transactions, Accounts and your other available pages directly. Ask Vyact\'s explanations are not a guarantee that every figure is framed correctly; check the underlying records when something looks wrong.',
    keywords: ['ask', 'chat', 'AI', 'unavailable', 'offline'],
    link: { to: '/chat', label: 'Open Ask Vyact' },
  },
  {
    id: 'budget', group: 'Planning',
    question: 'How do I set a budget without creating duplicates?',
    answer: 'A budget gives a period a total spending limit, with optional category allocations. Monthly and annual budgets are separate; there is one budget per household for each scope and period.',
    steps: ['Open Budgets and add a budget.', 'Choose an available period, enter the total, and allocate amounts to the categories you want to plan.', 'Review any suggestions before applying them. Save once; edit the existing budget if that period already has one.'],
    note: 'Budget creation requires an online cloud session and an Owner or Admin role. A local-only preview is not a substitute for this workflow.',
    keywords: ['budget', 'allocation', 'limit', 'duplicate', 'monthly', 'annual', 'permission'],
    link: { to: '/budgets', label: 'Open Budgets' },
  },
  {
    id: 'recurring', group: 'Planning',
    question: 'How do I set up rent, salary or a subscription?',
    answer: 'Create a recurring schedule for a repeating entry. A schedule describes future occurrences; it is not itself a posted transaction.',
    steps: ['Open Recurring under Plan and choose Add Schedule.', 'Choose the type, amount, category where applicable, and the account involved.', 'Set the repeat pattern, start date and any end limit.', 'Choose whether Auto-approve this schedule is on, then save. Review upcoming dates and posted entries regularly.'],
    note: 'With auto-approval off, due entries need confirmation before they count. Do not assume an occurrence has posted just because its date has arrived, especially while the app is offline or closed.',
    keywords: ['recurring', 'schedule', 'rent', 'salary', 'subscription', 'repeat', 'auto approve', 'confirm'],
    link: { to: '/recurring', label: 'Open Recurring' },
    image: screenshot('recurring', 'Recurring schedule repeat settings and auto-approval control'),
  },
  {
    id: 'recurring-change', group: 'Planning',
    question: 'What happens when I edit or delete a schedule?',
    answer: 'Use the edit action on the schedule to change future settings. Use its delete action when the repeating instruction is no longer needed, and review the confirmation before proceeding.',
    note: 'Already-posted transactions are separate records. Correct those in Transactions when necessary; changing the schedule is not a rewrite of your past spending.',
    keywords: ['recurring', 'cancel subscription', 'delete schedule', 'edit schedule', 'history'],
    link: { to: '/recurring', label: 'Manage schedules' },
  },
  {
    id: 'debt', group: 'Planning',
    question: 'How do I track a loan and record a payment?',
    answer: 'Add a debt with its current balance and the terms you know. Use its payment action when you make a payment, so the selected loan and paying account are connected.',
    steps: ['Open Debts and add the debt, current balance, interest rate and minimum monthly payment.', 'Choose the debt payment action and check the amount, paying account and linked loan.', 'Review the interest and principal portions before saving the payment.'],
    note: 'Interest is an expense; principal reduces the loan balance. Avalanche prioritises higher interest rates; Snowball prioritises smaller balances. Payoff projections depend on your recorded terms and payments, not a lender guarantee.',
    keywords: ['debt', 'loan', 'EMI', 'principal', 'interest', 'avalanche', 'snowball', 'payoff'],
    link: { to: '/debts', label: 'Open Debts' },
    image: screenshot('debt', 'Add Debt records the current balance and loan terms'),
  },
  {
    id: 'assets', group: 'Planning',
    question: 'What belongs in Net Worth - Assets?',
    answer: 'Add things you own, such as investments or property. Record a value and liquidity that reflect the asset. Banks and credit cards are managed in Accounts; avoid adding the same balance again as an unrelated asset.',
    note: 'For an investment already tracked here, use Update value for a valuation change and Investment transactions for money moving in or out. Debts and other included liabilities reduce Net Worth.',
    keywords: ['asset', 'property', 'liquidity', 'networth', 'net worth', 'double count'],
    link: { to: '/networth', label: 'Review Assets' },
  },
  {
    id: 'missing-entry', group: 'Everyday money',
    question: 'Why can I not find an entry or see it in totals?',
    answer: 'Check the selected household and date range first. In Transactions, clear filters and search for the description. Check whether a recurring entry is still awaiting confirmation.',
    note: 'Private entries are excluded from totals and charts; this flag is not a substitute for household access permissions. Transfers and investments are excluded from ordinary income and spending. A missing entry is not always a failed save: check before adding it again.',
    keywords: ['missing', 'filter', 'search', 'private', 'totals', 'pending', 'duplicate'],
    link: { to: '/transactions', label: 'Find a transaction' },
  },
  {
    id: 'reports', group: 'Everyday money',
    question: 'Where can I review my spending over time?',
    answer: 'Open Reports under Analyze and choose a date range; every chart, category breakdown and member or account table then uses that same window. Budget vs actual compares each budget over its own month or year, and the essential-spend runway states the completed months it is based on. Use Transactions to inspect or correct the underlying entries.',
    note: 'Insights offers a For You feed and an explainer library. It is a place to explore patterns and learn, not to edit your ledger.',
    keywords: ['reports', 'analyze', 'insights', 'trend', 'categories', 'spending'],
    link: { to: '/reports', label: 'Open Reports' },
  },
  {
    id: 'household', group: 'Access and support',
    question: 'How do I share a household or change what someone can do?',
    answer: 'Household sharing requires a cloud account. Open Households to review members and invitations; an Owner or Admin can use the available invite and role actions.',
    note: 'Roles affect which actions are allowed. Budget management is limited to Owners and Admins. A Viewer is read-only. If an action is unavailable, check your current household and role before contacting support.',
    keywords: ['household', 'invite', 'family', 'member', 'role', 'viewer', 'admin', 'permission'],
    link: { to: '/households', label: 'Open Households' },
  },
  {
    id: 'sync', group: 'Access and support',
    question: 'Is my data on this device or synced to my account?',
    answer: 'Check Settings under Sync & backup. Cloud mode syncs household data with your signed-in account. Local-only mode keeps an anonymous household on this browser and does not provide multi-device sharing.',
    note: 'Cloud changes refresh when the app regains focus or connectivity and during periodic refreshes; they are not an instant live feed. If a save or sync reports a problem, keep the device data intact and resolve the warning before clearing browser storage.',
    keywords: ['sync', 'offline', 'local', 'cloud', 'device', 'refresh', 'save error'],
    link: { to: '/settings', label: 'Check sync settings' },
  },
  {
    id: 'exports', group: 'Access and support',
    question: 'Can I download a copy of my data?',
    answer: 'In Settings, open Sync & backup. Export CSV downloads transaction rows for spreadsheet review. Download Backup produces the JSON snapshot currently offered by the app.',
    note: 'Treat these files as sensitive. The JSON export is not a complete, verified restore of every account, schedule and relationship, and Help does not promise a one-click restore. Do not use it as the sole safeguard before erasing data.',
    keywords: ['export', 'CSV', 'JSON', 'backup', 'download', 'restore', 'import'],
    link: { to: '/settings', label: 'Open Sync & backup' },
  },
  {
    id: 'currency', group: 'Access and support',
    question: 'How do I change currency or appearance?',
    answer: 'Open Settings for appearance and language/currency preferences. Accounts use the household currency rather than an independently selected account currency.',
    note: 'Changing a currency setting is not a real foreign-exchange transfer. Review currency and exchange-rate settings carefully before relying on converted totals.',
    keywords: ['currency', 'exchange rate', 'theme', 'dark', 'warm', 'language', 'appearance'],
    link: { to: '/settings', label: 'Open Settings' },
  },
  {
    id: 'whatsapp', group: 'Access and support',
    question: 'Can I use WhatsApp to check balances or log entries?',
    answer: 'The WhatsApp integration is for transaction logging, not financial queries or balance replies. Use the app to view household financial information.',
    note: 'Connection and outbound messages depend on service configuration and provider approval. If linking is unavailable, continue logging in the app; do not assume WhatsApp is connected or an entry was saved without confirmation.',
    keywords: ['whatsapp', 'link', 'OTP', 'message', 'balance query'],
    link: { to: '/settings', label: 'Check connection settings' },
  },
];

export function searchHelpTopics(query: string): readonly HelpTopic[] {
  const terms = query.trim().toLocaleLowerCase('en').split(/\s+/).filter(Boolean);
  if (!terms.length) return HELP_TOPICS;
  return HELP_TOPICS.filter(topic => {
    const text = [topic.question, topic.answer, topic.note ?? '', ...(topic.steps ?? []), ...topic.keywords]
      .join(' ').toLocaleLowerCase('en');
    return terms.every(term => text.includes(term));
  });
}