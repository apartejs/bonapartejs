/**
 * Reads what Gemma 4 writes between `<|tool_call>` and `<tool_call|>`:
 * `call:NAME{key:value,…}`, values in Gemma's notation — strings between
 * `<|"|>` tokens, numbers, true, false, null, `{…}` with bare keys, `[…]`.
 * The same traversal as llama.cpp's own parser (common/parsers/gemma4.cpp).
 */

import { QUOTE } from './template.js';

export interface GemmaToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

class Malformed extends Error {}

class Reader {
  private at = 0;

  constructor(private readonly text: string) {}

  get done(): boolean {
    return this.at >= this.text.length;
  }

  skipSpace(): void {
    while (!this.done && /\s/.test(this.text[this.at]!)) this.at += 1;
  }

  peek(literal: string): boolean {
    return this.text.startsWith(literal, this.at);
  }

  expect(literal: string): void {
    if (!this.peek(literal)) throw new Malformed();
    this.at += literal.length;
  }

  until(stop: string): string {
    const end = this.text.indexOf(stop, this.at);
    if (end === -1) throw new Malformed();
    const read = this.text.slice(this.at, end);
    this.at = end;
    return read;
  }

  value(): unknown {
    this.skipSpace();
    if (this.peek(QUOTE)) {
      this.expect(QUOTE);
      const text = this.until(QUOTE);
      this.expect(QUOTE);
      return text;
    }
    if (this.peek('{')) return this.dict();
    if (this.peek('[')) return this.array();
    for (const [word, value] of [
      ['true', true],
      ['false', false],
      ['null', null],
    ] as const) {
      if (this.peek(word)) {
        this.expect(word);
        return value;
      }
    }
    const number = /^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/.exec(this.text.slice(this.at));
    if (!number) throw new Malformed();
    this.at += number[0].length;
    return Number(number[0]);
  }

  dict(): Record<string, unknown> {
    this.expect('{');
    const result: Record<string, unknown> = {};
    this.skipSpace();
    if (this.peek('}')) {
      this.expect('}');
      return result;
    }
    for (;;) {
      this.skipSpace();
      const key = /^[^:}]+/.exec(this.text.slice(this.at))?.[0];
      if (!key) throw new Malformed();
      this.at += key.length;
      this.expect(':');
      result[key.trim()] = this.value();
      this.skipSpace();
      if (this.peek(',')) {
        this.expect(',');
        continue;
      }
      this.expect('}');
      return result;
    }
  }

  array(): unknown[] {
    this.expect('[');
    const result: unknown[] = [];
    this.skipSpace();
    if (this.peek(']')) {
      this.expect(']');
      return result;
    }
    for (;;) {
      result.push(this.value());
      this.skipSpace();
      if (this.peek(',')) {
        this.expect(',');
        continue;
      }
      this.expect(']');
      return result;
    }
  }
}

/** The body of one call; null when it cannot be read. */
export function parseGemmaCall(body: string): GemmaToolCall | null {
  const match = /^\s*call:([^{\s]+)\s*/.exec(body);
  if (!match) return null;
  try {
    const reader = new Reader(body.slice(match[0].length));
    const args = reader.dict();
    reader.skipSpace();
    if (!reader.done) return null;
    return { name: match[1]!, arguments: args };
  } catch (error) {
    if (error instanceof Malformed) return null;
    throw error;
  }
}
