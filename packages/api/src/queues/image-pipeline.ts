import type { Env } from "../lib/types";

export interface ImagePipelineMessage {
  type: "fetch_and_store";
  hash: string;
  requestTime: number;
}

export async function handleImagePipeline(
  batch: MessageBatch<ImagePipelineMessage>,
  env: Env
): Promise<void> {
  for (const msg of batch.messages) {
    const data = msg.body;
    if (data.type !== "fetch_and_store") {
      msg.ack();
      continue;
    }
    try {
      const card = await env.DB.prepare(
        "SELECT image_url FROM news_cards WHERE id = ? OR image_hash = ?"
      )
        .bind(data.hash, data.hash)
        .first<{ image_url: string | null }>();

      const sourceUrl = card?.image_url;
      if (!sourceUrl) {
        console.warn(`image-pipeline: no source URL for hash=${data.hash}`);
        msg.ack();
        continue;
      }

      const response = await fetch(sourceUrl);
      if (!response.ok) {
        console.warn(
          `image-pipeline: upstream returned ${response.status} for ${sourceUrl}`
        );
        msg.ack();
        continue;
      }

      const blob = await response.arrayBuffer();
      const contentType =
        response.headers.get("content-type") ?? "image/jpeg";
      await env.IMAGES.put(data.hash, blob, {
        httpMetadata: { contentType },
      });
    } catch (e) {
      console.error("image-pipeline error:", e);
    }
    msg.ack();
  }
}
