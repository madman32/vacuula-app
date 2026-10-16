module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: { module: 'commonjs', target: 'es2022', strict: true, esModuleInterop: true, skipLibCheck: true, types: ['jest', 'node'] }, diagnostics: false }] },
  testTimeout: 20000,
};
