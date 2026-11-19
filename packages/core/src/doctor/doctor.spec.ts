import { describe, expect, it } from 'vitest';
import { runDoctor, type DoctorEnv } from './doctor.js';

const GiB = 1024 ** 3;

function env(overrides: Partial<DoctorEnv> = {}): DoctorEnv {
  return {
    nodeVersion: 'v24.14.0',
    llama: async () => ({ source: 'path', command: 'llama-server', build: 'b12383' }),
    slotsDir: '/data/kv-slots',
    canWrite: async () => true,
    freeDiskBytes: async () => 500 * GiB,
    gpuBytes: async () => 24 * GiB,
    ...overrides,
  };
}

describe('bonaparte doctor (task 9.6)', () => {
  it('checks Node, llama.cpp, the folder of the memories and the card, in that order — all good', async () => {
    const report = await runDoctor(env());
    expect(report.checks.map((check) => [check.id, check.status])).toEqual([
      ['node', 'ok'],
      ['llama', 'ok'],
      ['slots', 'ok'],
      ['gpu', 'ok'],
    ]);
    expect(report.ok).toBe(true);
  });

  it('on Windows, says the Visual C++ runtime the llama.cpp found will run with — and only what is true of it', async () => {
    const runtime = (status: { system: string | null; carried: string | null; beside: string | null; managed: boolean }) =>
      runDoctor(env({ runtime: async () => status })).then((report) => report.checks.find((check) => check.id === 'runtime'));
    const first = await runDoctor(env({ runtime: async () => ({ system: '14.51.36247.0', carried: null, beside: null, managed: false }) }));
    expect(first.checks.map((check) => check.id)).toEqual(['node', 'llama', 'runtime', 'slots', 'gpu']);
    // Beside llama.cpp first: Windows loads that one before its own.
    expect(await runtime({ system: '14.51.36247.0', carried: '14.51.36247.0', beside: '14.50.35719.0', managed: true })).toMatchObject({ status: 'ok', runs: 'beside', version: '14.50.35719.0' });
    expect(await runtime({ system: '14.51.36247.0', carried: null, beside: null, managed: false })).toMatchObject({ status: 'ok', runs: 'system', version: '14.51.36247.0' });
    // Only the llama.cpp bonaparte installed gets the runtime it carries.
    expect(await runtime({ system: null, carried: '14.51.36247.0', beside: null, managed: true })).toMatchObject({ status: 'ok', runs: 'carried' });
    const configured = await runtime({ system: null, carried: '14.51.36247.0', beside: null, managed: false });
    expect(configured).toMatchObject({ status: 'fail', blocking: true, runs: null });
    // Neither: llama.cpp's official package stops before its first line.
    expect(await runtime({ system: null, carried: null, beside: null, managed: true })).toMatchObject({ status: 'fail', blocking: true, runs: null });
    // Elsewhere than Windows there is nothing to say.
    expect((await runDoctor(env({ runtime: async () => null }))).checks.map((check) => check.id)).not.toContain('runtime');
  });

  it('a Node too old blocks', async () => {
    const report = await runDoctor(env({ nodeVersion: 'v18.20.0' }));
    expect(report.checks[0]).toMatchObject({ id: 'node', status: 'fail', blocking: true, version: 'v18.20.0', min: 22 });
    expect(report.ok).toBe(false);
  });

  it('no llama.cpp blocks, and says so', async () => {
    const report = await runDoctor(env({ llama: async () => null }));
    expect(report.checks[1]).toMatchObject({ id: 'llama', status: 'fail', blocking: true, found: false });
    expect(report.ok).toBe(false);
  });

  it('says where llama.cpp comes from: configured, installed by bonaparte, or the PATH', async () => {
    const report = await runDoctor(env({ llama: async () => ({ source: 'managed', command: '/data/llama.cpp/b12383/llama-server', build: 'b12383' }) }));
    expect(report.checks[1]).toMatchObject({ status: 'ok', source: 'managed', build: 'b12383' });
  });

  it('a llama.cpp configured that does not answer blocks — never another one in its place', async () => {
    const report = await runDoctor(env({ llama: async () => ({ source: 'configured', command: 'C:\\nowhere\\llama-server.exe', build: null }) }));
    expect(report.checks[1]).toMatchObject({ status: 'fail', blocking: true, source: 'configured', build: null });
  });

  it('a build older than b6000 blocks; one whose version cannot be read only warns', async () => {
    const old = await runDoctor(env({ llama: async () => ({ source: 'path', command: 'llama-server', build: 'b3000' }) }));
    expect(old.checks[1]).toMatchObject({ status: 'fail', blocking: true, tooOld: true, minBuild: 6000 });
    const odd = await runDoctor(env({ llama: async () => ({ source: 'path', command: 'llama', build: 'version: custom' }) }));
    expect(odd.checks[1]).toMatchObject({ status: 'warn', blocking: false });
    expect(odd.ok).toBe(true);
  });

  it('a folder of memories that cannot be written blocks; a disk almost full warns', async () => {
    const locked = await runDoctor(env({ canWrite: async () => false }));
    expect(locked.checks[2]).toMatchObject({ id: 'slots', status: 'fail', blocking: true, dir: '/data/kv-slots' });
    const full = await runDoctor(env({ freeDiskBytes: async () => 1.5 * GiB }));
    expect(full.checks[2]).toMatchObject({ status: 'warn', blocking: false, freeBytes: 1.5 * GiB });
    expect(full.ok).toBe(true);
  });

  it('no card measured only warns: llama.cpp can run on the processor', async () => {
    const report = await runDoctor(env({ gpuBytes: async () => null }));
    expect(report.checks[3]).toMatchObject({ id: 'gpu', status: 'warn', blocking: false, bytes: null });
    expect(report.ok).toBe(true);
  });
});
