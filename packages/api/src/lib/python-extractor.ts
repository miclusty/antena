/**
 * Python Extractor integration
 * The Python extractor (akira_extractor.py) runs on port 5000 and handles
 * the extraction cascade: RSS → WP API → Newspaper3k → Goose3 → Sitemap → Playwright → Jina
 */

const PYTHON_EXTRACTOR_URL = process.env.PYTHON_EXTRACTOR_URL || "http://localhost:5000";

/**
 * Check if the Python extractor is available
 */
export async function checkPythonExtractor(): Promise<boolean> {
  try {
    const response = await fetch(`${PYTHON_EXTRACTOR_URL}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Extract using Newspaper3k from Python extractor
 */
export async function extractWithNewspaper(url: string, language = "es"): Promise<unknown> {
  const response = await fetch(`${PYTHON_EXTRACTOR_URL}/extract/newspaper`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, language }),
    signal: AbortSignal.timeout(30000),
  });
  return response.json();
}

/**
 * Extract using Goose3 from Python extractor
 */
export async function extractWithGoose(url: string): Promise<unknown> {
  const response = await fetch(`${PYTHON_EXTRACTOR_URL}/extract/goose`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(30000),
  });
  return response.json();
}

/**
 * Hybrid extraction: best of Newspaper + Goose
 */
export async function extractHybrid(url: string): Promise<unknown> {
  const response = await fetch(`${PYTHON_EXTRACTOR_URL}/extract/hybrid`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal: AbortSignal.timeout(30000),
  });
  return response.json();
}

/**
 * RSS extraction using Python feedparser
 */
export async function extractRSSWithPython(url: string, limit = 20): Promise<unknown> {
  const response = await fetch(`${PYTHON_EXTRACTOR_URL}/extract/rss`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, limit }),
    signal: AbortSignal.timeout(20000),
  });
  return response.json();
}

/**
 * Scan a site for article URLs using sitemap
 */
export async function scanSiteForArticles(url: string): Promise<unknown> {
  const response = await fetch(`${PYTHON_EXTRACTOR_URL}/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, prefer_method: "sitemap" }),
    signal: AbortSignal.timeout(20000),
  });
  return response.json();
}
