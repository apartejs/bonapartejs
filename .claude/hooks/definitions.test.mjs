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

// --- .claude/settings.json: what runs without asking.

const settings = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf8'));

/** Whether a rule such as `Bash(git status *)` covers a command typed in that tool. */
function covers(rule, tool, command) {
  const match = /^(\w+)\((.*)\)$/.exec(rule);
  if (!match || match[1] !== tool) return false;
  const pattern = match[2];
  if (!pattern.endsWith(' *')) return command === pattern;
  const prefix = pattern.slice(0, -2);
  return command === prefix || command.startsWith(`${prefix} `);
}

const runsUnasked = (tool, command) => settings.permissions.allow.some((rule) => covers(rule, tool, command));

/** Destructive, or reaching outside this machine: a person is asked first. */
const askFirst = [
  'git push',
  'git push origin v1',
  'git branch -D archive/v0',
  'git branch -d topic',
  'git switch --discard-changes main',
  'git switch -f main',
  'git stash clear',
  'git stash drop',
  'git worktree remove --force ../x',
  'git reset --hard',
  'git clean -fdx',
  'git checkout -- .',
  'git rebase main',
  'pnpm exec git push',
  'pnpm dlx anything',
  'gh issue close 1',
  'gh api repos/x/y',
  'gh repo delete x',
  'rm -rf .',
];

const everyday = [
  'pnpm test',
  'pnpm lint',
  'pnpm --filter @aparte/bonaparte-core test',
  'pnpm exec vitest run',
  'git status',
  'git commit -m x',
  'git add .gitignore',
  'git log --oneline -5',
  'git branch --show-current',
  'node --test ".claude/hooks/*.test.mjs"',
  'gh issue create --repo apartejs/aparte --title x',
];

for (const tool of ['Bash', 'PowerShell']) {
  test(`no ${tool} rule lets a destructive or outward command run unasked`, () => {
    for (const command of askFirst) assert.equal(runsUnasked(tool, command), false, command);
  });

  test(`the everyday commands run unasked in ${tool}`, () => {
    for (const command of everyday) assert.equal(runsUnasked(tool, command), true, command);
  });
}

test('Bash and PowerShell have the same rules', () => {
  for (const list of ['allow', 'deny']) {
    const of = (tool) =>
      settings.permissions[list]
        .filter((rule) => rule.startsWith(`${tool}(`))
        .map((rule) => rule.slice(tool.length))
        .sort();
    assert.deepEqual(of('Bash'), of('PowerShell'), list);
  }
});

// Since 2026-11-21 (Paul took the deny rules out), the guard alone decides a push: main and a release tag to the
// repository pass, everything else is refused (guard-command.test.mjs). A deny rule would refuse those two too.
test('a push is left to the guard, in both shells', () => {
  assert.ok(!settings.permissions.deny.some((rule) => /git push/.test(rule)));
  const guards = JSON.stringify(settings.hooks.PreToolUse);
  assert.match(guards, /guard-command\.mjs/);
});
