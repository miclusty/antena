const SCROLL_KEY = 'antena-scroll-feed';

export function saveScrollPos(): void {
  try {
    sessionStorage.setItem(SCROLL_KEY, String(window.scrollY));
  } catch {}
}

function getScrollPos(): number {
  try {
    return parseInt(sessionStorage.getItem(SCROLL_KEY) || '0', 10);
  } catch { return 0; }
}

export function restoreScrollPos(): void {
  const pos = getScrollPos();
  if (pos > 0) {
    requestAnimationFrame(() => window.scrollTo(0, pos));
  }
}
