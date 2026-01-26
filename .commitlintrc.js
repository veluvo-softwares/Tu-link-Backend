module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',     // new feature
        'fix',      // bug fix
        'docs',     // documentation only changes
        'style',    // changes that do not affect the meaning of code (white-space, formatting, missing semi-colons, etc)
        'refactor', // code change that neither fixes a bug nor adds a feature
        'perf',     // code change that improves performance
        'test',     // adding missing tests or correcting existing tests
        'chore',    // changes to the build process or auxiliary tools and libraries
        'ci',       // changes to CI configuration files and scripts
        'build',    // changes that affect the build system or external dependencies
        'revert'    // reverts a previous commit
      ]
    ],
    'type-case': [2, 'always', 'lower-case'],
    'type-empty': [2, 'never'],
    'subject-case': [2, 'always', 'sentence-case'],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 72]
  }
};