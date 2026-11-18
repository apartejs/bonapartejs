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
