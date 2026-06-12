/**
 * RSS/Atom Feed Parser Module
 * Parses RSS and Atom feeds and extracts news items
 */

export interface RSSItem {
  title: string;
  link: string;
  description?: string;
  content?: string;
  pubDate?: string;
  imageUrl?: string;
  guid?: string;
}

export interface RSSFeed {
  title: string;
  link: string;
  description?: string;
  items: RSSItem[];
}

/**
 * Parse RSS or Atom feed from URL
 */
export async function parseFeed(url: string): Promise<RSSFeed | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "AKIRA/1.0 Feed Parser" },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) return null;

    const xml = await response.text();
    return parseFeedXML(xml, url);
  } catch (error) {
    console.error("Feed parse error:", error);
    return null;
  }
}

/**
 * Parse RSS/Atom XML string
 */
function parseFeedXML(xml: string, sourceUrl: string): RSSFeed {
  // Clean and normalize XML
  const cleanXml = xml
    .replace(/<!\[CDATA\[([^\]]*)\]\]>/g, (_, content) => escapeXml(content))
    .replace(/&(?!amp;|lt;|gt;|quot;|apos;)/g, "&amp;");

  // Detect feed type
  const isAtom = cleanXml.includes("<feed");

  if (isAtom) {
    return parseAtomFeed(cleanXml, sourceUrl);
  }
  return parseRSSFeed(cleanXml, sourceUrl);
}

function parseRSSFeed(xml: string, sourceUrl: string): RSSFeed {
  const channelMatch = xml.match(/<channel[^>]*>([\s\S]*?)<\/channel>/i);
  const channelContent = channelMatch ? channelMatch[1] : xml;

  const feed: RSSFeed = {
    title: extractTag(channelContent, "title") || "Unknown Feed",
    link: extractTag(channelContent, "link") || sourceUrl,
    description: extractTag(channelContent, "description"),
    items: [],
  };

  // Extract items
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let itemMatch;

  while ((itemMatch = itemRegex.exec(xml)) !== null) {
    const itemXml = itemMatch[1];
    const item: RSSItem = {
      title: cleanText(extractTag(itemXml, "title") || ""),
      link: extractTag(itemXml, "link") || "",
      description: cleanText(extractTag(itemXml, "description")),
      content: cleanText(extractTag(itemXml, "content:encoded") || extractTag(itemXml, "content")),
      pubDate: extractTag(itemXml, "pubDate") || extractTag(itemXml, "dc:date"),
      guid: extractTag(itemXml, "guid"),
    };

    // Extract image
    item.imageUrl = extractMediaContent(itemXml) || extractEnclosure(itemXml);

    if (item.title && item.link) {
      feed.items.push(item);
    }
  }

  return feed;
}

function parseAtomFeed(xml: string, sourceUrl: string): RSSFeed {
  const feed: RSSFeed = {
    title: extractTag(xml, "title") || "Unknown Feed",
    link: extractAtomLink(xml) || sourceUrl,
    subtitle: extractTag(xml, "subtitle"),
    items: [],
  };

  // Extract entries
  const entryRegex = /<entry[^>]*>([\s\S]*?)<\/entry>/gi;
  let entryMatch;

  while ((entryMatch = entryRegex.exec(xml)) !== null) {
    const entryXml = entryMatch[1];
    const item: RSSItem = {
      title: cleanText(extractTag(entryXml, "title") || ""),
      link: extractAtomLink(entryXml) || "",
      description: cleanText(extractTag(entryXml, "summary")),
      content: cleanText(extractTag(entryXml, "content")),
      pubDate: extractTag(entryXml, "published") || extractTag(entryXml, "updated"),
      guid: extractTag(entryXml, "id"),
    };

    // Extract image
    item.imageUrl = extractMediaContent(entryXml) || extractAtomLinkRel(entryXml, "enclosure");

    if (item.title && item.link) {
      feed.items.push(item);
    }
  }

  return feed;
}

// Helper functions
function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cleanText(text: string | null): string | undefined {
  if (!text) return undefined;
  return text
    .replace(/<[^>]*>/g, "") // Remove HTML tags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function extractTag(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function extractAtomLink(xml: string): string | null {
  const match = xml.match(/<link[^>]+href=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function extractAtomLinkRel(xml: string, rel: string): string | null {
  const match = xml.match(new RegExp(`<link[^>]+rel=["']${rel}["'][^>]+href=["']([^"']+)["']`, "i"));
  return match ? match[1] : null;
}

function extractMediaContent(xml: string): string | null {
  // Try media:content
  let match = xml.match(/<media:content[^>]+url=["']([^"']+)["']/i);
  if (match) return match[1];

  // Try media:thumbnail
  match = xml.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
  if (match) return match[1];

  // Try enclosure with image type
  match = xml.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]+type=["']image\/[^"']+["']/i);
  if (match) return match[1];

  // Try enclosure with image type (reversed attributes)
  match = xml.match(/<enclosure[^>]+type=["']image\/[^"']+["'][^>]+url=["']([^"']+)["']/i);
  if (match) return match[1];

  return null;
}

function extractEnclosure(xml: string): string | null {
  const match = xml.match(/<enclosure[^>]+url=["']([^"']+)["']/i);
  return match ? match[1] : null;
}
