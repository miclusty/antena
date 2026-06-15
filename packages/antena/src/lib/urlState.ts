export interface URLState {
  category: string | null;
  locationId: string | null;
  view: string | null;
  articleId: string | null;
}

/**
 * Build the canonical SEO URL for an article when slug+slug_date
 * are present, otherwise fall back to the legacy ?view=article&id=
 * form (used during the migration window for cards that haven't
 * been backfilled yet). Returns null if neither piece is available.
 */
export function articleCanonicalPath(slug: string | null | undefined, slugDate: string | null | undefined, fallbackId: string): string {
  if (slug && slugDate) {
    const [y, m, d] = slugDate.split('-');
    if (y && m && d) return `/${y}/${m}/${d}/${slug}/`;
  }
  return `/?view=article&id=${encodeURIComponent(fallbackId)}`;
}

export function parseURLState(): URLState {
  if (typeof window === 'undefined') return { category: null, locationId: null, view: null, articleId: null };

  const params = new URLSearchParams(window.location.search);
  return {
    category: params.get('cat'),
    locationId: params.get('loc'),
    view: params.get('view'),
    articleId: params.get('id'),
  };
}

export function updateURL(params: Record<string, string | null>) {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  Object.entries(params).forEach(([key, value]) => {
    if (value) {
      url.searchParams.set(key, value);
    } else {
      url.searchParams.delete(key);
    }
  });
  window.history.pushState({}, '', url.toString());
}

/**
 * Push a new history state with the given pathname. Used for
 * article view navigation where the URL shape is a path
 * (`/<y>/<m>/<d>/<slug>/`) instead of query params.
 */
export function pushPath(path: string) {
  if (typeof window === 'undefined') return;
  window.history.pushState({}, '', path);
}

export function clearURL() {
  if (typeof window === 'undefined') return;
  window.history.pushState({}, '', window.location.pathname);
}