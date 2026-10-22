import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const HTML_SINK_MESSAGE =
  'No dynamic HTML (system.md §11.1): use textContent, attributes or h() from src/shared/dom.ts.';

export default defineConfig(
  {
    ignores: [
      'dist/',
      'dist-e2e/',
      'ref/',
      'docs/',
      '.claude/',
      'scripts/spike/**',
      'test/fixtures/**',
      'test/golden/**',
      'node_modules/',
      '.qa/',
      'test-results/',
      'playwright-report/',
    ],
  },
  tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: HTML_SINK_MESSAGE },
        { property: 'outerHTML', message: HTML_SINK_MESSAGE },
        { property: 'insertAdjacentHTML', message: HTML_SINK_MESSAGE },
      ],
    },
  },
  {
    // The only module allowed to inject markup: compile-time constant SVG icon strings.
    files: ['src/content/button/icons.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    // Build scripts and this config are plain JS outside tsconfig.json.
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
