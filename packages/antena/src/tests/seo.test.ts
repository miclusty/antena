import { describe, expect, test } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PAGES = [
  { file: 'index.html', path: '/' },
  { file: 'about/index.html', path: '/about' },
  { file: 'contacto/index.html', path: '/contacto' },
  { file: 'privacidad/index.html', path: '/privacidad' },
  { file: '404/index.html', path: '/404' },
  { file: 'buscar/index.html', path: '/buscar' },
  { file: 'settings/index.html', path: '/settings' },
];

const NOINDEX_PAGES = ['/404', '/buscar', '/settings'];
const DIST = join(process.cwd(), 'packages/antena/dist');

describe('SEO compliance (built pages)', () => {
  for (const { file, path } of PAGES) {
    test(`${path} has title, description, canonical`, () => {
      if (!existsSync(join(DIST, file))) return; // skip if not built yet
      const html = readFileSync(join(DIST, file), 'utf-8');
      expect(html).toMatch(/<title>[^<]+<\/title>/);
      expect(html).toMatch(/<meta name="description" content="[^"]+"/);
      expect(html).toMatch(/<link rel="canonical" href="https:\/\/www\.antena\.com\.ar[^"]+"/);
    });

    test(`${path} has og:url with www.`, () => {
      if (!existsSync(join(DIST, file))) return;
      const html = readFileSync(join(DIST, file), 'utf-8');
      expect(html).toMatch(/og:url" content="https:\/\/www\.antena\.com\.ar/);
    });

    test(`${path} has og:title, og:description, og:image, og:site_name`, () => {
      if (!existsSync(join(DIST, file))) return;
      const html = readFileSync(join(DIST, file), 'utf-8');
      expect(html).toMatch(/og:title" content="[^"]+"/);
      expect(html).toMatch(/og:description" content="[^"]+"/);
      expect(html).toMatch(/og:image" content="[^"]+"/);
      expect(html).toMatch(/og:site_name" content="Antena"/);
    });

    test(`${path} has twitter:card`, () => {
      if (!existsSync(join(DIST, file))) return;
      const html = readFileSync(join(DIST, file), 'utf-8');
      expect(html).toMatch(/twitter:card" content="summary_large_image"/);
    });

    test(`${path} has hreflang es-AR and x-default`, () => {
      if (!existsSync(join(DIST, file))) return;
      const html = readFileSync(join(DIST, file), 'utf-8');
      expect(html).toMatch(/hreflang="es-AR" href="https:\/\/www\.antena\.com\.ar/);
      expect(html).toMatch(/hreflang="x-default" href="https:\/\/www\.antena\.com\.ar/);
    });
  }

  for (const path of NOINDEX_PAGES) {
    test(`${path} has noindex robots meta`, () => {
      const file = PAGES.find((p) => p.path === path)!.file;
      if (!existsSync(join(DIST, file))) return;
      const html = readFileSync(join(DIST, file), 'utf-8');
      expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"/);
    });
  }

  test('home has WebSite and NewsMediaOrganization JSON-LD with @ids', () => {
    const homePath = join(DIST, 'index.html');
    if (!existsSync(homePath)) return;
    const html = readFileSync(homePath, 'utf-8');
    expect(html).toMatch(/"@id":\s*"https:\/\/www\.antena\.com\.ar\/#website"/);
    expect(html).toMatch(/"@id":\s*"https:\/\/www\.antena\.com\.ar\/#organization"/);
  });
});
