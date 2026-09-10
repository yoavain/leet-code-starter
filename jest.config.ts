import type { Config } from "@jest/types";

const config: Config.InitialOptions = {
    transform: {
        "^.+\\.ts$": ["ts-jest", {
            tsconfig: "tsconfig.jest.json"
        }]
    },
    testEnvironment: "node",
    restoreMocks: true,
    passWithNoTests: true,
    testRegex: ".*.test.ts$",
    moduleFileExtensions: ["ts", "js", "json", "node"],
    maxWorkers: "50%",
    verbose: true,
    collectCoverage: true,
    coverageDirectory: "coverage",
    coverageReporters: [
        "text",
        "text-summary",
        "json",
        "lcov",
        "clover"
    ],
    collectCoverageFrom: ["src/**/*.ts", "!**/node_modules/**"]
};

export default config;
