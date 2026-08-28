import { describe, expect, it } from 'vitest';
import { harnessT } from '../i18n/translations.js';
import { runDoctor, type DoctorEnv } from './doctor.js';

function fakeEnv(overrides: Partial<DoctorEnv> = {}): DoctorEnv {
  return {
    nodeVersion: 'v24.14.0',
    configuredLlamaServerPath: null,
    fileExists: async () => false,
    readVersionOutput: async () => 'b10217-ddd4ec142',
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
  if (!found) throw new Error(`check ${id} missing from the report`);
  return found;
}

describe('runDoctor', () => {
  it('reports ok when everything is fine, with the 4 checks', async () => {
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

  it('fails (blocking) if Node is too old', async () => {
    const report = await runDoctor(fakeEnv({ nodeVersion: 'v18.19.0' }), 'fr');
    const node = check(report, 'node');
    expect(node.status).toBe('fail');
    expect(node.blocking).toBe(true);
    expect(report.ok).toBe(false);
  });

  it('mentions the found version in the node check detail', async () => {
    const report = await runDoctor(fakeEnv({ nodeVersion: 'v18.19.0' }), 'fr');
    expect(check(report, 'node').detail).toContain('v18.19.0');
  });

  it("fails if llama-server is neither configured nor on the PATH", async () => {
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

  it('finds llama-server on the PATH and gives path + build', async () => {
    const report = await runDoctor(fakeEnv(), 'fr');
    const llama = check(report, 'llama-server');
    expect(llama.status).toBe('ok');
    expect(llama.detail).toContain('C:\\tools\\llama\\llama-server.exe');
    expect(llama.detail).toContain('b10217');
  });

  it('fails (blocking) if the llama build is too old for slots', async () => {
    const report = await runDoctor(
      fakeEnv({ readVersionOutput: async () => 'version: 3000 (abc1234)' }),
      'fr',
    );
    const llama = check(report, 'llama-server');
    expect(llama.status).toBe('fail');
    expect(llama.blocking).toBe(true);
    expect(llama.detail).toContain('3000');
    expect(report.ok).toBe(false);
  });

  it('warns (non-blocking) if the version cannot be determined', async () => {
    const report = await runDoctor(
      fakeEnv({ readVersionOutput: async () => 'exotic output' }),
      'fr',
    );
    const llama = check(report, 'llama-server');
    expect(llama.status).toBe('warn');
    expect(llama.blocking).toBe(false);
    expect(report.ok).toBe(true);
  });

  it('finds the unified `llama` CLI when llama-server is absent', async () => {
    const report = await runDoctor(
      fakeEnv({
        lookupOnPath: async (binary) =>
          binary === 'llama'
            ? 'C:\\Users\\alice\\AppData\\Local\\Microsoft\\WindowsApps\\llama.exe'
            : null,
      }),
      'fr',
    );
    const llama = check(report, 'llama-server');
    expect(llama.status).toBe('ok');
    expect(llama.detail).toContain('WindowsApps\\llama.exe');
  });

  it('prefers llama-server over the unified CLI when both exist', async () => {
    const report = await runDoctor(
      fakeEnv({
        lookupOnPath: async (binary) =>
          binary === 'llama-server'
            ? 'C:\\tools\\llama\\llama-server.exe'
            : 'C:\\WindowsApps\\llama.exe',
      }),
      'fr',
    );
    expect(check(report, 'llama-server').detail).toContain(
      'C:\\tools\\llama\\llama-server.exe',
    );
  });

  it('prioritizes the configured path when it exists', async () => {
    const report = await runDoctor(
      fakeEnv({
        configuredLlamaServerPath: 'D:\\ia\\llama-server.exe',
        fileExists: async (p) => p === 'D:\\ia\\llama-server.exe',
        lookupOnPath: async () => 'C:\\autre\\llama-server.exe',
      }),
      'fr',
    );
    expect(check(report, 'llama-server').detail).toContain('D:\\ia\\llama-server.exe');
  });

  it('fails if the configured path points to nothing (no silent fallback)', async () => {
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

  it("fails (blocking) if the KV states directory is not writable", async () => {
    const report = await runDoctor(fakeEnv({ canWrite: async () => false }), 'fr');
    const slot = check(report, 'slot-save-path');
    expect(slot.status).toBe('fail');
    expect(slot.blocking).toBe(true);
    expect(report.ok).toBe(false);
  });

  it('warns (non-blocking) if the disk is almost full', async () => {
    const report = await runDoctor(
      fakeEnv({ freeDiskBytes: async () => 2 * 1024 ** 3 }),
      'fr',
    );
    const slot = check(report, 'slot-save-path');
    expect(slot.status).toBe('warn');
    expect(slot.blocking).toBe(false);
    expect(report.ok).toBe(true);
  });

  it('warns (non-blocking) if no GPU is detected', async () => {
    const report = await runDoctor(fakeEnv({ detectGpu: async () => [] }), 'fr');
    const gpu = check(report, 'gpu');
    expect(gpu.status).toBe('warn');
    expect(gpu.blocking).toBe(false);
    expect(report.ok).toBe(true);
  });

  it('lists the detected GPUs in the detail', async () => {
    const report = await runDoctor(fakeEnv(), 'fr');
    expect(check(report, 'gpu').detail).toContain('GeForce RTX 4090');
  });

  it('localizes the labels according to the requested locale', async () => {
    const fr = await runDoctor(fakeEnv(), 'fr');
    const en = await runDoctor(fakeEnv(), 'en');
    expect(check(fr, 'node').label).toBe(harnessT('fr').doctor.checkNode);
    expect(check(en, 'node').label).toBe(harnessT('en').doctor.checkNode);
  });
});
