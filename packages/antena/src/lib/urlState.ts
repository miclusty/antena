export interface URLState {
  category: string | null;
  locationId: string | null;
  view: string | null;
  articleId: string | null;
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

export function clearURL() {
  if (typeof window === 'undefined') return;
  window.history.pushState({}, '', window.location.pathname);
}