// Vyact v7 — Profile Templates
// Six templates that configure: visible pages, pre-populated data,
// and Pulse Score weighting. Driven entirely by Profile.template field.

import type { Budget, Goal, Debt } from '../types';
import { uid, today } from './format';

export type TemplateKey =
  | 'young_couple'
  | 'family'
  | 'single'
  | 'self_employed'
  | 'retiree'
  | 'student';

export interface TemplateMeta {
  key: TemplateKey;
  icon: string;
  label: string;
  description: string;
  pages: string[];
  pulseWeights: { budget: number; savings: number; goals: number; trend: number; debt: number };
  starterBudgets: Omit<Budget, 'id' | 'currency'>[];
  starterGoals: Omit<Goal, 'id' | 'currency'>[];
  starterDebts: Omit<Debt, 'id' | 'currency'>[];
  primaryConcern: 'spending' | 'debt' | 'savings' | 'retirement';
}

export const TEMPLATES: Record<TemplateKey, TemplateMeta> = {
  young_couple: {
    key: 'young_couple',
    icon: '💑',
    label: 'Young Couple',
    description: 'Dual income, no kids yet, optimising for joint goals',
    pages: ['dashboard','transactions','budgets','goals','splits','reports','settings','help'],
    pulseWeights: { budget: 0.25, savings: 0.30, goals: 0.25, trend: 0.15, debt: 0.05 },
    starterBudgets: [
      { category: 'rent_mortgage',          limit: 1800, color: '#C44536' },
      { category: 'food_dining',          limit: 600,  color: '#E8A87C' },
      { category: 'utilities',     limit: 200,  color: '#F4D27A' },
      { category: 'entertainment', limit: 250,  color: '#6E4555' },
      { category: 'transport',     limit: 300,  color: '#4A6FA5' },
    ],
    starterGoals: [
      { type: 'savings',    name: 'Holiday Fund',         target: 4000,  current: 0, completed: false },
      { type: 'emergency',  name: 'Joint Emergency Fund', target: 12000, current: 0, completed: false },
      { type: 'purchase',   name: 'Down-payment Pot',     target: 30000, current: 0, completed: false },
    ],
    starterDebts: [],
    primaryConcern: 'savings',
  },

  family: {
    key: 'family',
    icon: '👨‍👩‍👧‍👦',
    label: 'Family with Kids',
    description: 'Household with children, multiple budgets, mortgage',
    pages: ['dashboard','transactions','budgets','goals','splits','debts','networth','reports','settings','help'],
    pulseWeights: { budget: 0.30, savings: 0.20, goals: 0.15, trend: 0.15, debt: 0.20 },
    starterBudgets: [
      { category: 'rent_mortgage',          limit: 2400, color: '#C44536' },
      { category: 'food_dining',          limit: 850,  color: '#E8A87C' },
      { category: 'childcare',     limit: 600,  color: '#F4B6A8' },
      { category: 'education',     limit: 300,  color: '#6B7C53' },
      { category: 'utilities',     limit: 280,  color: '#F4D27A' },
      { category: 'insurance',     limit: 350,  color: '#6B635C' },
      { category: 'transport',     limit: 400,  color: '#4A6FA5' },
    ],
    starterGoals: [
      { type: 'emergency',  name: '6-Month Emergency Fund', target: 18000, current: 0, completed: false },
      { type: 'savings',    name: 'Family Holiday',         target: 5000,  current: 0, completed: false },
      { type: 'investment', name: "Kids' Education Fund",   target: 50000, current: 0, completed: false },
    ],
    starterDebts: [
      { type: 'mortgage', name: 'Home Mortgage', principal: 250000, currentBalance: 250000, interestRate: 5.25, minimumPayment: 1450, tenureMonths: 360 },
    ],
    primaryConcern: 'spending',
  },

  single: {
    key: 'single',
    icon: '🙋',
    label: 'Single Earner / Single Parent',
    description: 'One income, focused on essentials and emergency fund',
    pages: ['dashboard','transactions','budgets','goals','debts','reports','settings','help'],
    pulseWeights: { budget: 0.35, savings: 0.20, goals: 0.25, trend: 0.15, debt: 0.05 },
    starterBudgets: [
      { category: 'rent_mortgage',          limit: 1200, color: '#C44536' },
      { category: 'food_dining',          limit: 450,  color: '#E8A87C' },
      { category: 'utilities',     limit: 180,  color: '#F4D27A' },
      { category: 'transport',     limit: 200,  color: '#4A6FA5' },
      { category: 'childcare',     limit: 400,  color: '#F4B6A8' },
    ],
    starterGoals: [
      { type: 'emergency', name: '3-Month Emergency Fund', target: 6000, current: 0, completed: false },
    ],
    starterDebts: [],
    primaryConcern: 'spending',
  },

  self_employed: {
    key: 'self_employed',
    icon: '💼',
    label: 'Self-Employed / SMB Owner',
    description: 'Personal/Business firewall, tax planning, business loans',
    pages: ['dashboard','transactions','budgets','networth','debts','reports','settings','help'],
    pulseWeights: { budget: 0.20, savings: 0.25, goals: 0.15, trend: 0.20, debt: 0.20 },
    starterBudgets: [
      { category: 'rent_mortgage',          limit: 1500, color: '#C44536' },
      { category: 'utilities',     limit: 250,  color: '#F4D27A' },
      { category: 'food_dining',          limit: 500,  color: '#E8A87C' },
      { category: 'insurance',     limit: 300,  color: '#6B635C' },
    ],
    starterGoals: [
      { type: 'emergency',  name: '12-Month Runway',     target: 36000, current: 0, completed: false },
      { type: 'savings',    name: 'Quarterly Tax Pot',   target: 8000,  current: 0, completed: false },
      { type: 'investment', name: 'Self-Directed Pension', target: 25000, current: 0, completed: false },
    ],
    starterDebts: [],
    primaryConcern: 'savings',
  },

  retiree: {
    key: 'retiree',
    icon: '🏖️',
    label: 'Pre-Retiree / Retiree',
    description: 'Drawdown planning, healthcare, no new debt',
    pages: ['dashboard','transactions','networth','reports','goals','settings','help'],
    pulseWeights: { budget: 0.20, savings: 0.35, goals: 0.15, trend: 0.25, debt: 0.05 },
    starterBudgets: [
      { category: 'rent_mortgage',          limit: 1500, color: '#C44536' },
      { category: 'food_dining',          limit: 600,  color: '#E8A87C' },
      { category: 'health',        limit: 500,  color: '#85A88A' },
      { category: 'utilities',     limit: 220,  color: '#F4D27A' },
      { category: 'travel',        limit: 400,  color: '#4A6FA5' },
    ],
    starterGoals: [
      { type: 'savings', name: '4% Drawdown Target',     target: 600000, current: 0, completed: false },
      { type: 'savings', name: 'Healthcare Reserve',     target: 30000,  current: 0, completed: false },
    ],
    starterDebts: [],
    primaryConcern: 'retirement',
  },

  student: {
    key: 'student',
    icon: '🎓',
    label: 'Student / Early Career',
    description: 'Tight budgets, student loans, building habits',
    pages: ['dashboard','transactions','budgets','goals','splits','debts','reports','settings','help'],
    pulseWeights: { budget: 0.35, savings: 0.25, goals: 0.25, trend: 0.10, debt: 0.05 },
    starterBudgets: [
      { category: 'rent_mortgage',          limit: 700,  color: '#C44536' },
      { category: 'food_dining',          limit: 250,  color: '#E8A87C' },
      { category: 'education',     limit: 150,  color: '#6B7C53' },
      { category: 'transport',     limit: 80,   color: '#4A6FA5' },
      { category: 'entertainment', limit: 100,  color: '#6E4555' },
    ],
    starterGoals: [
      { type: 'emergency', name: 'Starter Emergency Fund', target: 1500, current: 0, completed: false },
      { type: 'savings',   name: 'First Month Rent Fund',  target: 800,  current: 0, completed: false },
    ],
    starterDebts: [
      { type: 'student_loan', name: 'Student Loan', principal: 25000, currentBalance: 25000, interestRate: 4.5, minimumPayment: 0, tenureMonths: 240 },
    ],
    primaryConcern: 'debt',
  },
};

// Pages always visible regardless of template
export const ALWAYS_VISIBLE_PAGES = new Set(['dashboard','settings','help']);

export function pagesForTemplate(key: TemplateKey | undefined): Set<string> {
  if (!key) return new Set(TEMPLATES.family.pages);
  return new Set(TEMPLATES[key].pages);
}

// Hydrate a template's starter data with the user's chosen currency
export function hydrateTemplate(key: TemplateKey, currency: string) {
  const t = TEMPLATES[key];
  return {
    budgets: t.starterBudgets.map(b => ({ ...b, id: uid(), currency })),
    goals:   t.starterGoals.map(g => ({ ...g, id: uid(), currency })),
    debts:   t.starterDebts.map(d => ({ ...d, id: uid(), currency, lender: '', dueDate: today() })),
  };
}
