import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';

const HTML_SINK_MESSAGE =
  'No dynamic HTML (system.md §11.1): use textContent, attributes or h() from src/shared/dom.ts.';

const LAYERING_MESSAGE =
  'Layering rule (system.md §4 D11): src/shared imports no context directory, and a context imports only src/shared and itself. Move shared types into src/shared.';

// Gitignore-style groups match relative specifiers at any depth ('../background/x', '../../background/x').
function layering(dir, forbidden) {
  return {
    files: [`src/${dir}/**`],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: forbidden.map((d) => `**/${d}/**`), message: LAYERING_MESSAGE }] },
      ],
    },
  };
}

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
  layering('shared', ['background', 'content', 'offscreen', 'options']),
  layering('background', ['content', 'offscreen', 'options']),
  layering('content', ['background', 'offscreen', 'options']),
  layering('offscreen', ['background', 'content', 'options']),
  layering('options', ['background', 'content', 'offscreen']),
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
