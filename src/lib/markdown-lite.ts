import { createElement, Fragment, type ReactNode } from 'react';

/**
 * Renders the tiny markdown subset model-written prose uses (AI insight
 * summaries and recommendations) as React elements — paragraphs, `-` / `*`
 * / `1.` lists, `**bold**`, `*italic*` / `_italic_`. Everything else is kept
 * as literal text, and nothing is ever injected as HTML, so untrusted model
 * output stays inert.
 *
 *   <div className="an-md">{renderMarkdownLite(insight.summary)}</div>
 *   <li>{renderInlineMarkdown(recommendation)}</li>
 */

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
// `**bold**`, then `*italic*` / `_italic_` whose inner text doesn't start or
// end with whitespace (so a stray `*` or a `* bullet` never opens emphasis).
// `_` only counts at a word boundary, so `snake_case_names` stay literal.
const INLINE = /\*\*(.+?)\*\*|\*(?!\s)(.+?)(?<!\s)\*|(?<!\w)_(?!\s)(.+?)(?<!\s)_(?!\w)/g;

export function renderInlineMarkdown(text: string, keyPrefix = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const [, bold, star, underscore] = m;
    if (bold !== undefined) out.push(createElement('strong', { key: `${keyPrefix}-${n++}` }, bold));
    else out.push(createElement('em', { key: `${keyPrefix}-${n++}` }, star ?? underscore));
    last = start + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'ul' | 'ol'; items: string[] };

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  // The open block is always the last one pushed; a blank line "closes" it.
  let open = false;
  const last = () => (open ? blocks[blocks.length - 1] : null);

  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) { open = false; continue; }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const current = last();
    if (bullet || numbered) {
      const kind: 'ul' | 'ol' = bullet ? 'ul' : 'ol';
      const item = (bullet ?? numbered)![1].trim();
      if (current && current.kind === kind) current.items.push(item);
      else blocks.push({ kind, items: [item] });
    } else if (current && current.kind === 'p') {
      current.lines.push(line);
    } else {
      blocks.push({ kind: 'p', lines: [line] });
    }
    open = true;
  }
  return blocks;
}

export function renderMarkdownLite(text: string): ReactNode[] {
  return parseBlocks(text).map((block, i) => {
    if (block.kind === 'p') {
      return createElement('p', { key: i }, ...renderInlineMarkdown(block.lines.join(' '), `p${i}`));
    }
    return createElement(
      block.kind,
      { key: i },
      ...block.items.map((item, j) => createElement('li', { key: j }, ...renderInlineMarkdown(item, `l${i}-${j}`))),
    );
  });
}

/** Convenience wrapper when a single node is needed (e.g. as a child prop). */
export function MarkdownLite({ text }: { text: string }): ReactNode {
  return createElement(Fragment, null, ...renderMarkdownLite(text));
}
