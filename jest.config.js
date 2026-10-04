module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Playwright owns e2e/; the Tauri app owns desktop/.
  testPathIgnorePatterns: ['/node_modules/', '/e2e/', '/desktop/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  transform: {
    // Jest runs CommonJS; the app tsconfig's verbatimModuleSyntax/bundler
    // settings target Next's ESM build and reject every TS test file.
    '^.+\\.tsx?$': [
      'ts-jest',
      { tsconfig: { verbatimModuleSyntax: false, module: 'commonjs', moduleResolution: 'node' } },
    ],
  },
}; 