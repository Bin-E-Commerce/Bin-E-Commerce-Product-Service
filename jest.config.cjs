/** @type {import("jest").Config} */
module.exports = {
  rootDir: ".",
  testEnvironment: "node",
  testRegex: ".*\\.spec\\.ts$",
  moduleFileExtensions: ["ts", "js", "json"],
  clearMocks: true,
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.spec.ts", "!src/main.ts"],
  transform: {
    // Dùng ts-jest để Jest đọc trực tiếp TypeScript theo cùng compiler options của Product Service.
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.json",
      },
    ],
  },
  moduleNameMapper: {
    // Đồng bộ alias @common với tsconfig để test dùng đúng permission contract dùng chung của monorepo.
    "^@common/(.*)$": "<rootDir>/../../packages/common/$1",
  },
};
