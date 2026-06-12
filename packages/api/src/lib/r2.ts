export async function uploadImage(
  bucket: R2Bucket, key: string, data: ArrayBuffer | ReadableStream, contentType: string
): Promise<string> {
  await bucket.put(key, data, { httpMetadata: { contentType } });
  return `/images/${key}`;
}

export function generateImageKey(newsId: string, ext: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `${date}/${newsId}.${ext}`;
}
