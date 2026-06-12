// ═══════════════════════════════════════════
// Image URL helpers for R2 + Image Resizing
// ═══════════════════════════════════════════
// API exposes /img/:hash?w=&h=&fit=&fmt=
// (see packages/api/src/routes/image.ts and imageParamsSchema).
// These helpers build src/srcset attributes for <img> tags.

export interface ImageOptions {
  hash: string;
  width?: number;
  height?: number;
  fit?: 'cover' | 'contain';
  format?: 'avif' | 'webp' | 'jpg';
}

const DEFAULT_QUALITY = 80;
const ALLOWED_WIDTHS = new Set([80, 160, 240, 320, 480, 640, 800, 1080, 1280, 1920, 2560]);

function buildQuery(opts: Omit<ImageOptions, 'hash'>): URLSearchParams {
  const params = new URLSearchParams();
  if (opts.width !== undefined) params.set('w', String(Math.round(opts.width)));
  if (opts.height !== undefined) params.set('h', String(Math.round(opts.height)));
  if (opts.fit) params.set('fit', opts.fit);
  if (opts.format) params.set('fmt', opts.format);
  params.set('q', String(DEFAULT_QUALITY));
  return params;
}

export function imageUrl(opts: ImageOptions): string {
  if (!opts.hash) return '';
  const params = buildQuery(opts);
  return `/img/${opts.hash}?${params.toString()}`;
}

export function imageSrcset(
  opts: Omit<ImageOptions, 'format'>,
  widths: number[]
): string {
  if (!opts.hash || !widths.length) return '';
  return widths
    .filter((w) => ALLOWED_WIDTHS.has(w) || w > 0)
    .map((w) => `${imageUrl({ ...opts, width: w })} ${w}w`)
    .join(', ');
}

export const DEFAULT_RESPONSIVE_WIDTHS: readonly number[] = [320, 480, 640, 800, 1080, 1280];

export function responsiveImageSrcset(
  hash: string,
  fit: 'cover' | 'contain' = 'cover'
): string {
  return imageSrcset({ hash, fit }, DEFAULT_RESPONSIVE_WIDTHS as unknown as number[]);
}
