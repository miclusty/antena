// Extract h2/h3 headings from raw article HTML. Used by the
// TableOfContents component in ArticleDetail. Anchors are
// stable (h-0, h-1, …) so the mapper can both:
//   - pass the same id to a "scroll to" target rendered next
//     to the heading in the body, and
//   - reference the id from the TOC links.
//
// h1 is excluded (it's the article title, already in the
// header). h4+ is excluded to keep the TOC compact — most
// long-form pieces use h2/h3, not deeper nesting.

export interface Heading {
  level: 2 | 3;
  text: string;
  id: string;
}

const HEADING_PATTERN = /<h([23])(\s[^>]*)?>([\s\S]*?)<\/h\1>/gi;
const TAG_PATTERN = /<[^>]+>/g;
const MAX_TEXT = 200;

export function extractHeadings(html: string): Heading[] {
  if (!html) return [];
  const out: Heading[] = [];
  // Reset regex's lastIndex to be safe across re-uses.
  HEADING_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = HEADING_PATTERN.exec(html)) !== null) {
    const level = parseInt(m[1], 10) as 2 | 3;
    const rawText = m[3] ?? "";
    const text = rawText.replace(TAG_PATTERN, "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    out.push({
      level,
      text: text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) : text,
      id: `h-${out.length}`,
    });
  }
  return out;
}
