module.exports = {
  'apps/api/src/**/*.{ts,js}': [
    'eslint --config apps/api/eslint.config.mjs --fix',
    'prettier --write'
  ],
  'apps/api/test/**/*.{ts,js}': [
    'eslint --config apps/api/eslint.config.mjs --fix',
    'prettier --write'
  ],
  '*.{ts,tsx,js,jsx}': [
    () => 'npm run build',
    () => 'npm run typecheck'
  ]
};
