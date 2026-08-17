import type { Manifest } from './types';

/** 校验 manifest 的最低结构要求，流水线产物损坏时尽早报错。 */
export function assertManifest(value: unknown): asserts value is Manifest {
  if (typeof value !== 'object' || value === null) throw new Error('manifest: not an object');
  const m = value as Partial<Manifest>;
  if (typeof m.version !== 'string') throw new Error('manifest: missing version');
  if (!Array.isArray(m.systems) || m.systems.length === 0)
    throw new Error('manifest: systems empty');
  for (const s of m.systems) {
    if (typeof s.id !== 'string' || typeof s.file !== 'string' || !Array.isArray(s.structures))
      throw new Error('manifest: bad system entry');
  }
  if (typeof m.structures !== 'object' || m.structures === null)
    throw new Error('manifest: missing structures');
  if (!Array.isArray(m.attribution)) throw new Error('manifest: missing attribution');
}

/** 从站点资产目录加载 manifest.json。`base` 传 import.meta.env.BASE_URL。 */
export async function loadManifest(base: string): Promise<Manifest> {
  const url = `${base.replace(/\/?$/, '/')}assets/manifest.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`manifest: HTTP ${res.status} for ${url}`);
  const json: unknown = await res.json();
  assertManifest(json);
  return json;
}
