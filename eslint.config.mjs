// Lint the app, the packages and the scripts.
//
// Deliberately narrow: the recommended sets plus the react-hooks rules the
// source already writes `eslint-disable-next-line` comments against. Type-
// aware linting is not switched on — `npm run typecheck` is the type gate,
// and running the checker twice buys noise rather than findings.

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    // generated, vendored or not ours
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      // Python virtualenvs ship vendored JavaScript; pip's copy of urllib3
      // is not this project's code to lint.
      '**/.venv/**',
      '**/__pycache__/**',
      'apps/web/public/**',
      'prototype/**',
      '.visual/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Browser code: the app and the workspace packages.
  {
    files: ['apps/web/src/**/*.{ts,tsx}', 'packages/*/src/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // Only the two classic hook rules. eslint-plugin-react-hooks 7 folds
      // the React Compiler checks (refs, immutability, set-state-in-effect,
      // ...) into `recommended`; the renderer has not been reviewed against
      // those, so spreading the preset would fail lint on existing code.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // The renderer keeps typed-array buffers and deck.gl layer props in
      // shapes their own types do not describe; an unused argument is often
      // a signature being honoured.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // The tile worker has neither `window` nor `document`, and does have
  // `self` and `postMessage`.
  {
    files: ['apps/web/src/workers/**/*.ts'],
    languageOptions: { globals: { ...globals.worker } },
  },

  // Build and check scripts. Node globals, plus browser ones: the browser
  // drivers pass callbacks to `page.evaluate`, whose bodies are serialised
  // and run in the page, so `document` and `location` are real there.
  {
    files: ['scripts/**/*.{mjs,cjs}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // scripts are CLIs; printing is the point
      'no-console': 'off',
      // With both global sets loaded, a local named `open` or `GPU` shadows
      // a browser built-in the Node half of the file will never see.
      'no-redeclare': 'off',
    },
  },
  {
    files: ['scripts/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs' },
    rules: {
      // CommonJS is what the extension asks for
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
