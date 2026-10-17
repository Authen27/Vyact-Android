import { useEffect, useState } from 'react';
import HalfSheet from './HalfSheet';
import { inputAccepts, useConfirmStore, type ConfirmResult } from '../../lib/confirmSheet';

// Aurora 4.0 G4 — renders the one pending confirmation (lib/confirmSheet.ts). A half-sheet on phones
// and a 460px centred dialog on desktop (MD1); the title names the item, a short list says what
// happens and what stays, then one action named after the verb — red when it destroys, the accent
// otherwise — and Cancel (CF2). On phones the action is full width with Cancel under it; on desktop
// the buttons sit right-aligned, Cancel first.
export default function ConfirmHost() {
  const request = useConfirmStore(s => s.current);
  const [value, setValue] = useState('');
  const [choice, setChoice] = useState<string | undefined>();
  const [resendIn, setResendIn] = useState(0);
  const [resending, setResending] = useState(false);

  // Reset the controls for each new request.
  useEffect(() => {
    if (!request) return;
    setValue(request.input?.initial ?? '');
    setChoice(request.choices?.find(c => c.recommended)?.value ?? request.choices?.[0]?.value);
    setResendIn(request.resend?.seconds ?? 0);
  }, [request]);

  // CF17 — the resend countdown.
  useEffect(() => {
    if (!request?.resend || resendIn <= 0) return;
    const timer = window.setTimeout(() => setResendIn(s => s - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [request, resendIn]);

  if (!request) return null;

  const picked = request.choices?.find(c => c.value === choice);
  const action = picked?.action ?? request.action;
  const tone = picked?.tone ?? request.tone ?? 'danger';
  const accepts = inputAccepts(request.input, value);
  const finish = (result: ConfirmResult) => request.resolve(result);
  const cancel = () => finish({ ok: false, value: '' });
  const accept = () => { if (accepts) finish({ ok: true, value: value.trim(), choice }); };

  const resend = async () => {
    if (!request.resend || resending) return;
    setResending(true);
    try { await request.resend.run(); setResendIn(request.resend.seconds); } finally { setResending(false); }
  };

  return (
    <HalfSheet
      open
      onClose={cancel}
      title={request.title}
      size="confirm"
      footer={(
        <div className="flex flex-col sm:flex-row-reverse sm:justify-start gap-2" data-testid="confirm-actions">
          <button
            type="button"
            onClick={accept}
            disabled={!accepts}
            className="btn-primary w-full sm:w-auto !min-h-[46px] sm:!min-h-[40px]"
            style={tone === 'danger' ? { background: 'var(--crit)', color: 'var(--accent-ink)' } : undefined}
          >
            {action}
          </button>
          <button type="button" onClick={cancel} className="btn-ghost w-full sm:w-auto !min-h-[46px] sm:!min-h-[40px]">
            {request.cancel ?? 'Cancel'}
          </button>
        </div>
      )}
    >
      <form onSubmit={event => { event.preventDefault(); accept(); }} className="ui-pilot">
        {request.lines && request.lines.length > 0 && (
          <ul className="list-disc pl-5 text-[13.5px] leading-relaxed text-ink-mid space-y-0.5 mb-4">
            {request.lines.map(line => <li key={line}>{line}</li>)}
          </ul>
        )}

        {request.choices && (
          <div role="radiogroup" aria-label="Choose what to do" className="flex flex-col gap-2.5 mb-4">
            {request.choices.map(c => {
              const on = c.value === choice;
              return (
                <label key={c.value} className="tile flex gap-2.5 p-3 cursor-pointer"
                  style={on ? { boxShadow: 'var(--neu-sm), 0 0 0 2px var(--accent)' } : undefined}>
                  <input type="radio" name="confirm-choice" value={c.value} checked={on} onChange={() => setChoice(c.value)} className="mt-1" />
                  <span>
                    <span className="block font-semibold text-[14px] text-ink">
                      {c.label}
                      {c.recommended && <span className="ml-2 text-[11px] font-medium" style={{ color: 'var(--accent-text)' }}>Recommended</span>}
                    </span>
                    {c.detail && <span className="block text-[12.5px] text-ink-mid mt-0.5">{c.detail}</span>}
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {request.input && (
          <div className="mb-4">
            <label htmlFor="confirm-input" className="ui-label block mb-1.5">{request.input.label}</label>
            <input
              id="confirm-input"
              className={`input field-control w-full ${request.input.code ? 'num text-center text-[18px] tracking-[0.4em]' : ''}`}
              value={value}
              onChange={event => setValue(request.input?.code ? event.target.value.replace(/\D/g, '').slice(0, 6) : event.target.value)}
              placeholder={request.input.placeholder}
              maxLength={request.input.code ? 6 : request.input.maxLength}
              inputMode={request.input.code ? 'numeric' : undefined}
              autoComplete={request.input.code ? 'one-time-code' : 'off'}
              autoFocus
            />
          </div>
        )}

        {request.note && <p className="text-[12.5px] text-ink-dim -mt-1 mb-2">{request.note}</p>}

        {request.resend && (
          <p className="text-[12.5px] text-ink-dim">
            Didn&apos;t get it?{' '}
            {resendIn > 0
              ? <>Resend in {Math.floor(resendIn / 60)}:{String(resendIn % 60).padStart(2, '0')}</>
              : <button type="button" onClick={resend} disabled={resending} className="font-medium min-h-[44px]" style={{ color: 'var(--accent-text)' }}>Resend code</button>}
          </p>
        )}
      </form>
    </HalfSheet>
  );
}
