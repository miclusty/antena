import { describe, it, expect } from 'vitest';
import { extractHeadings, addHeadingIds } from '../lib/article-toc';

describe('extractHeadings', () => {
  it('returns empty array for empty input', () => {
    expect(extractHeadings('')).toEqual([]);
  });

  it('returns empty array for input without h2/h3', () => {
    expect(extractHeadings('<p>just a paragraph</p>')).toEqual([]);
  });

  it('parses a single h2', () => {
    const html = '<h2>Hello world</h2>';
    expect(extractHeadings(html)).toEqual([
      { level: 2, text: 'Hello world', id: 'hello-world' },
    ]);
  });

  it('parses mixed h2 and h3', () => {
    const html = '<h2>Top</h2><h3>Sub</h3><h2>Another</h2>';
    expect(extractHeadings(html)).toEqual([
      { level: 2, text: 'Top', id: 'top' },
      { level: 3, text: 'Sub', id: 'sub' },
      { level: 2, text: 'Another', id: 'another' },
    ]);
  });

  it('deduplicates repeated headings', () => {
    const html = '<h2>foo</h2><h2>foo</h2><h2>foo</h2>';
    expect(extractHeadings(html)).toEqual([
      { level: 2, text: 'foo', id: 'foo' },
      { level: 2, text: 'foo', id: 'foo-1' },
      { level: 2, text: 'foo', id: 'foo-2' },
    ]);
  });

  it('handles HTML entities', () => {
    const html = '<h2>foo &amp; bar</h2>';
    expect(extractHeadings(html)).toEqual([
      { level: 2, text: 'foo & bar', id: 'foo-bar' },
    ]);
  });

  it('strips nested tags from heading text', () => {
    const html = '<h2>foo <strong>bar</strong> baz</h2>';
    expect(extractHeadings(html)).toEqual([
      { level: 2, text: 'foo bar baz', id: 'foo-bar-baz' },
    ]);
  });
});

describe('addHeadingIds', () => {
  it('returns input unchanged when no headings', () => {
    expect(addHeadingIds('<p>nothing here</p>')).toBe('<p>nothing here</p>');
  });

  it('adds id to a single h2', () => {
    expect(addHeadingIds('<h2>Hello</h2>')).toBe('<h2 id="hello">Hello</h2>');
  });

  it('preserves existing attributes', () => {
    expect(addHeadingIds('<h2 class="x">Hi</h2>')).toBe('<h2 class="x" id="hi">Hi</h2>');
  });

  it('does not duplicate ids when called twice', () => {
    const once = addHeadingIds('<h2>foo</h2><h2>foo</h2>');
    const twice = addHeadingIds(once);
    expect(twice).toBe(once);
  });

  it('handles mixed h2 and h3', () => {
    const result = addHeadingIds('<h2>Top</h2><h3>Sub</h3>');
    expect(result).toBe('<h2 id="top">Top</h2><h3 id="sub">Sub</h3>');
  });
});
