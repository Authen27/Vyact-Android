import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Banknote, CalendarClock, ChevronDown, ExternalLink, Mail, Search, X } from 'lucide-react';
import Button from '../components/ui/Button';
import { Field, Input, Textarea } from '../components/ui/Input';
import { HELP_TOPICS, searchHelpTopics, type HelpTopic } from '../lib/helpContent';
import HelpTopicBody from '../components/help/HelpTopicBody';

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

  return (
    <div className="ui-pilot reading-surface help-guide mx-auto max-w-5xl">
      <header className="mb-section">
        <h1 className="display-italic text-4xl text-ink mb-1.5">Help &amp; Guide</h1>
        <p className="text-base text-ink-mid leading-relaxed">Get your first entry right. Build a routine you can trust.</p>
        <a href="#contact" className="inline-flex items-center gap-2 text-sm text-coral mt-3 min-h-[44px]">
          <Mail size={16} aria-hidden /> Contact support
        </a>
      </header>

      <section aria-labelledby="help-start" className="mb-section">
        <h2 id="help-start" className="text-xl font-display font-medium text-ink mb-4">Your next step</h2>
        <div className="grid sm:grid-cols-3 gap-4 border-y border-line py-4">
          {[
            { to: '/accounts', label: 'Set up an account', detail: 'Start with the money you use.', icon: Banknote },
            { to: '/transactions', label: 'Record an entry', detail: 'An expense, income or money move.', icon: ArrowRight },
            { to: '/recurring', label: 'Plan a repeating bill', detail: 'Keep its next date in view.', icon: CalendarClock },
          ].map(({ to, label, detail, icon: Icon }) => (
            <Link key={to} to={to} className="flex items-start gap-3 py-2 min-h-[44px] text-ink hover:text-coral">
              <Icon size={20} aria-hidden className="shrink-0 mt-0.5" />
              <span className="min-w-0"><span className="block text-sm font-medium">{label}</span><span className="block text-sm text-ink-dim mt-1">{detail}</span></span>
            </Link>
          ))}
        </div>
      </section>

      <section aria-label="Find help" className="mb-group">
        <Field label="Search Help & Guide">
          <Input type="search" value={query} placeholder="Try cash, split, investment or sync"
            onChange={event => setQuery(event.target.value)} autoComplete="off" />
        </Field>
        <div className="flex items-center justify-between gap-3 min-h-[44px]">
          <p role="status" className="text-sm text-ink-dim flex items-center gap-2"><Search size={14} aria-hidden />
            {searching ? `${filtered.length} matching ${filtered.length === 1 ? 'answer' : 'answers'}` : `${HELP_TOPICS.length} answers`}
          </p>
          {searching && <Button variant="ghost" onClick={() => setQuery('')}><X size={14} aria-hidden /> Clear search</Button>}
        </div>
        {!searching && <nav aria-label="Help topics" className="flex flex-wrap gap-x-5 gap-y-1 mt-2">
          {GROUPS.map(group => <a key={group} href={`#help-${group.toLowerCase().replace(/ /g, '-')}`}
            className="text-sm text-coral inline-flex items-center min-h-[44px]">{group}</a>)}
        </nav>}
      </section>

        {filtered.length === 0 && (
          <section className="py-8 border-y border-line" aria-label="No matching answers">
            <h2 className="text-lg text-ink font-medium mb-2">No answers found</h2>
            <p className="text-sm text-ink-mid">Try a shorter search, or <a href="#contact" className="text-coral underline">email support</a> with your question.</p>
          </section>
        )}

      {GROUPS.map(group => {
        const topics = filtered.filter(topic => topic.group === group);
        if (!topics.length) return null;
        const groupId = `help-${group.toLowerCase().replace(/ /g, '-')}`;
        return <section key={group} aria-labelledby={groupId} className="mb-section">
          <h2 id={groupId} className="text-xl font-display font-medium text-ink mb-4 scroll-mt-36">{group}</h2>
          <div className="border-t border-line">
            {topics.map(topic => <details key={`${topic.id}-${searching}`} open={searching ? true : undefined} className="group border-b border-line">
              <summary className="list-none [&::-webkit-details-marker]:hidden flex items-center justify-between gap-4 py-4 cursor-pointer min-h-[52px] text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-coral">
                <h3 className="text-base font-medium leading-snug">{topic.question}</h3>
                <ChevronDown size={18} aria-hidden className="shrink-0 group-open:rotate-180" />
              </summary>
              <div className="pb-5">
                <HelpTopicBody topic={topic} />
              </div>
            </details>)}
          </div>
        </section>;
      })}

      <section id="contact" aria-labelledby="help-contact" className="border-t border-line pt-group mt-section scroll-mt-36">
        <div className="flex items-center gap-2 mb-3"><Mail size={20} aria-hidden className="text-coral" /><h2 id="help-contact" className="text-xl font-display font-medium text-ink">Contact support</h2></div>
        <p className="text-sm text-ink-mid leading-relaxed mb-4">Tell us which page you were on, what you expected and what happened. Leave out passwords, verification codes and full account numbers. Redact financial details from any screenshot you attach.</p>
        <form onSubmit={sendEmail} className="max-w-2xl">
          <Field label="Subject"><Input value={ticketSubject} onChange={event => setTicketSubject(event.target.value)} required maxLength={160} /></Field>
          <Field label="What happened?" hint="Include the page name and any error message."><Textarea value={ticketMessage} onChange={event => setTicketMessage(event.target.value)} required maxLength={4000} /></Field>
          <Button type="submit"><ExternalLink size={16} aria-hidden /> Open email draft</Button>
        </form>
        <p className="text-xs text-ink-dim mt-3 leading-relaxed">Opens your email app; nothing is sent until you send it there. You can also email <a className="text-coral underline break-all" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.</p>
        {emailAttempted && <p role="status" className="text-sm text-ink-mid mt-3">If no draft opened, use the email address above. No support ticket has been submitted here.</p>}
        <div className="flex flex-wrap gap-5 mt-group text-sm"><Link to="/privacy" className="text-coral">Privacy</Link><Link to="/terms" className="text-coral">Terms</Link></div>
      </section>
      <p className="text-xs text-ink-dim mt-section">Vyact Consumer v{__APP_VERSION__}</p>
    </div>
  );
}
