---
name: setup-problem
description: Scaffold a LeetCode problem into src/solutions - fetch the statement from LeetCode's API, write the README, an empty solution stub with a runnable main(), and a failing TDD test built from the problem's own examples. Make sure to use this skill whenever the user names a LeetCode problem by number, title, slug or URL and wants to start on it, including phrasings like "set up 2014", "let's do two sum", "add longest palindromic substring", "new problem", "scaffold reverse linked list", or a bare LeetCode URL. It writes boilerplate only and never the algorithm - the user solves the problem.
---

# setup-problem

Scaffold one LeetCode problem so the user can start typing their solution immediately.

## The one rule that matters

**Never write the solution.** Not the algorithm, not a partial approach, not a "reference
implementation to compare against", not even when the problem is trivial and it would take
you four seconds.

This repo exists so the user can practise for interviews. A solved problem is worth nothing
to them; the value is entirely in the struggle of solving it. If you fill in the body, you
have not saved them time, you have destroyed the exercise. The bundled script does all the
generation precisely so that no solution code can leak in from you.

The stub body is one comment and one `throw`. Leave it that way.

## Run the script

The whole job is one command. Run it from the repo root.

```bash
node .claude/skills/setup-problem/scripts/setup-problem.mjs "<number | title | slug | url>"
```

The argument is whatever the user said. All of these work:

```bash
node .claude/skills/setup-problem/scripts/setup-problem.mjs 2014
node .claude/skills/setup-problem/scripts/setup-problem.mjs "two sum"
node .claude/skills/setup-problem/scripts/setup-problem.mjs longest-palindromic-substring
node .claude/skills/setup-problem/scripts/setup-problem.mjs https://leetcode.com/problems/lru-cache/
```

Options: `--name <dirName>` renames the folder, `--force` overwrites an existing folder,
`--json` prints a machine-readable summary, `--root <path>` changes the target directory,
`--scratch` scaffolds without touching `package.json` or the root `README.md`.

## What it writes

Into `src/solutions/<camelCaseName>/`:

| File | Contents |
|---|---|
| `README.md` | Title, link, difficulty, a collapsed `Topics` block, then the full statement converted to Markdown |
| `<name>.ts` | The exact LeetCode signature with an empty body, plus a `main()` that calls it with Example 1 |
| `<name>.test.ts` | One `it` per worked example, with LeetCode's own expected values |

It also adds a `test-<name>` script to `package.json`, matching the existing convention,
and refreshes the problem checklist in the root `README.md`.

The tests are meant to fail. That is the point: they are the target the user codes against.
Do not run them to "check" - a red suite here is success, not a problem to fix.

## The root README checklist

The root `README.md` lists every problem in number order with a checkbox. A problem is
ticked once the scaffold's `// TODO: your solution goes here.` marker is gone from its
solution file, so the list follows real progress without anyone maintaining it.

Rebuild it on its own after the user solves something:

```bash
node .claude/skills/setup-problem/scripts/update-readme.mjs
```

Only the text between the `<!-- problems:start -->` and `<!-- problems:end -->` comments is
rewritten, and a box the user ticked by hand stays ticked. So it is safe to run at any
time, and anything the user writes elsewhere in the README survives.

## After the script runs

Report the result briefly: the problem, the signature, and the two commands.

```bash
npm run test-<name>              # the failing tests
npx ts-node src/solutions/<name>/<name>.ts   # the stub's main()
```

Then stop and let the user think. Do not volunteer the approach, the data structure, the
complexity target, or a hint. The repo's CLAUDE.md holds a hint ladder; follow it only when
the user actually asks for help.

## When the script needs you

The script is deliberate about what it cannot decide alone. Handle these three cases.

**Exit code 2, ambiguous query.** The script prints candidate problems with numbers and
slugs. Show the user the list. Ask which one. Re-run with the slug.

**Warnings in the output.** The script reports what it could not parse: an unparsed
expected value, a missing parameter, an order-insensitive answer compared strictly, a
class-based design problem. Relay the warnings to the user. Fix only the mechanical parts:
a malformed literal, a wrong argument order, a `toEqual` that should be looser. Never
resolve a warning by working out what the answer should be.

**A long folder name.** The default name is the camelCased slug, so
`longest-subsequence-repeated-k-times` becomes `longestSubsequenceRepeatedKTimes`. When
that runs past roughly 30 characters, propose a shorter name and re-run with `--name`. The
existing folders in the repo are shortened this way.

## Problem shapes the script handles

Most problems need nothing from you. These are the ones worth knowing about.

- **Linked lists and trees.** The solution file exports a real `ListNode` or `TreeNode`
  class. The test file gets `arrayToList` / `listToArray` or `arrayToTree` / `treeToArray`
  so the examples read as plain arrays. These helpers are test scaffolding, not solution
  code, so they are fine to write and fine to fix.
- **In-place problems** (a `void` return, like Rotate Array). The test binds the first
  argument, calls the function, then asserts on the mutated value.
- **Design problems** (a class, like LRU Cache). The script cannot infer an operation
  sequence, so it leaves the raw snippet and a `TODO(setup-problem)` marker. Shape the
  class skeleton and the test harness with the user. Write no method bodies.

## Premium problems

LeetCode returns no statement for a premium problem, and the script stops with a clear
message. Reading one needs a `LEETCODE_SESSION` cookie from an account with a paid
subscription, exported as an environment variable before the command runs.

Never ask the user to paste that cookie into the conversation. If they want to set it, they
export it in their own shell and re-run. The script passes it through to LeetCode and never
prints it. Without a subscription the cookie changes nothing, so the honest fallback is to
open the problem page and paste the statement into the README by hand.

## What the script never fetches

It requests the statement, the examples, the tags and the TypeScript signature. It does not
request LeetCode's `hints` or `solution` fields, and you should not fetch them either. The
user asks for a hint when they want one.
