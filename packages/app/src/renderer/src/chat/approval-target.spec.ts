import { describe, expect, it } from 'vitest';
import { targetOf } from './approval-target';

const request = (name: string, input: Record<string, unknown>) => ({ id: 'c1', conversationId: 'conv', name, input });

describe('what the approval card names', () => {
  it('browser_open names the address it would open when it is given, before any path (review of round 3, 3)', () => {
    expect(targetOf(request('browser_open', { url: 'https://example.com/?k=secret', path: 'index.html' }), null)).toBe('https://example.com/?k=secret');
    expect(targetOf(request('browser_open', { path: 'index.html' }), null)).toBe('index.html');
    expect(targetOf(request('browser_open', { url: '  ', path: 'index.html' }), null)).toBe('index.html');
  });

  it('a command names its program and its arguments; a write the path of its preview', () => {
    expect(targetOf(request('run_command', { program: 'pnpm', args: ['test', '--run'] }), null)).toBe('pnpm test --run');
    expect(targetOf(request('edit_file', { path: 'a.ts' }), { path: 'src/a.ts' } as never)).toBe('src/a.ts');
    expect(targetOf(request('web_fetch', { url: 'https://example.com' }), null)).toBe('https://example.com');
    expect(targetOf(request('extension_stop', {}), null)).toBe('extension_stop');
  });
});
