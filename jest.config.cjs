// @type {import("jest").Config}
module.exports = {
    rootDir: '.',
    testEnvironment: 'node',
    testRegex: '.*\\.spec\\.ts$',
    moduleFileExtensions: ['ts', 'js', 'json'],
    clearMocks: true,
    collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/main.ts'],
    transform: {
        '^.+\\.ts$': [
            'ts-jest',
            {
                tsconfig: '<rootDir>/tsconfig.spec.json',
            },
        ],
    },
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1',
        '^@common/(.*)$': '<rootDir>/../../packages/common/$1',
    },
};
