import importX, { createNodeResolver } from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

// Tool boundaries are enforced structurally since the per-tool package split
// (@graphic-quicks/photo-edit, /collage, /scale); no path-restriction rule needed.
export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**'],
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    plugins: {
      'import-x': importX,
    },
    settings: {
      'import-x/resolver-next': [
        createNodeResolver({
          extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json'],
          extensionAlias: {
            '.js': ['.ts', '.tsx', '.js'],
            '.mjs': ['.mts', '.mjs'],
            '.cjs': ['.cts', '.cjs'],
          },
        }),
      ],
    },
  },
);
