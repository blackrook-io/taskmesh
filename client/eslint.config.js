import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Cleared in T0126 (derive-during-render / keyed remount / adjust-on-render).
      'react-hooks/set-state-in-effect': 'error',
      // "Latest callback ref" writes (`ref.current = fn`) during render are an
      // intentional React pattern; remaining sites use targeted disables.
      'react-hooks/refs': 'error',
      // Vite Fast Refresh supports constant co-exports; Provider+hook and
      // helper co-exports use file-level disables where intentional.
      'react-refresh/only-export-components': [
        'error',
        { allowConstantExport: true },
      ],
    },
  },
])
