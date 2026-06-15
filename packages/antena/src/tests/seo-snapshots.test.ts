import { describe, expect, test } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PAGES = [
  { file: 'index.html', key: 'home' },
  { file: 'about/index.html', key: 'about' },
  { file: 'contacto/index.html', key: 'contacto' },
  { file: 'privacidad/index.html', key: 'privacidad' },
  { file: '404.html', key: '404' },
];

const __dirname = dirname(fileURLToPath(import.meta.url));
const DIST = join(__dirname, '..', '..', 'dist');

function extractHead(html: string): string {
  const match = html.match(/<head>([\s\S]*?)<\/head>/);
  return match ? match[1].trim() : '';
}

describe('SEO head snapshots', () => {
  for (const { file, key } of PAGES) {
    test(`${key} head snapshot`, () => {
      if (!existsSync(join(DIST, file))) return;
      const html = readFileSync(join(DIST, file), 'utf-8');
      const head = extractHead(html);
      expect(head).toMatchSnapshot(key);
    });
  }
});
