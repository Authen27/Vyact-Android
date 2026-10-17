// W7a (audit FE-MNY-15, FE-UIS-06) — the "Full backup" snapshot. It used to leave out accounts, budget
// allocations, recurring bills and net-worth history, so a backup could not rebuild balances, envelope
// splits or bills. `version` stays the backup-format marker (readers key on it); `appVersion` is the
// build that wrote the file.
import type { Account, Asset, BudgetAllocation, Budget, Debt, Goal, Member, Profile, RecurringSchedule, Transaction } from '../types';
import type { NetWorthSnapshot } from './netWorthSnapshots';

export const BACKUP_FORMAT_VERSION = '6.4.9';

export interface BackupSource {
  profile: Profile;
  transactions: Transaction[];
  budgets: Budget[];
  goals: Goal[];
  members: Member[];
  debts: Debt[];
  assets: Asset[];
  accounts: Account[];
  budgetAllocations: BudgetAllocation[];
  recurringSchedules: RecurringSchedule[];
  netWorthSnapshots: NetWorthSnapshot[];
}

export function buildBackup(s: BackupSource, exported: string, appVersion: string) {
  return {
    version: BACKUP_FORMAT_VERSION, appVersion, exported,
    profile: s.profile, transactions: s.transactions, budgets: s.budgets, goals: s.goals,
    members: s.members, debts: s.debts, assets: s.assets,
    accounts: s.accounts, budgetAllocations: s.budgetAllocations,
    recurringSchedules: s.recurringSchedules, netWorthSnapshots: s.netWorthSnapshots,
  };
}
