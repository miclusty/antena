import { Hono } from "hono";
import type { Env } from "../lib/types";
import { authMiddleware } from "../middleware/auth";
import { checkPythonExtractor } from "../lib/python-extractor";
import { getAkiraBaseUrl } from "../lib/akira-url";

export const extractUnifiedRoutes = new Hono<{ Bindings: Env }>();

// Health check for Python extractor
extractUnifiedRoutes.get("/health", async (c) => {
  const isAvailable = await checkPythonExtractor();

  return c.json({
    python_extractor: {
      url: getAkiraBaseUrl() ?? "not configured (AKIRA not deployed in prod)",
      available: isAvailable
    }
  });
});

// Proxy to Python extractor's unified extraction endpoint
extractUnifiedRoutes.post("/", authMiddleware, async (c) => {
  const pythonExtractorUrl = getAkiraBaseUrl();

  // No AKIRA configured — return 503 instead of crashing.
  if (!pythonExtractorUrl) {
    return c.json({
      error: "AKIRA extractor not configured",
      message: "Set AKIRA_URL environment variable to enable Python extraction.",
    }, 503);
  }

  // Forward the entire request to Python extractor's /extract endpoint
  const requestUrl = `${pythonExtractorUrl}/extract`;
  
  try {
    // Clone the request to forward body and headers
    const incomingRequest = c.req.raw;
    const forwardRequest = new Request(requestUrl, {
      method: incomingRequest.method,
      headers: incomingRequest.headers,
      body: incomingRequest.body,
      // @ts-ignore - duplex is needed for streaming body in Node.js
      duplex: 'half'
    });
    
    const response = await fetch(forwardRequest);
    // Return the response as-is (status, headers, body)
    return new Response(response.body, {
      status: response.status,
      headers: response.headers
    });
  } catch (error) {
    return c.json({
      success: false,
      error: (error as Error).message,
      python_extractor: pythonExtractorUrl
    }, 502);
  }
});