module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Playwright owns e2e/; the Tauri app owns desktop/.
  testPathIgnorePatterns: ['/node_modules/', '/e2e/', '/desktop/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
}; 