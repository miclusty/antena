#!/usr/bin/env node
// Generate PWA PNG icons from public/icons/icon.svg.
// Produces:
//   icon-180.png         (iOS home screen, retina)
//   icon-192.png         (Android Chrome / manifest)
//   icon-512.png         (Android Chrome splash / manifest)
//   icon-maskable-512.png (maskable, safe-zone aware — pads the source artwork
//                          so the OS-mandated inner 80% circle is filled)
//
// Run: node scripts/generate-icons.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, '../public/icons/icon.svg');
const OUT_DIR = resolve(__dirname, '../public/icons');

mkdirSync(OUT_DIR, { recursive: true });

const svg = readFileSync(SRC, 'utf-8');

// Render sizes — matches the manifest in astro.config.mjs.
const targets = [
  { file: 'icon-180.png', size: 180, maskable: false },
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
];

for (const { file, size, maskable } of targets) {
  // Maskable icons need a ~12% safe-zone padding so the OS-mandated
  // inner 80% circle is fully filled. We achieve this by upscaling
  // the SVG onto a transparent canvas 12% larger, then re-cropping to
  // the final size — the original art stays centered but shrinks
  // proportionally so nothing important gets clipped.
  const inner = maskable ? Math.round(size * 0.76) : size;
  const buf = await sharp(Buffer.from(svg))
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  // Compose the inner render onto a square canvas with the brand
  // background color. Maskable uses the same dark brand bg as the
  // app shell (#0F1117) so the visible region is brand-consistent
  // and the safe zone reads as "Antena on a dark plate".
  const bg = maskable ? '#0F1117' : '#1A1A2E';
  const final = await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: bg,
    },
  })
    .composite([{ input: buf, gravity: 'center' }])
    .png()
    .toBuffer();
  writeFileSync(resolve(OUT_DIR, file), final);
  console.log(`✓ ${file} (${size}x${size}, ${maskable ? 'maskable' : 'standard'})`);
}

console.log(`\nWrote ${targets.length} PNGs to ${OUT_DIR}`);