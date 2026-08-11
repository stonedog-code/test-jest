import js from '@eslint/js';
import jest from 'eslint-plugin-jest';
import tseslint from 'typescript-eslint';

/**
 * Flat config (eslint.config.mjs) — the only supported format since ESLint 9.
 * `.eslintrc.json` is silently ignored, which looks exactly like "no lint
 * errors".
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Floating promises are the single most common async bug: the call
      // succeeds, the rejection goes unhandled, and the test passes anyway.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',

      // Express identifies error middleware by ARITY: a 3-argument function is
      // ordinary middleware and never sees errors. So the unused 4th parameter
      // is load-bearing and must not be deleted to satisfy the linter.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  {
    // This file is not in tsconfig's project, so type-aware rules cannot run
    // on it. Turning them off here is the documented approach; leaving it in
    // produces "was not found by the project" on every run.
    files: ['eslint.config.mjs'],
    ...tseslint.configs.disableTypeChecked,
  },

  {
    files: ['test/**/*.ts'],
    plugins: { jest },
    languageOptions: {
      globals: jest.environments.globals.globals,
    },
    rules: {
      ...jest.configs['flat/recommended'].rules,

      /**
       * Swap the base unbound-method rule for jest's version.
       *
       * `expect(obj.method)` looks like an unbound method reference and is not
       * — it is how you assert on a mock. The base rule cannot tell the
       * difference and flags every such assertion; jest's version understands
       * `expect()` and still catches the real cases. This is a replacement,
       * not a suppression.
       */
      '@typescript-eslint/unbound-method': 'off',
      'jest/unbound-method': 'error',

      // Catches `expect(promise).toThrow()` with no `await` / `rejects`, which
      // passes unconditionally and proves nothing.
      'jest/valid-expect': 'error',
      'jest/no-conditional-expect': 'error',
      // A test with no assertion is a test that cannot fail.
      'jest/expect-expect': 'error',
      // Fails the build if a `.only` is committed, which would silently skip
      // every other test in the file.
      'jest/no-focused-tests': 'error',

      // Test files legitimately reach into loosely-typed territory: response
      // bodies are `any` until asserted, and mocks are deliberately partial.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-empty-function': 'off',
    },
  },
);
