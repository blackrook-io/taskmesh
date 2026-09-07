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
      // Compiler-oriented; many intentional UI sync patterns remain (URL→modal,
      // hold entity, draft title). Incremental cleanup tracked in T0126.
      'react-hooks/set-state-in-effect': 'warn',
      // "Latest callback ref" writes (`ref.current = fn`) during render are an
      // intentional React pattern; the Compiler rule flags them as a class.
      'react-hooks/refs': 'warn',
      // Vite Fast Refresh supports constant co-exports; context Provider+hook
      // and helper co-exports remain common — keep as warn (Vite scaffold default).
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
])
