import { describe, it, expect } from 'vitest';

// CON-UNIT-118 — audit S4. The public Learn microsite embeds CMS-controlled
// JSON inside a <script type="application/ld+json"> element. HTML-escaping
// (`esc()`) does NOT protect a script context: a literal `</script>` inside a
// JSON string terminates the element and breaks out into markup. The
// serializer must escape `<` as the six-char ASCII sequence \u-0-0-3-c
// (written as an escape in learn.js), which JSON.parse reverses exactly.

import { safeJsonLd } from '../../../api/learn.js';

describe('safeJsonLd — the JSON-LD script boundary (audit S4)', () => {
  it('CON-UNIT-118 · a script-closing sequence in CMS content cannot break out', () => {
    const hostile = {
      headline: 'Budgeting </script><script>alert(1)</script> basics',
      articleBody: 'First </SCRIPT> then <!-- <img src=x onerror=alert(2)> -->',
    };
    const out = safeJsonLd(hostile);
    expect(out).not.toContain('</script>');
    expect(out).not.toContain('</SCRIPT>');
    expect(out).not.toContain('<!--');
    expect(out).not.toContain('<');
    // …and it is byte-equivalent JSON for the crawler:
    expect(JSON.parse(out)).toEqual(hostile);
  });

  it('CON-UNIT-118b · arrays and ordinary content round-trip unchanged', () => {
    const doc = [{ '@type': 'Article', headline: 'What is an EMI?' }, { '@type': 'BreadcrumbList' }];
    expect(JSON.parse(safeJsonLd(doc))).toEqual(doc);
  });
});
