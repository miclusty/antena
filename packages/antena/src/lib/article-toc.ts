/**
 * Parse h2/h3 headings out of a sanitized HTML article body.
 * Returns an array of { level, text, id } for use in the SSR
 * table-of-contents. IDs are slugified and deduplicated so they
 * are stable as both anchor targets and keys in the React/Solid
 * overlay (ArticleDetail.tsx) on the SPA path.
 */
export interface ArticleHeading {
  level: 2 | 3;
  text: string;
  id: string;
}

const SLUG_MAX = 80;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&([a-z]+);/gi, (m, name) => NAMED_ENTITIES[name.toLowerCase()] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

export function slugifyHeading(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')        // strip accents
    .toLowerCase()
    .replace(/&[a-z]+;/g, ' ')                // strip named entities (&amp; etc.)
    .replace(/&#\d+;/g, ' ')                 // strip numeric entities
    .replace(/<[^>]*>/g, ' ')                 // strip any nested tags
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/, '') || 'section';
}

export function extractHeadings(html: string): ArticleHeading[] {
  const headings: ArticleHeading[] = [];
  const seen = new Map<string, number>();
  const re = /<h([23])(?:\s[^>]*)?>([\s\S]*?)<\/h\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const level = Number(m[1]) as 2 | 3;
    const inner = decodeEntities(m[2].replace(/<[^>]+>/g, '')).trim();
    if (!inner) continue;
    const base = slugifyHeading(inner);
    const seenCount = seen.get(base) ?? 0;
    seen.set(base, seenCount + 1);
    const id = seenCount === 0 ? base : `${base}-${seenCount}`;
    headings.push({ level, text: inner, id });
  }
  return headings;
}

/**
 * Walk h2/h3 elements in an HTML string and inject id="..." derived
 * from the inner text. Idempotent: running twice on the same input
 * is a no-op (already has ids).
 */
export function addHeadingIds(html: string): string {
  const seen = new Set<string>();
  return html.replace(
    /<h([23])((?:\s[^>]*)?)>([\s\S]*?)<\/h\1>/gi,
    (_full, level: string, attrs: string, inner: string) => {
      const text = decodeEntities(inner.replace(/<[^>]+>/g, '')).trim();
      let id = slugifyHeading(text);
      let suffix = 1;
      while (seen.has(id)) id = `${slugifyHeading(text)}-${suffix++}`;
      seen.add(id);
      const existingIdMatch = /\bid="[^"]*"/.exec(attrs);
      if (existingIdMatch) return `<h${level}${attrs}>${inner}</h${level}>`;
      return `<h${level}${attrs} id="${id}">${inner}</h${level}>`;
    },
  );
}