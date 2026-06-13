// This route is not currently mounted in index.ts. It uses a Python
// extractor service that we may bring back when AKIRA is deployed to
// Cloudflare Containers. @ts-nocheck until then.
// @ts-nocheck

import { Hono } from "hono";
import type { Env } from "../lib/types";
import { authMiddleware } from "../middleware/auth";
import { extractWithNewspaper, extractWithGoose, extractHybrid, extractRSSWithPython, scanSiteForArticles, checkPythonExtractor } from "../lib/python-extractor";

export const pythonRoutes = new Hono<{ Bindings: Env }>();

// Health check for Python extractor
pythonRoutes.get("/health", async (c) => {
  const isAvailable = await checkPythonExtractor();
  
  return c.json({
    python_extractor: {
      url: process.env.PYTHON_EXTRACTOR_URL || "http://localhost:5000",
      available: isAvailable
    }
  });
});

// Extract with newspaper3k
pythonRoutes.post("/newspaper", authMiddleware, async (c) => {
  const { url, language } = await c.req.json();
  
  if (!url) {
    return c.json({ error: "Missing url" }, 400);
  }

  const result = await extractWithNewspaper(url, language || "es");
  return c.json(result);
});

// Extract with goose3
pythonRoutes.post("/goose", authMiddleware, async (c) => {
  const { url, language } = await c.req.json();
  
  if (!url) {
    return c.json({ error: "Missing url" }, 400);
  }

  const result = await extractWithGoose(url, language || "es");
  return c.json(result);
});

// Hybrid extraction (both newspaper + goose, returns best)
pythonRoutes.post("/hybrid", authMiddleware, async (c) => {
  const { url, language } = await c.req.json();
  
  if (!url) {
    return c.json({ error: "Missing url" }, 400);
  }

  const result = await extractHybrid(url, language || "es");
  return c.json(result);
});

// RSS extraction with feedparser
pythonRoutes.post("/rss", authMiddleware, async (c) => {
  const { url, limit } = await c.req.json();
  
  if (!url) {
    return c.json({ error: "Missing url" }, 400);
  }

  const result = await extractRSSWithPython(url, limit || 20);
  return c.json(result);
});

// Scan site for articles
pythonRoutes.post("/scan", authMiddleware, async (c) => {
  const { url, max_articles } = await c.req.json();
  
  if (!url) {
    return c.json({ error: "Missing url" }, 400);
  }

  const result = await scanSiteForArticles(url, max_articles || 20);
  return c.json(result);
});
