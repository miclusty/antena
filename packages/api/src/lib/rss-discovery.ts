/**
 * RSS/Atom Feed Discovery Module
 * Discovers RSS and Atom feeds from a given URL
 */

export interface DiscoveredFeed {
  url: string;
  type: "rss" | "atom" | "unknown";
  title?: string;
}

/**
 * Discover RSS/Atom feeds from a URL
 * Looks for <link> tags with feed MIME types
 */
export async function discoverFeeds(url: string): Promise<DiscoveredFeed[]> {
  const feeds: DiscoveredFeed[] = [];
  const seen = new Set<string>();

  try {
    // Normalize URL
    const baseUrl = new URL(url);
    const response = await fetch(url, {
      headers: { "User-Agent": "AKIRA/1.0 Feed Discovery" },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return feeds;

    const html = await response.text();

    // Look for <link> tags with RSS/Atom types
    const linkRegex = /<link[^>]+(?:type=["'](application\/(?:rss\+xml|atom\+xml)|application\/xml|text\/xml)["'][^>]*href=["']([^"']+)["']|href=["']([^"']+)["'][^>]*type=["'](application\/(?:rss\+xml|atom\+xml)|application\/xml|text\/xml)["'])[^>]*>/gi;

    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      const feedUrl = match[2] || match[3];
      const mimeType = match[1] || match[4];

      if (feedUrl && !seen.has(feedUrl)) {
        seen.add(feedUrl);
        const absoluteUrl = new URL(feedUrl, baseUrl).href;
        const type = mimeType?.includes("atom") ? "atom" : "rss";
        feeds.push({ url: absoluteUrl, type });
      }
    }

    // Also check common feed paths if no feeds found
    if (feeds.length === 0) {
      const commonPaths = ["/feed", "/rss", "/rss.xml", "/feed.xml", "/atom.xml", "/feeds/posts/default"];
      for (const path of commonPaths) {
        const feedUrl = new URL(path, baseUrl).href;
        try {
          const checkResponse = await fetch(feedUrl, {
            method: "HEAD",
            headers: { "User-Agent": "AKIRA/1.0 Feed Discovery" },
            signal: AbortSignal.timeout(5000),
          });
          if (checkResponse.ok) {
            const contentType = checkResponse.headers.get("content-type") || "";
            if (contentType.includes("xml") || contentType.includes("rss") || contentType.includes("atom")) {
              feeds.push({
                url: feedUrl,
                type: contentType.includes("atom") ? "atom" : "rss",
              });
            }
          }
        } catch {
          // Skip failed checks
        }
      }
    }

    // Validate HTML content type
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("html")) {
      // If the URL itself returns XML, it might be a feed
      if (contentType.includes("xml") || contentType.includes("rss") || contentType.includes("atom")) {
        feeds.unshift({
          url: url,
          type: contentType.includes("atom") ? "atom" : "rss",
        });
      }
    }

  } catch (error) {
    console.error("Feed discovery error:", error);
  }

  return feeds;
}

/**
 * Validate that a URL is a working feed
 */
export async function validateFeed(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "AKIRA/1.0 Feed Discovery" },
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return false;

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("xml") && !contentType.includes("rss") && !contentType.includes("atom")) {
      return false;
    }

    const text = await response.text();
    return text.includes("<rss") || text.includes("<feed") || text.includes("<channel");
  } catch {
    return false;
  }
}
