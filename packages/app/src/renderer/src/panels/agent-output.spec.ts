/** The agent tab's stream: each command announced, its lines ended as a terminal wants, its end; the end kept. */

import { describe, expect, it } from 'vitest';
import { createAgentOutput } from './agent-output';

describe('the agent output', () => {
  it('announces each command, ends its lines with a carriage return, says how it ended', () => {
    const output = createAgentOutput(() => (code) => `[exit ${code}]`);
    const pieces: string[] = [];
    output.subscribe((piece) => pieces.push(piece));
    output.push({ kind: 'start', command: 'pnpm test', cwd: '/p' });
    output.push({ kind: 'data', text: 'one\ntwo\r\n' });
    output.push({ kind: 'exit', code: 1 });
    expect(output.text()).toBe('\u001b[2m$ pnpm test\u001b[0m\r\none\r\ntwo\r\n\u001b[2m[exit 1]\u001b[0m\r\n\r\n');
    expect(pieces).toHaveLength(3);
  });

  it('keeps the end', () => {
    const output = createAgentOutput(() => () => '', 10);
    output.push({ kind: 'data', text: 'abcdefghijKLMNO' });
    expect(output.text()).toBe('fghijKLMNO');
  });
});
