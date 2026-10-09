import { describe, it, expect } from 'vitest';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderMarkdownLite, renderInlineMarkdown, MarkdownLite } from './markdown-lite';

const html = (text: string) => renderToStaticMarkup(createElement(Fragment, null, ...renderMarkdownLite(text)));
const inline = (text: string) => renderToStaticMarkup(createElement(Fragment, null, ...renderInlineMarkdown(text)));

describe('renderInlineMarkdown', () => {
  it('renders **bold** as <strong>', () => {
    expect(inline('Reach is **up 12%** this month')).toBe('Reach is <strong>up 12%</strong> this month');
  });

  it('renders *italic* and _italic_ as <em>', () => {
    expect(inline('try *shorter* and _punchier_ hooks')).toBe('try <em>shorter</em> and <em>punchier</em> hooks');
  });

  it('keeps stray markers as literal text', () => {
    expect(inline('a * b and 2 * 3')).toBe('a * b and 2 * 3');
    expect(inline('unclosed **bold')).toBe('unclosed **bold');
    expect(inline('snake_case_name')).toBe('snake_case_name');
  });

  it('never injects HTML from the model output', () => {
    expect(inline('<script>alert(1)</script> **<b>x</b>**'))
      .toBe('&lt;script&gt;alert(1)&lt;/script&gt; <strong>&lt;b&gt;x&lt;/b&gt;</strong>');
  });

  it('returns plain text unchanged', () => {
    expect(renderInlineMarkdown('plain')).toEqual(['plain']);
    expect(renderInlineMarkdown('')).toEqual([]);
  });
});

describe('renderMarkdownLite', () => {
  it('splits paragraphs on blank lines and joins soft line breaks', () => {
    expect(html('First line\ncontinues here.\n\nSecond paragraph.'))
      .toBe('<p>First line continues here.</p><p>Second paragraph.</p>');
  });

  it('renders - and * bullets as one <ul>', () => {
    expect(html('- one\n* two\n  - three'))
      .toBe('<ul><li>one</li><li>two</li><li>three</li></ul>');
  });

  it('renders numbered lists as <ol>', () => {
    expect(html('1. first\n2) second')).toBe('<ol><li>first</li><li>second</li></ol>');
  });

  it('separates lists from paragraphs and applies inline formatting inside items', () => {
    expect(html('Summary:\n- **Reels** did best\n- posts with *questions*\nThen more text.'))
      .toBe('<p>Summary:</p><ul><li><strong>Reels</strong> did best</li><li>posts with <em>questions</em></li></ul><p>Then more text.</p>');
  });

  it('handles Windows line endings and surrounding whitespace', () => {
    expect(html('  a\r\n\r\n  b  ')).toBe('<p>a</p><p>b</p>');
  });

  it('renders nothing for empty input', () => {
    expect(renderMarkdownLite('')).toEqual([]);
    expect(renderMarkdownLite('\n\n  \n')).toEqual([]);
  });

  it('MarkdownLite wraps the blocks in a fragment', () => {
    expect(renderToStaticMarkup(createElement(MarkdownLite, { text: '**hi**\n\n- x' })))
      .toBe('<p><strong>hi</strong></p><ul><li>x</li></ul>');
  });
});
