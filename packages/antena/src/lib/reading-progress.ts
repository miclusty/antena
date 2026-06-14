// Reading-time helpers. The "5 min de lectura" copy is shown
// statically in the article header; the remaining-time hint
// (S3.9) is computed from the same total minus the share
// already scrolled, so we don't show "te quedan 4 min" when
// the user is at the bottom of the page.

const WORDS_PER_MINUTE = 200;

export function readingTimeText(body: string): string {
  if (!body.trim()) return "0 min de lectura";
  const words = body.trim().split(/\s+/).length;
  const minutos = Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
  return `${minutos} min de lectura`;
}

/**
 * Remaining reading minutes after the user has scrolled `scrolledPx`
 * of a page that has `scrollMaxPx` more to scroll.
 *
 * Linear: at the top you see the full estimate; at the bottom
 * you see 0. We round UP so users never see "0 min left" while
 * there's still content to read.
 */
export function remainingReadingMinutes(totalMinutes: number, scrollPct: number): number {
  const pct = Math.max(0, Math.min(1, scrollPct));
  return Math.max(0, Math.ceil(totalMinutes * (1 - pct)));
}

export function computeScrollPct(scrolledPx: number, scrollMaxPx: number): number {
  if (scrollMaxPx <= 0) return 0;
  if (scrolledPx <= 0) return 0;
  if (scrolledPx >= scrollMaxPx) return 1;
  return scrolledPx / scrollMaxPx;
}
