// Shared renderer for one Help & Guide FAQ entry — extracted from Help.tsx so
// the entity form pages can show the SAME content, verbatim, via HelpInfoButton
// rather than a second, driftable copy of the answer.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import type { HelpTopic } from '../../lib/helpContent';

function GuideImage({ image }: { image: NonNullable<HelpTopic['image']> }) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="mt-5 max-w-2xl">
      {failed ? <p role="status" className="text-sm text-ink-dim">Screenshot unavailable. The steps above still apply.</p> : (
        <a href={image.src} target="_blank" rel="noreferrer" className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-coral"
          aria-label={`Open full-size screenshot: ${image.alt}`}>
          <img src={image.src} alt={image.alt} width={image.width} height={image.height} loading="lazy"
            className="w-full h-auto rounded-lg border border-line" onError={() => setFailed(true)} />
        </a>
      )}
      <figcaption className="mt-2 text-xs text-ink-dim leading-relaxed">{image.alt} · Example household, not your data.</figcaption>
    </figure>
  );
}

export default function HelpTopicBody({ topic }: { topic: HelpTopic }) {
  return (
    <div className="text-sm text-ink-mid leading-relaxed max-w-3xl">
      <p>{topic.answer}</p>
      {topic.steps && <ol className="list-decimal pl-5 space-y-2 mt-3">{topic.steps.map(step => <li key={step}>{step}</li>)}</ol>}
      {topic.note && <p className="mt-4 border-l-2 border-line2 pl-3 text-ink-dim">{topic.note}</p>}
      <Link to={topic.link.to} className="inline-flex items-center gap-2 text-coral font-medium mt-3 min-h-[44px]">
        {topic.link.label}<ArrowRight size={16} aria-hidden />
      </Link>
      {topic.image && <GuideImage image={topic.image} />}
    </div>
  );
}
