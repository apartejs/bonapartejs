/**
 * No visible text is written in a component: it comes from the language
 * files, so that it exists in French and in English. Lint holds the rule for
 * the text of an element. (A text handed as an attribute, such as a
 * placeholder, is not caught by it: the parity spec and the review are.)
 */

import { ESLint } from 'eslint';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', '..');

describe('the lint rule against text written in a component', () => {
  let eslint: ESLint;

  beforeAll(() => {
    eslint = new ESLint({
      cwd: root,
      overrideConfig: [{ rules: { '@nx/enforce-module-boundaries': 'off' } }],
    });
  });

  async function brokenRules(file: string, code: string): Promise<string[]> {
    const [result] = await eslint.lintText(code, { filePath: join(root, file) });
    return result!.messages.map((message) => message.ruleId ?? message.message);
  }

  const component = 'packages/app/src/renderer/src/Example.tsx';

  it('refuses a text between tags', async () => {
    const code = 'export const Example = () => <p>Bonjour</p>;\n';
    expect(await brokenRules(component, code)).toContain('react/jsx-no-literals');
  });

  it('refuses a text hidden in braces', async () => {
    const code = "export const Example = () => <p>{'Bonjour'}</p>;\n";
    expect(await brokenRules(component, code)).toContain('react/jsx-no-literals');
  });

  it('lets through a text that comes from the language files, and a class name', async () => {
    const code =
      'export const Example = ({ messages }: { messages: { hello: string } }) => <p className="greeting">{messages.hello}</p>;\n';
    expect(await brokenRules(component, code)).toEqual([]);
  });

  it('applies to plugin views too', async () => {
    const code = 'export const View = () => <p>Terminal</p>;\n';
    expect(await brokenRules('plugins/terminal/renderer.tsx', code)).toContain('react/jsx-no-literals');
  });
}, 60_000);
