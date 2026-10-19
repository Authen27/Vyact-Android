// "Download my data" (Settings → Sync & Backup).
//
// v10.125.0 (T4b; audit XC-PRV-08; owner, 19 Oct 2026: "Download should limit to transactions, splits,
// debts, accounts, net worth, recurring schedules, households") — exactly that, and nothing else:
//   • the household: its name, type and currency, and its members' names and roles;
//   • transactions (a split's shares are on its transaction);
//   • splits shared across households: the ones you shared and the ones shared with you;
//   • debts and accounts;
//   • net worth: the assets and the recorded monthly history;
//   • recurring schedules.
// Budgets, goals and the profile are no longer in it (W7a had added allocations; v7 the profile). The
// Privacy Policy says what it holds, and that anything else is available on request. No reader restores
// from this file: it is a download for the person, not a backup the app reads back.
// `version` stays the format marker (readers key on it); `appVersion` is the build that wrote the file.
import type { Account, Asset, Debt, HouseholdMeta, Member, RecurringSchedule, SharedSplit, Transaction } from '../types';
import type { NetWorthSnapshot } from './netWorthSnapshots';

export const BACKUP_FORMAT_VERSION = '10.125.0';

export interface BackupSource {
  household: Pick<HouseholdMeta, 'name' | 'type' | 'baseCurrency'> | null;
  members: Member[];
  transactions: Transaction[];
  sharedSplitsOwned: SharedSplit[];
  sharedSplitsWithMe: SharedSplit[];
  debts: Debt[];
  accounts: Account[];
  assets: Asset[];
  netWorthSnapshots: NetWorthSnapshot[];
  recurringSchedules: RecurringSchedule[];
}

export function buildBackup(s: BackupSource, exported: string, appVersion: string) {
  return {
    version: BACKUP_FORMAT_VERSION, appVersion, exported,
    household: s.household ? {
      name: s.household.name, type: s.household.type, currency: s.household.baseCurrency,
      members: s.members.map(m => ({ name: m.name, role: m.appRole ?? m.role })),
    } : null,
    transactions: s.transactions,
    splits: { sharedByYou: s.sharedSplitsOwned, sharedWithYou: s.sharedSplitsWithMe },
    debts: s.debts,
    accounts: s.accounts,
    netWorth: { assets: s.assets, monthlyHistory: s.netWorthSnapshots },
    recurringSchedules: s.recurringSchedules,
  };
}
