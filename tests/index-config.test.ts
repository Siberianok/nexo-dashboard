import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultSimModelConfig, sanitizeSimModelConfig } from '../src/components/simulator/simConfig';

describe('index.html sim model config', () => {
  it('contains valid JSON compatible with sanitizeSimModelConfig', () => {
    const htmlPath = resolve('index.html');
    const html = readFileSync(htmlPath, 'utf8');
    const match = html.match(/<script type="application\/json" id="sim-model-config">([\s\S]*?)<\/script>/i);
    expect(match, 'No se encontró el bloque #sim-model-config').toBeTruthy();
    const raw = match![1].trim();
    expect(() => JSON.parse(raw)).not.toThrow();
    const parsed = JSON.parse(raw);
    const sanitized = sanitizeSimModelConfig(parsed, createDefaultSimModelConfig());
    expect(sanitized).toBeTruthy();
    expect(typeof sanitized).toBe('object');
  });
});
