# LeetCode Starter

A TypeScript workspace for LeetCode practice. One folder per problem under
`src/solutions`, each holding the problem statement, the solution stub and its tests.

Claude Code writes the scaffolding. You write the algorithm. `CLAUDE.md` instructs Claude
to coach, and not to give the solution away.

## Requirements

- Node >= 24
- npm >= 11
- Claude Code, for the `/setup-problem` skill. The script also runs on its own.

## Setup

    npm ci

## Add a problem

In Claude Code:

    /setup-problem 1
    /setup-problem "two sum"
    /setup-problem https://leetcode.com/problems/lru-cache/

Without Claude Code:

    node .claude/skills/setup-problem/scripts/setup-problem.mjs 1

Each run creates `src/solutions/<name>/`. The folder holds the problem statement, a stub
with the exact LeetCode signature, and one test per worked example. The run also adds an
`npm run test-<name>` script and refreshes the checklist below. The tests fail until you
solve the problem. That is the point.

## Run

    npm run test-<problem>   # one problem
    npm run jest             # every suite; coverage is on
    npm run eslint
    npm run type-check

## Premium problems

Free problems need no account. A premium problem needs a subscribed account. Export the
session cookie as `LEETCODE_SESSION` before you run the skill. Keep it in your shell.
Never commit it.

## Notes

- Problem statements come from LeetCode and remain LeetCode's content. Think about that
  before you push your solved problems to a public repository.
- ESLint warns when line endings are not CRLF. On macOS or Linux, set `linebreak-style`
  to `"unix"` in `eslint.config.mjs`.
- `typescript` is aliased to the `@typescript/typescript6` prerelease. Swap it for a
  normal `typescript` pin if that gets in the way.

## Problems

<!-- problems:start -->

<!-- problems:end -->

## License

MIT. See `LICENSE`.
