import { useEffect } from 'react';
import { consumePendingSms } from '../../lib/native';
import { pendingSms, markSmsHandled } from '../../lib/sms/bridge';
import { parseSms, smsSeed } from '../../lib/sms/parser';
import { useStore } from '../../store';

// Bank-message detection (Android sideload build). A heads-up notification's "Add" / tap arrives as
// vyact://sms/<id> (lib/native.ts buffers it for a cold start, or fires vyact:sms when warm). This
// reads that one detected message back from the phone, re-parses it with the authoritative parser,
// and opens the NORMAL Add-transaction form pre-filled. Nothing is saved here — the person reviews
// and taps Save, exactly as for a manual entry. Renders nothing; inert on the web and the Play build.
export default function SmsPromptBridge() {
  useEffect(() => {
    let live = true;

    async function open(id: string) {
      const sms = await pendingSms(id);
      const { profile, openAddTxn, toast } = useStore.getState();
      if (!live) return;
      if (!sms) { toast('That bank message is no longer available.', 'info'); return; }

      // The Java parser decided to notify; the TypeScript one is authoritative for the form. If they
      // ever disagree, the fields the notification itself showed are the fallback.
      const found = parseSms(sms.sender, sms.body) ?? {
        direction: sms.dir, amountText: sms.amount, amount: Number(sms.amount), currency: sms.cur,
        counterparty: sms.cp || null, maybeTransfer: false,
      };
      openAddTxn(smsSeed(found, { baseCurrency: profile.baseCurrency, receivedAt: sms.ts, sender: sms.sender }));
      void markSmsHandled(id); // the form is the person's now; Cancel there simply drops it
    }

    const first = consumePendingSms();
    if (first) void open(first);
    const onSms = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (typeof id === 'string' && id) void open(id);
    };
    window.addEventListener('vyact:sms', onSms);
    return () => { live = false; window.removeEventListener('vyact:sms', onSms); };
  }, []);

  return null;
}
