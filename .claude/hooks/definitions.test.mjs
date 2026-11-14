// The project's sub-agents and skills are plain Markdown with a YAML header.
// Claude Code ignores a header field it does not know, without a word: a typo
// in `tools` would silently hand an agent every tool. These tests read the
// headers.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const claudeDir = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Reads the `key: value` header between the two `---` lines that open a file. */
export function readHeader(file) {
  const text = readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
  assert.ok(text.startsWith('---\n'), `${file} must open with a --- header`);
  const end = text.indexOf('\n---\n', 4);
  assert.notEqual(end, -1, `${file} must close its header with ---`);
  const header = {};
  for (const line of text.slice(4, end).split('\n')) {
    const colon = line.indexOf(':');
    assert.ok(colon > 0, `${file}: cannot read the header line "${line}"`);
    header[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { header, body: text.slice(end + 5) };
}

function list(value) {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const agentsDir = join(claudeDir, 'agents');
const agentFields = new Set(['name', 'description', 'tools', 'disallowedTools', 'model', 'effort']);
const writingTools = ['Write', 'Edit', 'NotebookEdit'];

/** The agents the plan names, with the model each one must run on. */
const agents = {
  scout: { model: 'haiku' },
  'aparte-docs': { model: 'sonnet' },
  'canvas-reader': { model: 'sonnet' },
  'v0-porter': { model: 'sonnet' },
  reviewer: { model: 'opus', effort: 'high' },
};

for (const [name, expected] of Object.entries(agents)) {
  test(`the ${name} agent runs on ${expected.model}`, () => {
    const { header, body } = readHeader(join(agentsDir, `${name}.md`));
    assert.equal(header.name, name);
    assert.equal(header.model, expected.model);
    if (expected.effort) assert.equal(header.effort, expected.effort);
    assert.ok(header.description.length >= 40, 'the description says when to use the agent');
    assert.ok(body.trim().length >= 200, 'the prompt says what the agent does');
  });
}

test('every agent is read-only and uses only header fields Claude Code knows', () => {
  const files = existsSync(agentsDir) ? readdirSync(agentsDir).filter((file) => file.endsWith('.md')) : [];
  assert.ok(files.length >= Object.keys(agents).length, 'the agents are there');
  for (const file of files) {
    const { header } = readHeader(join(agentsDir, file));
    assert.equal(header.name, basename(file, '.md'), `${file}: the name is the file name`);
    for (const field of Object.keys(header)) {
      assert.ok(agentFields.has(field), `${file}: unknown header field "${field}"`);
    }
    const tools = list(header.tools);
    assert.ok(tools.length > 0, `${file}: an agent without a tools list inherits every tool`);
    for (const tool of writingTools) {
      assert.ok(!tools.includes(tool), `${file}: a read-only agent cannot list ${tool}`);
    }
    if (tools.includes('Bash')) {
      const refused = list(header.disallowedTools);
      assert.ok(
        refused.includes('Write') && refused.includes('Edit'),
        `${file}: an agent with Bash must refuse Write and Edit explicitly`,
      );
    }
  }
});

const skillsDir = join(claudeDir, 'skills');
const skillFields = new Set(['name', 'description', 'when_to_use', 'argument-hint', 'allowed-tools', 'user-invocable']);

/** The procedures the plan names. */
const skills = ['phase-gate', 'screen', 'friction', 'smoke', 'run-app'];

for (const name of skills) {
  test(`the ${name} skill has a header Claude Code can list`, () => {
    const { header, body } = readHeader(join(skillsDir, name, 'SKILL.md'));
    assert.equal(header.name, name);
    for (const field of Object.keys(header)) {
      assert.ok(skillFields.has(field), `${name}: unknown header field "${field}"`);
    }
    // The listing cuts a description at 1,536 characters: the trigger comes first.
    assert.ok(header.description.length >= 40 && header.description.length <= 1536);
    assert.ok(body.trim().length >= 200, 'the skill says what to do');
  });
}

test('the phase gate never pushes', () => {
  const { body } = readHeader(join(skillsDir, 'phase-gate', 'SKILL.md'));
  assert.match(body, /never push/i);
});

test('a friction is filed on the library repository, with nothing private in it', () => {
  const { body } = readHeader(join(skillsDir, 'friction', 'SKILL.md'));
  assert.match(body, /apartejs\/aparte/);
  assert.match(body, /private/i);
});
