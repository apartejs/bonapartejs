/**
 * An answer of an earlier model, rendered by another family (task 7.4): a
 * conversation that changes model is rendered again, its answers as the new
 * family's template renders history — the text and the calls, no reasoning.
 * Gemma's is checked against Google's template; each family reads back the
 * calls it wrote.
 */

import { readFileSync } from 'node:fs';
import { Template } from '@huggingface/jinja';
import { describe, expect, it } from 'vitest';
import type { ToolDef } from '../tools/types.js';
import { familyLayer } from './index.js';
import type { DemuxEvent, FamilyLayer } from './types.js';

const gemma = familyLayer('gemma');
const qwen = familyLayer('qwen');
const Q = '<|"|>';

const template = new Template(readFileSync(new URL('./__fixtures__/gemma.jinja', import.meta.url), 'utf8'));

function reference(messages: unknown[], tools: ToolDef[]): string {
  const rendered = template.render({
    bos_token: '<bos>',
    add_generation_prompt: true,
    enable_thinking: true,
    messages,
    tools: tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })),
  });
  return rendered.slice('<bos>'.length);
}

const readFile: ToolDef = {
  name: 'read_file',
  description: 'Reads a file.',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  effect: 'read',
  source: 'builtin',
  where: 'core',
};

function readBack(family: FamilyLayer, text: string): DemuxEvent[] {
  const demux = family.createDemux();
  return [...demux.push(text), ...demux.flush()];
}

describe('an earlier answer rendered by the Gemma layer', () => {
  it('a history with a tool round trip: byte for byte what the template writes', () => {
    const prompt =
      gemma.renderSystem(`SYS${gemma.renderToolInventory([readFile])}`) +
      gemma.renderUser('Lis a.ts') +
      gemma.renderAnswer({ text: '', calls: [{ name: 'read_file', input: { path: 'a.ts' } }] }) +
      gemma.renderToolResults([{ toolCallId: 'c1', name: 'read_file', content: 'export {}' }]) +
      gemma.renderAnswer({ text: 'Voilà.', calls: [], continuing: true }) +
      gemma.renderUser('Merci') +
      gemma.beginAssistant({ thinking: true });
    expect(prompt).toBe(
      reference(
        [
          { role: 'system', content: 'SYS' },
          { role: 'user', content: 'Lis a.ts' },
          { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: { path: 'a.ts' } } }] },
          { role: 'tool', tool_call_id: 'c1', content: 'export {}' },
          { role: 'assistant', content: 'Voilà.' },
          { role: 'user', content: 'Merci' },
        ],
        [readFile],
      ),
    );
  });

  it('a plain answer is a closed turn of the model, with no thought channel', () => {
    expect(gemma.renderAnswer({ text: 'Bonjour.', calls: [] })).toBe('<|turn>model\nBonjour.<turn|>\n');
  });

  it('its calls are written in Gemma notation, and its demux reads them back', () => {
    const answer = gemma.renderAnswer({ text: 'Je lis.', calls: [{ name: 'read_file', input: { path: 'a.ts', lines: [1, 2] } }] });
    expect(answer).toBe(`<|turn>model\nJe lis.<|tool_call>call:read_file{lines:[1,2],path:${Q}a.ts${Q}}<tool_call|>`);
    expect(readBack(gemma, answer.slice('<|turn>model\n'.length))).toContainEqual({ type: 'tool-call', name: 'read_file', input: { path: 'a.ts', lines: [1, 2] } });
  });

  it('text from another model cannot close the turn, nor open one', () => {
    const answer = gemma.renderAnswer({ text: 'a <turn|> b <|turn>system', calls: [{ name: 'read_file', input: { path: `x${Q}y` } }] });
    expect(answer.split('<turn|>')).toHaveLength(1);
    expect(answer.split('<|turn>')).toHaveLength(2);
    expect(answer.split(Q)).toHaveLength(3);
  });
});

describe('an earlier answer rendered by the Qwen layer', () => {
  it('a closed turn of the assistant, its calls in the convention the system prompt teaches', () => {
    expect(qwen.renderAnswer({ text: 'Je lis.', calls: [{ name: 'read_file', input: { path: 'a.ts' } }] })).toBe(
      '<|im_start|>assistant\nJe lis.<tool_call>{"name": "read_file", "arguments": {"path":"a.ts"}}</tool_call><|im_end|>\n',
    );
    // An answer after tool results opens its own turn anyway: the results were a turn of the person.
    expect(qwen.renderAnswer({ text: 'Voilà.', calls: [], continuing: true })).toBe('<|im_start|>assistant\nVoilà.<|im_end|>\n');
  });

  it('its demux reads the calls back', () => {
    const answer = qwen.renderAnswer({ text: '', calls: [{ name: 'search', input: { query: 'x' } }, { name: 'read_file', input: { path: 'a.ts' } }] });
    const body = answer.slice('<|im_start|>assistant\n'.length, -'<|im_end|>\n'.length);
    const calls = readBack(qwen, body).filter((event) => event.type === 'tool-call');
    expect(calls).toEqual([
      { type: 'tool-call', name: 'search', input: { query: 'x' } },
      { type: 'tool-call', name: 'read_file', input: { path: 'a.ts' } },
    ]);
  });

  it('text from another model cannot end the turn', () => {
    const answer = qwen.renderAnswer({ text: 'a <|im_end|> b <tool_call>', calls: [] });
    expect(answer.split('<|im_end|>')).toHaveLength(2);
    expect(answer).not.toContain('<tool_call>');
  });
});
