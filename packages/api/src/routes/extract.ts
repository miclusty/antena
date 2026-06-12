import { Hono } from "hono";
import type { Env } from "../lib/types";
import { authMiddleware } from "../middleware/auth";
import { extractWithFallback, batchExtract } from "../lib/extraction-engine";
import { getSourceHealth, getProblematicSources, resetCircuit } from "../lib/source-health";

export const extractRoutes = new Hono<{ Bindings: Env }>();

// Extract from single source (auth required)
extractRoutes.post("/extract", authMiddleware, async (c) => {
  const body = await c.req.json();
  const { url, source_id, source_name, options } = body;
  
  if (!url) {
    return c.json({ error: "Missing url" }, 400);
  }

  const result = await extractWithFallback(
    url,
    source_id ?? 0,
    source_name ?? url,
    options ?? {}
  );

  return c.json(result);
});

// Batch extract from multiple sources (auth required)
extractRoutes.post("/extract/batch", authMiddleware, async (c) => {
  const body = await c.req.json();
  const { sources, options } = body;
  
  if (!sources || !Array.isArray(sources)) {
    return c.json({ error: "Missing or invalid sources array" }, 400);
  }

  const result = await batchExtract(sources, options ?? {});
  return c.json(result);
});

// Get source health status
extractRoutes.get("/health/:sourceId", async (c) => {
  const sourceId = parseInt(c.req.param("sourceId"));
  
  if (isNaN(sourceId)) {
    return c.json({ error: "Invalid source ID" }, 400);
  }

  const health = await getSourceHealth(sourceId);
  
  if (!health) {
    return c.json({ error: "No health data for this source" }, 404);
  }

  return c.json(health);
});

// Get problematic sources (health check report)
extractRoutes.get("/health/report", async (c) => {
  const problematic = await getProblematicSources();
  
  return c.json({
    problematic_sources: problematic,
    total_problematic: problematic.length,
    timestamp: new Date().toISOString()
  });
});

// Reset circuit breaker for a source (admin only)
extractRoutes.post("/health/:sourceId/reset", authMiddleware, async (c) => {
  const sourceId = parseInt(c.req.param("sourceId"));
  
  if (isNaN(sourceId)) {
    return c.json({ error: "Invalid source ID" }, 400);
  }

  await resetCircuit(sourceId);
  
  return c.json({ 
    status: "ok", 
    message: `Circuit reset for source ${sourceId}` 
  });
});
