import nx from '@nx/eslint-plugin';
import tseslint from 'typescript-eslint';

const NO_CHILD_PROCESS =
  'Launch processes through spawnHidden (packages/core/src/process/spawn.ts): an argument array, no shell, no visible console window.';
const NO_ELECTRON =
  'The core is pure Node: it never imports electron. The app hands it what it needs through an interface.';

const childProcess = [
  { name: 'node:child_process', message: NO_CHILD_PROCESS },
  { name: 'child_process', message: NO_CHILD_PROCESS },
];
const electron = {
  paths: [{ name: 'electron', message: NO_ELECTRON }],
  patterns: [{ group: ['electron/*'], message: NO_ELECTRON }],
};

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/out/**', '**/node_modules/**', '.nx/**'],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Never a shell string: a process gets an argument array.
      'no-restricted-syntax': [
        'error',
        {
          selector: "Property[key.name='shell'][value.value=true], Property[key.value='shell'][value.value=true]",
          message: 'Never `shell: true`: launch the program with an argument array, through spawnHidden.',
        },
      ],
      // One door to the process table.
      'no-restricted-imports': ['error', { paths: childProcess }],
    },
  },
  {
    // A rule set here replaces the one above for these files, so it states both bans.
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { paths: [...childProcess, ...electron.paths], patterns: electron.patterns }],
    },
  },
  {
    // The door itself.
    files: ['packages/core/src/process/spawn.ts'],
    rules: {
      'no-restricted-imports': ['error', electron],
    },
  },
  {
    // Specs inspect raw JSON (HTTP responses): any is legitimate there.
    files: ['**/*.spec.ts', '**/*.spec.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { '@nx': nx },
    rules: {
      // Structural boundaries of the monorepo — the guarantee that core stays
      // pure Node and that plugins depend only on the SDK.
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: false,
          allow: [],
          depConstraints: [
            { sourceTag: 'scope:shared', onlyDependOnLibsWithTags: [] },
            {
              sourceTag: 'scope:core',
              onlyDependOnLibsWithTags: ['scope:shared'],
              bannedExternalImports: ['electron'],
            },
            {
              sourceTag: 'scope:cli',
              onlyDependOnLibsWithTags: ['scope:core', 'scope:shared'],
            },
            {
              sourceTag: 'scope:plugin-sdk',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
            {
              sourceTag: 'scope:plugin',
              onlyDependOnLibsWithTags: ['scope:plugin-sdk', 'scope:shared'],
            },
            {
              sourceTag: 'scope:app',
              onlyDependOnLibsWithTags: [
                'scope:core',
                'scope:shared',
                'scope:plugin-sdk',
              ],
            },
          ],
        },
      ],
    },
  },
);
