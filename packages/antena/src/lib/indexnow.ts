// IndexNow API integration. When a new article is
// published (or we generate a new static page), ping
// IndexNow to get it indexed in Bing / Yandex / Seznam /
// Naver within minutes instead of days.
//
// Key generation: any random hex string. The key must
// be hosted at the same domain as the URLs being
// submitted. We host /indexnow-key.txt and reference
// the key here.
//
// API docs: https://www.indexnow.org/documentation
//
// We also submit the top N URLs on app boot (best-effort)
// so even the first cold start gets fast indexing.

const INDEXNOW_KEY = 'antena2026indexnow';
const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

// Public verify file. The key file MUST exist at the
// root of the host so the search engines can verify
// the submitter owns the domain. Pages serves /public
// at the root, so this file is exposed at
// /indexnow-key.txt.
export const INDEXNOW_VERIFY_URL = `https://antena.com.ar/${INDEXNOW_KEY}.txt`;

/** Submit a list of URLs to IndexNow. Returns the number
 *  of URLs accepted (200) or 0 on error. */
export async function submitToIndexNow(urls: string[]): Promise<number> {
  if (urls.length === 0) return 0;
  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: 'antena.com.ar',
        key: INDEXNOW_KEY,
        keyLocation: INDEXNOW_VERIFY_URL,
        urlList: urls.slice(0, 10000), // IndexNow max
      }),
    });
    return res.ok ? urls.length : 0;
  } catch {
    return 0;
  }
}

/** Submit just one URL. */
export async function pingIndexNow(url: string): Promise<boolean> {
  return (await submitToIndexNow([url])) > 0;
}
