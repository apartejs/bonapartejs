import { describe, expect, it } from 'vitest';
import { harnessT } from '../i18n/translations.js';
import { runDoctor, type DoctorEnv } from './doctor.js';

function fakeEnv(overrides: Partial<DoctorEnv> = {}): DoctorEnv {
  return {
    nodeVersion: 'v24.14.0',
    configuredLlamaServerPath: null,
    fileExists: async () => false,
    lookupOnPath: async (binary) =>
      binary === 'llama-server' ? 'C:\\tools\\llama\\llama-server.exe' : null,
    slotSavePath: 'C:\\fake\\bonaparte\\kv-slots',
    canWrite: async () => true,
    freeDiskBytes: async () => 500 * 1024 ** 3,
    detectGpu: async () => [{ vendor: 'nvidia', name: 'GeForce RTX 4090' }],
    ...overrides,
  };
}

function check(report: Awaited<ReturnType<typeof runDoctor>>, id: string) {
  const found = report.checks.find((c) => c.id === id);
  if (!found) throw new Error(`check ${id} absent du rapport`);
  return found;
}

describe('runDoctor', () => {
  it('rapporte ok quand tout va bien, avec les 4 checks', async () => {
    const report = await runDoctor(fakeEnv(), 'fr');
    expect(report.ok).toBe(true);
    expect(report.checks.map((c) => c.id)).toEqual([
      'node',
      'llama-server',
      'slot-save-path',
      'gpu',
    ]);
    expect(report.checks.every((c) => c.status === 'ok')).toBe(true);
  });

  it('échoue (bloquant) si Node est trop vieux', async () => {
    const report = await runDoctor(fakeEnv({ nodeVersion: 'v18.19.0' }), 'fr');
    const node = check(report, 'node');
    expect(node.status).toBe('fail');
    expect(node.blocking).toBe(true);
    expect(report.ok).toBe(false);
  });

  it('mentionne la version trouvée dans le détail du check node', async () => {
    const report = await runDoctor(fakeEnv({ nodeVersion: 'v18.19.0' }), 'fr');
    expect(check(report, 'node').detail).toContain('v18.19.0');
  });

  it("échoue si llama-server n'est ni configuré ni sur le PATH", async () => {
    const report = await runDoctor(
      fakeEnv({ lookupOnPath: async () => null }),
      'fr',
    );
    const llama = check(report, 'llama-server');
    expect(llama.status).toBe('fail');
    expect(llama.blocking).toBe(true);
    expect(llama.detail).toBe(harnessT('fr').errors.llamaServerNotFound);
    expect(report.ok).toBe(false);
  });

  it('trouve llama-server sur le PATH et donne son chemin', async () => {
    const report = await runDoctor(fakeEnv(), 'fr');
    const llama = check(report, 'llama-server');
    expect(llama.status).toBe('ok');
    expect(llama.detail).toBe('C:\\tools\\llama\\llama-server.exe');
  });

  it('privilégie le chemin configuré quand il existe', async () => {
    const report = await runDoctor(
      fakeEnv({
        configuredLlamaServerPath: 'D:\\ia\\llama-server.exe',
        fileExists: async (p) => p === 'D:\\ia\\llama-server.exe',
        lookupOnPath: async () => 'C:\\autre\\llama-server.exe',
      }),
      'fr',
    );
    expect(check(report, 'llama-server').detail).toBe('D:\\ia\\llama-server.exe');
  });

  it('échoue si le chemin configuré ne pointe sur rien (pas de repli silencieux)', async () => {
    const report = await runDoctor(
      fakeEnv({
        configuredLlamaServerPath: 'D:\\ia\\llama-server.exe',
        fileExists: async () => false,
      }),
      'fr',
    );
    const llama = check(report, 'llama-server');
    expect(llama.status).toBe('fail');
    expect(llama.blocking).toBe(true);
    expect(llama.detail).toContain('D:\\ia\\llama-server.exe');
  });

  it("échoue (bloquant) si le répertoire des états KV n'est pas écrivable", async () => {
    const report = await runDoctor(fakeEnv({ canWrite: async () => false }), 'fr');
    const slot = check(report, 'slot-save-path');
    expect(slot.status).toBe('fail');
    expect(slot.blocking).toBe(true);
    expect(report.ok).toBe(false);
  });

  it('avertit (non bloquant) si le disque est presque plein', async () => {
    const report = await runDoctor(
      fakeEnv({ freeDiskBytes: async () => 2 * 1024 ** 3 }),
      'fr',
    );
    const slot = check(report, 'slot-save-path');
    expect(slot.status).toBe('warn');
    expect(slot.blocking).toBe(false);
    expect(report.ok).toBe(true);
  });

  it('avertit (non bloquant) si aucun GPU n’est détecté', async () => {
    const report = await runDoctor(fakeEnv({ detectGpu: async () => [] }), 'fr');
    const gpu = check(report, 'gpu');
    expect(gpu.status).toBe('warn');
    expect(gpu.blocking).toBe(false);
    expect(report.ok).toBe(true);
  });

  it('liste les GPU détectés dans le détail', async () => {
    const report = await runDoctor(fakeEnv(), 'fr');
    expect(check(report, 'gpu').detail).toContain('GeForce RTX 4090');
  });

  it('localise les libellés selon la locale demandée', async () => {
    const fr = await runDoctor(fakeEnv(), 'fr');
    const en = await runDoctor(fakeEnv(), 'en');
    expect(check(fr, 'node').label).toBe(harnessT('fr').doctor.checkNode);
    expect(check(en, 'node').label).toBe(harnessT('en').doctor.checkNode);
  });
});
