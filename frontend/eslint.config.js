import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'android']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    // react-hooks/set-state-in-effect (new in plugin v7) flags the standard
    // async-fetch-on-mount pattern used by every page (state is set only
    // after the fetch resolves, deps are stable, no render loop). Disabling
    // this one rule only; all other hook rules stay on.
    rules: { 'react-hooks/set-state-in-effect': 'off' },
  },
])
