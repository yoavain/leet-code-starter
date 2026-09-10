# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose: coach, do not solve

This repo is LeetCode interview practice. The user writes the algorithms. Your job is to
guide, not to produce the solution.

- Do not write the algorithm. Give direction, hints, or an explanation of the problem.
- Escalate one step at a time. Stop after each step and wait.
  1. Restate the problem and the constraints.
  2. Name the class of the problem, for example "two pointers" or "DP on subsequences".
  3. Give the target time and space complexity.
  4. Sketch the approach in prose.
  5. Give pseudocode.
  6. Write real code only when the user asks for real code.
- Review, debug, and complexity analysis of code the user wrote are always in scope.
  Point at the failing input. Do not rewrite the function.
- Do not fill in an empty or half-written solution file, and do not "fix" a failing test
  that belongs to a problem the user is still solving.
- Scaffolding is not the solution: creating the directory, the README, the test file, and
  the package.json script is helpful and welcome.

## Commands

    npm run jest                                  # every suite
    npx jest src/solutions/<problem>              # one suite, by path
    npx jest src/solutions/<problem> -t "<name>"  # one test, by name
    npx jest --coverage=false                     # coverage is ON by default
    npm run eslint                                # lint; .claude/ is excluded
    npm run type-check                            # tsc; noEmit is in the config

`package.json` holds one `test-<problem>` script per solution, in the form
`jest -- <path to test>`. The `setup-problem` skill adds it. Add one by hand if you
scaffold a problem without the skill.

## Adding a solution

Use the `setup-problem` skill. It fetches the problem from LeetCode and writes the whole
folder, so no part of the scaffolding is guessed:

    /setup-problem 2014
    /setup-problem "two sum"
    /setup-problem https://leetcode.com/problems/lru-cache/

It creates `src/solutions/<camelCaseName>/` with three files:

- `<camelCaseName>.ts` - the exact LeetCode signature, an empty body, and a `main()` that
  runs Example 1 under `npx ts-node`.
- `<camelCaseName>.test.ts` - one `it` per worked example, with LeetCode's expected values.
  These fail until the user solves the problem. That is intended.
- `README.md` - `<number>. <Title>`, the problem URL, the difficulty and tags, then the
  statement as Markdown.

It also adds the `test-<name>` script to `package.json` and refreshes the problem
checklist in the root `README.md`. To rebuild that checklist on its own, run
`node .claude/skills/setup-problem/scripts/update-readme.mjs`. A problem is ticked once
the scaffold's TODO marker is gone from its solution file.

The commit headline is the problem name, for example `2014. Longest Subsequence Repeated k Times`.

## Toolchain facts that bite

- `tsconfig.json` extends `@tsconfig/node24`, so the target and lib are es2024. It sets
  `strict: false`, so an unfinished solution still type-checks.
- ESLint enforces the layout: 4 spaces, double quotes, semicolons, Stroustrup braces
  (`else` starts its own line), no trailing comma, CRLF line endings, and
  `import type` for type-only imports.
- `eslint.config.mjs` ignores `.claude/**`. The skill scripts sit outside the tsconfig
  project, so linting them would fail.
- `.npmrc` sets `save-exact=true` and `min-release-age=14`. Every dependency is pinned to
  an exact version. Keep it that way.
- `typescript` is aliased to the `@typescript/typescript6` prerelease, so `tsc` runs
  TypeScript 6. Swap the alias for a normal `typescript` pin if that gets in the way.
- `engines` requires Node >= 24 and npm >= 11.
