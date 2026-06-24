// Vyact v7.0.2 — Activity row
//
// Single concrete row for the Households "Recent Activity" feed. Rendered
// from a `FormattedActivity` produced by `lib/activityFormat.ts`. Pure
// presentational — no data fetching, no store reads.

import { ArrowRightLeft, Target, Landmark, Coins, PiggyBank, Users, Activity as ActivityIcon } from 'lucide-react';
import type { FormattedActivity } from '../../lib/activityFormat';
import { relativeTime } from '../../lib/activityFormat';

const ICONS: Record<FormattedActivity['iconKey'], typeof ActivityIcon> = {
  txn:    ArrowRightLeft,
  budget: PiggyBank,
  goal:   Target,
  debt:   Landmark,
  asset:  Coins,
  member: Users,
  system: ActivityIcon,
};

const TONE_BORDER: Record<FormattedActivity['tone'], string> = {
  sage:   'border-l-sage',
  terra:  'border-l-terra',
  denim:  'border-l-denim',
  honey:  'border-l-honey',
  coral:  'border-l-coral',
  plum:   'border-l-plum',
};

const TONE_ICON: Record<FormattedActivity['tone'], string> = {
  sage:   'text-sage',
  terra:  'text-terra',
  denim:  'text-denim',
  honey:  'text-honey',
  coral:  'text-coral',
  plum:   'text-plum',
};

interface Props {
  formatted: FormattedActivity;
  createdAt: string;
}

export default function ActivityRow({ formatted, createdAt }: Props) {
  const Icon = ICONS[formatted.iconKey];
  return (
    <div
      className={`flex items-start gap-3 px-4 py-3 border-l-[3px] ${TONE_BORDER[formatted.tone]}`}
      data-testid="activity-row"
    >
      <Icon size={16} className={`flex-shrink-0 mt-0.5 ${TONE_ICON[formatted.tone]}`} />
      <div className="flex-1 min-w-0">
        <div className="text-[0.86rem] text-ink leading-snug">
          <span className="font-medium">{formatted.actorName}</span>{' '}
          <span className="text-ink-mid">{formatted.verb}</span>{' '}
          <span className="text-ink">{formatted.subject}</span>
        </div>
        {formatted.diff ? (
          <div className="font-mono text-[0.7rem] text-ink-dim mt-0.5 truncate">
            {formatted.diff}
          </div>
        ) : null}
      </div>
      <div
        className="font-mono text-[0.62rem] text-ink-dim whitespace-nowrap pt-0.5"
        title={new Date(createdAt).toLocaleString()}
      >
        {relativeTime(createdAt)}
      </div>
    </div>
  );
}
