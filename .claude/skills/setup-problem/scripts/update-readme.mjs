#!/usr/bin/env node
/**
 * update-readme - rebuild the problem checklist in the repo's root README.md.
 *
 * Usage:
 *   node .claude/skills/setup-problem/scripts/update-readme.mjs [--root src/solutions]
 *
 * Only the block between the two marker comments is rewritten, so anything you
 * add to README.md by hand survives a regeneration.
 *
 * A problem counts as solved once the scaffold's TODO marker is gone from its
 * solution file. A box ticked by hand is also kept ticked, so you can mark a
 * problem done even if the marker is still sitting there.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const START = "<!-- problems:start -->";
const END = "<!-- problems:end -->";
const STUB_MARKERS = ["TODO: your solution goes here", "Not implemented"];

/** Read "# 1. Two Sum" or "1. Two Sum" off the top of a folder's README. */
function readHeading(readmePath) {
    if (!existsSync(readmePath)) { return null; }
    for (const line of readFileSync(readmePath, "utf8").split(/\r?\n/)) {
        const match = line.match(/^\s*#*\s*(\d+)\.\s*(.+?)\s*$/);
        if (match) { return { number: Number(match[1]), title: match[2] }; }
    }
    return null;
}

function isSolved(solutionPath) {
    if (!existsSync(solutionPath)) { return false; }
    const source = readFileSync(solutionPath, "utf8");
    return !STUB_MARKERS.some((marker) => source.includes(marker));
}

export function collectProblems(root) {
    if (!existsSync(root)) { return []; }
    const problems = [];
    for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (!entry.isDirectory()) { continue; }
        const heading = readHeading(join(root, entry.name, "README.md"));
        if (!heading) { continue; }
        problems.push({
            dir: `${root}/${entry.name}`.replace(/\\/g, "/"),
            name: entry.name,
            number: heading.number,
            title: heading.title,
            solved: isSolved(join(root, entry.name, `${entry.name}.ts`))
        });
    }
    return problems.sort((a, b) => a.number - b.number);
}

/** Boxes ticked by hand stay ticked, so a manual edit is never thrown away. */
function tickedByHand(existing) {
    const ticked = new Set();
    const re = /^- \[x\] \*\*(\d+)\.\*\*/gm;
    let match = re.exec(existing);
    while (match !== null) {
        ticked.add(Number(match[1]));
        match = re.exec(existing);
    }
    return ticked;
}

function renderBlock(problems, ticked) {
    const solved = problems.filter((p) => p.solved || ticked.has(p.number));
    const lines = [
        START,
        "",
        `${solved.length} of ${problems.length} solved.`,
        ""
    ];
    for (const problem of problems) {
        const box = (problem.solved || ticked.has(problem.number)) ? "x" : " ";
        lines.push(`- [${box}] **${problem.number}.** [${problem.title}](${problem.dir})`);
    }
    lines.push("", END);
    return lines.join("\n");
}

const SKELETON = [
    "# LeetCode",
    "",
    "Interview practice in TypeScript. One folder per problem under `src/solutions`,",
    "each holding the problem statement, the solution and its tests.",
    "",
    "Add a problem with the `setup-problem` skill: `/setup-problem <number | title | url>`.",
    "Run one problem's tests with `npm run test-<problem-name>`.",
    "",
    "## Problems",
    "",
    ""
].join("\n");

export function updateReadme(root = "src/solutions", readmePath = "README.md") {
    const problems = collectProblems(root);
    if (problems.length === 0) { return null; }

    const existing = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : "";
    const block = renderBlock(problems, tickedByHand(existing));

    let next;
    if (existing.includes(START) && existing.includes(END)) {
        const before = existing.slice(0, existing.indexOf(START));
        const after = existing.slice(existing.indexOf(END) + END.length);
        next = `${before}${block}${after}`;
    }
    else if (existing.trim() === "") {
        next = `${SKELETON}${block}\n`;
    }
    else {
        // An existing README with no markers: append the block rather than
        // overwrite whatever the file already says.
        next = `${existing.replace(/\s*$/, "")}\n\n## Problems\n\n${block}\n`;
    }

    writeFileSync(readmePath, next.replace(/\r?\n/g, "\r\n"), "utf8");
    return { problems, solved: problems.filter((p) => p.solved).length };
}

// Only act when run directly, so setup-problem.mjs can import the functions.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
    const rootIndex = process.argv.indexOf("--root");
    const root = rootIndex === -1 ? "src/solutions" : process.argv[rootIndex + 1];
    const result = updateReadme(root);
    if (!result) {
        console.error(`update-readme: no problem folders found under ${root}`);
        process.exit(1);
    }
    console.log(`README.md updated: ${result.solved} of ${result.problems.length} solved.`);
}
