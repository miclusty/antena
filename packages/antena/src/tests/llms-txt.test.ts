import { describe, expect, test } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LLMS_TXT = join(__dirname, '..', '..', 'public', 'llms.txt');
const LLMS_FULL = join(__dirname, '..', '..', 'public', 'llms-full.txt');
const DIST_LLMS = join(__dirname, '..', '..', 'dist', 'llms.txt');
const DIST_LLMS_FULL = join(__dirname, '..', '..', 'dist', 'llms-full.txt');

describe('LLM-friendly files (built output)', () => {
  test('llms.txt is generated in dist', () => {
    expect(existsSync(DIST_LLMS)).toBe(true);
  });

  test('llms-full.txt is generated in dist', () => {
    expect(existsSync(DIST_LLMS_FULL)).toBe(true);
  });

  test('llms.txt has a citation example and uses www.', () => {
    const content = readFileSync(DIST_LLMS, 'utf-8');
    expect(content).toMatch(/Citar como|Cómo citar/);
    expect(content).toMatch(/https:\/\/www\.antena\.com\.ar/);
  });

  test('llms-full.txt is substantial (>100 lines)', () => {
    const content = readFileSync(DIST_LLMS_FULL, 'utf-8');
    expect(content.split('\n').length).toBeGreaterThan(100);
  });
});

describe('LLM-friendly files (source)', () => {
  test('llms.txt source exists', () => {
    expect(existsSync(LLMS_TXT)).toBe(true);
  });

  test('llms-full.txt source exists', () => {
    expect(existsSync(LLMS_FULL)).toBe(true);
  });
});
