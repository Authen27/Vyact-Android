// Vyact — contextual help on entity form pages (routed forms, v10.28.0).
//
// Shows the SAME FAQ entry from Help & Guide, via the shared HELP_TOPICS
// catalog and HelpTopicBody renderer — never a second, driftable copy of the
// answer. Renders nothing if the given topic id doesn't resolve, so a stale
// id fails silently rather than crashing a form page.
import { useState } from 'react';
import { Info } from 'lucide-react';
import HalfSheet from '../ui/HalfSheet';
import { HELP_TOPICS } from '../../lib/helpContent';
import HelpTopicBody from './HelpTopicBody';

export default function HelpInfoButton({ topicId }: { topicId: string }) {
  const [open, setOpen] = useState(false);
  const topic = HELP_TOPICS.find(t => t.id === topicId);
  if (!topic) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Help: ${topic.question}`}
        title="Help"
        className="min-w-[44px] min-h-[44px] flex items-center justify-center text-ink-dim hover:text-coral transition-colors rounded-full shrink-0"
      >
        <Info size={20} aria-hidden />
      </button>
      <HalfSheet open={open} onClose={() => setOpen(false)} title={topic.question}>
        <HelpTopicBody topic={topic} />
      </HalfSheet>
    </>
  );
}
