import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Banknote, CalendarClock, ChevronDown, ExternalLink, Search, X } from 'lucide-react';
import Button from '../components/ui/Button';
import { Panel } from '../components/ui/Card';
import { Field, Input, Textarea } from '../components/ui/Input';
import { HELP_TOPICS, searchHelpTopics, type HelpTopic } from '../lib/helpContent';
import HelpTopicBody from '../components/help/HelpTopicBody';
import PageHead from '../components/ui/PageHead';

const SUPPORT_EMAIL = 'support@vyact.app';
const GROUPS: HelpTopic['group'][] = ['Start here', 'Everyday money', 'Planning', 'Access and support'];

export default function Help() {
  const [query, setQuery] = useState('');
  const [ticketSubject, setTicketSubject] = useState('');
  const [ticketMessage, setTicketMessage] = useState('');
  const [emailAttempted, setEmailAttempted] = useState(false);
  const filtered = searchHelpTopics(query);
  const searching = query.trim().length > 0;

  function sendEmail(event: React.FormEvent) {
    event.preventDefault();
    const subject = encodeURIComponent(ticketSubject.trim() || 'Vyact support request');
    const body = encodeURIComponent(`${ticketMessage.trim()}\n\nVyact Consumer v${__APP_VERSION__}`);
    window.location.href = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
    setEmailAttempted(true);
  }

  // v10.59.0 (owner) — the same type and layout as Households, the app's default page style:
  // display-italic title with no caption, display-italic section headings, content in Panels.
  return (
    <div className="ui-pilot">
      <PageHead title="Help & Guide" />

      <h2 id="help-start" className="display-italic text-2xl text-ink mb-3">Your next step</h2>
      <Panel className="mb-6">
        <div className="grid sm:grid-cols-3">
          {[
            { to: '/accounts', label: 'Set up an account', detail: 'Start with the money you use.', icon: Banknote },
            { to: '/transactions', label: 'Record an entry', detail: 'An expense, income or money move.', icon: ArrowRight },
            { to: '/recurring', label: 'Plan a repeating bill', detail: 'Keep its next date in view.', icon: CalendarClock },
          ].map(({ to, label, detail, icon: Icon }) => (
            <Link key={to} to={to} className="flex items-start gap-3 p-4 min-h-[44px] text-ink hover:text-coral border-b sm:border-b-0 sm:border-r last:border-0 border-line">
              <Icon size={18} aria-hidden className="shrink-0 mt-0.5 text-coral" />
              <span className="min-w-0"><span className="block font-semibold">{label}</span><span className="block text-[0.78rem] text-ink-mid mt-0.5">{detail}</span></span>
            </Link>
          ))}
        </div>
      </Panel>

      <Panel title="Search Help & Guide" className="mb-6">
        <div className="p-4">
          <Input type="search" value={query} placeholder="Try cash, split, investment or sync" aria-label="Search Help & Guide"
            onChange={event => setQuery(event.target.value)} autoComplete="off" />
          <div className="flex items-center justify-between gap-3 min-h-[44px] mt-1">
            <p role="status" className="text-[12px] text-ink-dim flex items-center gap-2"><Search size={12} aria-hidden />
              {searching ? `${filtered.length} matching ${filtered.length === 1 ? 'answer' : 'answers'}` : `${HELP_TOPICS.length} answers`}
            </p>
            {searching && <Button variant="ghost" onClick={() => setQuery('')}><X size={14} aria-hidden /> Clear search</Button>}
          </div>
          {!searching && <nav aria-label="Help topics" className="flex flex-wrap gap-x-5 gap-y-1">
            {GROUPS.map(group => <a key={group} href={`#help-${group.toLowerCase().replace(/ /g, '-')}`}
              className="text-[13px] font-medium text-coral inline-flex items-center min-h-[44px]">{group}</a>)}
          </nav>}
        </div>
      </Panel>

      {filtered.length === 0 && (
        <Panel className="mb-6">
          <section className="p-5" aria-label="No matching answers">
            <h2 className="font-semibold text-ink mb-1">No answers found</h2>
            <p className="text-[0.85rem] text-ink-mid">Try a shorter search, or <a href="#contact" className="text-coral underline">email support</a> with your question.</p>
          </section>
        </Panel>
      )}

      {GROUPS.map(group => {
        const topics = filtered.filter(topic => topic.group === group);
        if (!topics.length) return null;
        const groupId = `help-${group.toLowerCase().replace(/ /g, '-')}`;
        return <section key={group} aria-labelledby={groupId} className="mb-6">
          <h2 id={groupId} className="display-italic text-2xl text-ink mb-3 scroll-mt-36">{group}</h2>
          <Panel>
            {topics.map(topic => <details key={`${topic.id}-${searching}`} open={searching ? true : undefined} className="group border-b border-line last:border-0">
              <summary className="list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-4 px-4 py-3.5 cursor-pointer min-h-[52px] text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-coral">
                <h3 className="font-semibold leading-snug">{topic.question}</h3>
                <ChevronDown size={18} aria-hidden className="shrink-0 text-ink-dim group-open:rotate-180" />
              </summary>
              <div className="px-4 pb-5">
                <HelpTopicBody topic={topic} />
              </div>
            </details>)}
          </Panel>
        </section>;
      })}

      <section id="contact" aria-labelledby="help-contact" className="mb-6 scroll-mt-36">
        <h2 id="help-contact" className="display-italic text-2xl text-ink mb-3">Contact support</h2>
        <Panel>
          <div className="p-5">
            <p className="text-[0.85rem] text-ink-mid leading-relaxed mb-4 max-w-2xl">Tell us which page you were on, what you expected and what happened. Leave out passwords, verification codes and full account numbers. Redact financial details from any screenshot you attach.</p>
            <form onSubmit={sendEmail} className="max-w-2xl">
              <Field label="Subject"><Input value={ticketSubject} onChange={event => setTicketSubject(event.target.value)} required maxLength={160} /></Field>
              <Field label="What happened?" hint="Include the page name and any error message."><Textarea value={ticketMessage} onChange={event => setTicketMessage(event.target.value)} required maxLength={4000} /></Field>
              <Button type="submit"><ExternalLink size={16} aria-hidden /> Open email draft</Button>
            </form>
            <p className="text-[0.75rem] text-ink-dim mt-3 leading-relaxed">Opens your email app; nothing is sent until you send it there. You can also email <a className="text-coral underline break-all" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>
            {emailAttempted && <p role="status" className="text-[0.85rem] text-ink-mid mt-3">If no draft opened, use the email address above. No support ticket has been submitted here.</p>}
            <div className="flex flex-wrap gap-5 mt-4 text-[13px] font-medium"><Link to="/privacy" className="text-coral">Privacy</Link><Link to="/terms" className="text-coral">Terms</Link></div>
          </div>
        </Panel>
      </section>
      <p className="text-[12px] text-ink-dim">Vyact Consumer v{__APP_VERSION__}</p>
    </div>
  );
}
