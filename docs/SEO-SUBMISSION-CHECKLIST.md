# Antena — Manual SEO Submission Checklist

Run these steps ONCE to get indexed on every major
search engine + news aggregator. After this, IndexNow
plus the cron-driven sitemap ping keep things fresh.

## 1. Google Search Console (highest priority)

- Open https://search.google.com/search-console
- Add property `https://antena.com.ar` (DNS TXT verify)
- Submit sitemap: `https://www.antena.com.ar/sitemap.xml`
- Inspect URL: paste any `/noticia/<id>` URL and click
  "Request indexing" for the top 10 most-shared ones
- Coverage: fix any "Excluded" or "Discovered - currently
  not indexed" issues. The 100 pre-rendered articles
  should all be "Indexed" within 48 hours of submission.

## 2. Bing Webmaster Tools (because IndexNow is Bing's)

- Open https://www.bing.com/webmasters
- Add `https://antena.com.ar`
- Submit sitemap: `https://www.antena.com.ar/sitemap.xml`
- IndexNow is already wired via `/antena2026indexnow.txt`
  — Bing will pick up new URLs within minutes.

## 3. Yandex (largest non-Google search in Russia, also
   uses IndexNow for Latin URLs)

- Open https://webmaster.yandex.com
- Add `https://antena.com.ar`
- Submit sitemap
- IndexNow auto-syncs

## 4. News aggregators (these drive the BIG traffic)

### Google News
- Apply: https://publishercenter.google.com
- Requirements: NewsArticle schema (✅ done), valid RSS
  (✅ done at `/rss.xml`), original content, no scraped
  content. Approval takes 1-2 weeks.

### Bing News
- Same as Webmaster Tools, but tag the feed as
  "news" in the metadata.

### Apple News
- Apply: https://www.icloud.com/newspublisher/
- Requires iCloud Publisher account

### Flipboard
- Auto-discovered via RSS at `/rss.xml` once your site
  is in their crawler set. Submit manually:
  https://about.flipboard.com/flipboard-news-publisher-2/

### Bing News PubHub
- https://www.bing.com/ping?u=https://www.antena.com.ar/sitemap.xml
  (we already auto-ping this from the cron)

## 5. Wikipedia / Wikidata (huge SEO boost)

- Create a Wikidata item for Antena: https://www.wikidata.org
- Properties to add: official website, country, language,
  instance of (news agency), inception date
- Link from "News media in Argentina" Wikipedia article
  if/when Antena gets a Spanish Wikipedia page
- Authority flows from Wikipedia to your domain.

## 6. AI bot discovery (already in robots.txt)

- GPTBot + ChatGPT-User + OAI-SearchBot
- ClaudeBot + Claude-User + anthropic-ai
- PerplexityBot + Perplexity-User
- Google-Extended (Gemini training)
- Applebot-Extended
- Amazonbot
- CCBot
- Bytespider

These are all explicitly Allowed in robots.txt so the
content is crawlable for citation. No manual action
needed.

## 7. Social profiles (cross-link for Knowledge Graph)

Set up these accounts and link back to antena.com.ar:
- Twitter/X: @antena_ar
- Instagram: @antena.ar
- LinkedIn: company page
- YouTube: channel (when we have video)
- Facebook page (last resort, but needed for some
  Discovery integrations)

Each profile bio should include the URL. This populates
the `sameAs` field in the Organization JSON-LD.

## 8. Local SEO (for /ciudad/* topic hubs)

- Create a Google Business Profile for "Antena HQ" in
  Buenos Aires (or wherever the team is based)
- Submit the site to local Argentine directories:
  - GuíaLocal.com.ar
  - DirectorioWeb.com.ar
  - PaginasAmarillas.com.ar
- Each `ciudad/X` page should ideally have its own
  Google Business entry per city we cover.

## 9. Monitoring (set up Day 1)

- Google Search Console: weekly coverage + queries
- Bing Webmaster Tools: monthly
- Plausible Analytics (https://plausible.io) — add
  to Layout, gives you realtime traffic without
  breaking the no-tracking promise (cookie-less)
- Uptime monitoring: https://uptime.com or
  betterstack.com (free tier)

## 10. Content cadence (the actual ranking factor)

- AKIRA runs every 2h; the cron re-pings IndexNow +
  Google sitemap → new articles get indexed in
  minutes, not days
- Each /ciudad/X + /categoria/Y hub auto-pulls the
  latest articles, so they get fresh content every
  build (every 2h)
- Aim for 50-200 articles/day to be competitive with
  Argentine aggregators (GoogleNews, MinutoUno)

## After this checklist

Once Google Search Console is set up and the sitemap is
submitted, organic traffic compounds:
- Day 1-3: 0 impressions
- Week 1: ~10-100 impressions/day from long-tail
- Month 1: ~1k-10k impressions/day if content cadence
  is 50+ articles/day
- Month 6: top-3 ranking for "noticias de [ciudad]"
  type queries
