import DOMPurify from "dompurify";

/**
 * Sanitize article HTML for safe rendering via `innerHTML`.
 *
 * Background: article bodies come from upstream RSS / WordPress /
 * trafilatura / newspaper4k / Goose / Jina / Playwright. Each
 * extractor is "mostly safe" but there's no security guarantee,
 * and one malicious feed could XSS the entire site if rendered
 * raw. This wrapper is the last line of defense.
 *
 * Tag policy: allow only semantic content tags. No script, style,
 * iframe, object, embed, form, input, button. No event handlers.
 * No `javascript:` URLs in href / src.
 *
 * Attribute hardening:
 *  - `<a target=_blank>` → force `rel=noopener noreferrer` (tab-nabbing defense)
 *  - `<img>` → force `loading=lazy` (perf + avoids layout shift)
 *
 * The function is sync because DOMPurify is sync in the browser.
 * In Node (SSR / test env) it uses jsdom via the optional adapter,
 * but the tests run under happy-dom which provides `window` directly.
 */
const ALLOWED_TAGS = [
  // text
  "p", "br", "hr",
  // headings
  "h1", "h2", "h3", "h4", "h5", "h6",
  // inline
  "em", "strong", "b", "i", "u", "s", "sub", "sup", "small", "mark",
  "span", "div", "blockquote", "q", "cite", "abbr", "time",
  // code
  "pre", "code", "kbd", "samp", "var",
  // lists
  "ul", "ol", "li", "dl", "dt", "dd",
  // tables (news sites use these for sports scores, etc.)
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
  // media (img only — iframe/video/embed are stripped at tag level)
  "img", "figure", "figcaption",
  // links
  "a",
];

const ALLOWED_ATTR = [
  "href", "src", "alt", "title",
  "class", "id",
  "width", "height",
  "datetime", "lang", "dir",
  "colspan", "rowspan", "scope",
  "target", "rel", "loading", "decoding",
];

export function sanitizeArticleHtml(html: string): string {
  if (!html) return "";
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button", "select", "textarea", "link", "meta", "base"],
    FORBID_ATTR: ["style", "srcdoc"],
  });
}

/**
 * Like sanitizeArticleHtml but applies target-blank rel hardening
 * and img loading=lazy. Use this in the final read path so the
 * article view is consistent and the user can't tab-nab us.
 */
export function sanitizeArticleHtmlForView(html: string): string {
  const clean = sanitizeArticleHtml(html);
  if (!clean) return "";
  // Force rel on external links that open in new tab.
  const withRel = clean.replace(
    /<a\s+([^>]*?)target=["']_blank["']([^>]*)>/gi,
    (match, before, after) => {
      // Strip any pre-existing rel and inject ours.
      const stripped = (before + after)
        .replace(/\s*rel=["'][^"']*["']/gi, "")
        .replace(/\s*rel=[^\s>]+/gi, "");
      return `<a ${stripped} rel="noopener noreferrer" target="_blank">`;
    }
  );
  // Force loading=lazy on imgs that don't already have it.
  return withRel.replace(
    /<img\s+([^>]*?)(?:\s+loading=["'][^"']*["'])?([^>]*)>/gi,
    (match, before, after) => {
      if (/\sloading=/i.test(before + after)) return match;
      return `<img ${before}${after} loading="lazy">`;
    }
  );
}
