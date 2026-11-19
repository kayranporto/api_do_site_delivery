export default {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/jest/**/*.test.js'],
  transform: {},
  collectCoverageFrom: ['src/domain/**/*.js'],
  coveragePathIgnorePatterns: ['/ports/']
};
