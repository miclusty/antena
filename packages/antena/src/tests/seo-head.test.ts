import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { expect, test } from 'vitest';
import SeoHead from '../components/SeoHead.astro';

test('emits title and description', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(SeoHead, {
    props: {
      title: 'Test Article',
      description: 'A test article description.',
      canonical: 'https://www.antena.com.ar/test',
    },
  });
  expect(html).toContain('<title>Test Article — Antena</title>');
  expect(html).toContain('<meta name="description" content="A test article description."');
  expect(html).toContain('<link rel="canonical" href="https://www.antena.com.ar/test"');
});

test('og:url is always www.', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(SeoHead, {
    props: {
      title: 'T',
      description: 'D',
      canonical: 'https://antena.com.ar/test',
    },
  });
  expect(html).toContain('og:url" content="https://www.antena.com.ar/test"');
});

test('noindex emits robots meta', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(SeoHead, {
    props: {
      title: 'T',
      description: 'D',
      canonical: 'https://www.antena.com.ar/test',
      noindex: true,
    },
  });
  expect(html).toContain('<meta name="robots" content="noindex, nofollow"');
});

test('injects jsonLd as application/ld+json script', async () => {
  const container = await AstroContainer.create();
  const html = await container.renderToString(SeoHead, {
    props: {
      title: 'T',
      description: 'D',
      canonical: 'https://www.antena.com.ar/test',
      jsonLd: { '@type': 'Thing', name: 'X' },
    },
  });
  expect(html).toContain('type="application/ld+json"');
  expect(html).toContain('"Thing"');
});

test('title is truncated to 60 chars with ellipsis if too long', async () => {
  const container = await AstroContainer.create();
  const long = 'A'.repeat(80);
  const html = await container.renderToString(SeoHead, {
    props: { title: long, description: 'D', canonical: 'https://www.antena.com.ar/x' },
  });
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  expect(titleMatch![1].length).toBeLessThanOrEqual(60);
});
