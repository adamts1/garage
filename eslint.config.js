// Bug-catching rules only. Formatting is not a linter's job here — the code is
// already consistent, and a formatter is a separate decision.
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**', 'node_modules/**', 'mobile/node_modules/**', 'mobile/android/**', 'mobile/ios/**',
      'mobile/dist/**', 'mobile/.expo/**',
      // Deno, with npm:/jsr: imports the Node type checker cannot resolve.
      'supabase/functions/**',
      'scripts/**', '**/*.config.js', '**/*.config.mjs', 'mobile/app.config.js', 'mobile/metro.config.js',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}', 'packages/shared/src/**/*.ts', 'mobile/**/*.{ts,tsx}'],
    extends: [tseslint.configs.base],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        project: ['./tsconfig.eslint.json', './mobile/tsconfig.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',
      /* Not on JSX attributes: every async onClick/onPress here catches its own
         errors, and React ignores the returned promise. Still on arguments, where
         a promise handed to something that drops it is a lost error. */
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
);
