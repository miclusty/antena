import { Hono } from "hono";
import type { Env } from "../lib/types";
import { authMiddleware } from "../middleware/auth";
import { uploadImage, generateImageKey } from "../lib/r2";

export const imagesRoutes = new Hono<{ Bindings: Env }>();

imagesRoutes.post("/upload", authMiddleware, async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("image") as File | null;
  const newsId = formData.get("news_id") as string | null;
  if (!file) return c.json({ error: "No image provided" }, 400);
  if (!newsId) return c.json({ error: "news_id required" }, 400);
  const ext = file.name.split(".").pop() || "webp";
  const key = generateImageKey(newsId, ext);
  const arrayBuffer = await file.arrayBuffer();
  const url = await uploadImage(c.env.IMAGES, key, arrayBuffer, file.type);
  return c.json({ url, key }, 201);
});

imagesRoutes.post("/upload-base64", authMiddleware, async (c) => {
  const body = await c.req.json<{ news_id: string; data: string; content_type: string }>();
  if (!body.news_id || !body.data) return c.json({ error: "Missing news_id or data" }, 400);
  const ext = body.content_type.includes("webp") ? "webp" : body.content_type.includes("avif") ? "avif" : "jpg";
  const key = generateImageKey(body.news_id, ext);
  const binaryString = atob(body.data);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  const url = await uploadImage(c.env.IMAGES, key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, body.content_type);
  return c.json({ url, key }, 201);
});
