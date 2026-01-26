module.exports = {
  'src/**/*.{ts,js}': [
    'eslint --fix',
    'prettier --write'
  ],
  'test/**/*.{ts,js}': [
    'eslint --fix',
    'prettier --write'
  ],
  '*.{ts,js}': [
    () => 'npm run build',
    () => 'tsc --noEmit'
  ]
};