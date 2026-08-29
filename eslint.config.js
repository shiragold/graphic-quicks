import importX, { createNodeResolver } from 'eslint-plugin-import-x';
import tseslint from 'typescript-eslint';

const root = import.meta.dirname;

const TOOL_DOMAINS = ['photo-edit', 'collage', 'scale'];

const domainDir = (name) => `packages/core/src/${name}`;

/** Each tool domain in core is a black box to the other two; only src/index.ts may span them. */
const boundaryZones = TOOL_DOMAINS.map((domain) => ({
  target: domainDir(domain),
  from: TOOL_DOMAINS.filter((other) => other !== domain).map(domainDir),
  message: `core/${domain} must not import from another tool domain; the tool domains are independent and only src/index.ts may combine them.`,
}));

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
    rules: {
      'import-x/no-restricted-paths': [
        'error',
        {
          basePath: root,
          zones: boundaryZones,
        },
      ],
    },
  },
);
