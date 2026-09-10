#!/usr/bin/env node
/**
 * setup-problem - scaffold a LeetCode problem folder from the public GraphQL API.
 *
 * Usage:
 *   node .claude/skills/setup-problem/scripts/setup-problem.mjs <number | name | slug | url> [options]
 *
 * Options:
 *   --name <dirName>   Override the generated folder/file name (camelCase).
 *   --root <path>      Where solution folders live. Default: src/solutions
 *   --force            Overwrite an existing folder.
 *   --json             Print a machine-readable summary instead of prose.
 *   --scratch          Scaffold only. Leave package.json and README.md alone.
 *
 * Exit codes: 0 written, 1 error, 2 ambiguous query (candidates listed on stderr).
 *
 * This script deliberately never requests the `hints` or `solution` fields.
 * The repo is interview practice; the whole point is that the human solves it.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { updateReadme } from "./update-readme.mjs";

const GRAPHQL_URL = "https://leetcode.com/graphql";
const EOL = "\r\n";
const MAX_LINE = 170;
const MARKER = "BLOCK";

/* ------------------------------------------------------------------ args */

function fail(message, code = 1) {
    console.error(`setup-problem: ${message}`);
    process.exit(code);
}

function parseArgs(argv) {
    const opts = { query: [], name: null, root: "src/solutions", force: false, json: false, scratch: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--name") { opts.name = argv[++i]; }
        else if (arg === "--root") { opts.root = argv[++i]; }
        else if (arg === "--force") { opts.force = true; }
        else if (arg === "--json") { opts.json = true; }
        else if (arg === "--scratch") { opts.scratch = true; }
        else if (arg.startsWith("--")) { fail(`Unknown option: ${arg}`); }
        else { opts.query.push(arg); }
    }
    opts.query = opts.query.join(" ").trim();
    return opts;
}

/* --------------------------------------------------------------- network */

async function gql(query, variables, referer) {
    const headers = {
        "Content-Type": "application/json",
        "Referer": referer,
        "User-Agent": "Mozilla/5.0 (setup-problem skill)"
    };
    // Free problems need no cookie at all. A premium problem needs a real
    // subscription; pass the session through without ever printing it.
    if (process.env.LEETCODE_SESSION) {
        headers.Cookie = `LEETCODE_SESSION=${process.env.LEETCODE_SESSION}`;
    }
    const res = await fetch(GRAPHQL_URL, { method: "POST", headers, body: JSON.stringify({ query, variables }) });
    if (!res.ok) { fail(`LeetCode returned HTTP ${res.status} ${res.statusText}`); }
    const body = await res.json();
    if (body.errors) { fail(`LeetCode GraphQL error: ${body.errors.map((e) => e.message).join("; ")}`); }
    return body.data;
}

const SEARCH_QUERY = `query pl($categorySlug: String, $limit: Int, $skip: Int, $filters: QuestionListFilterInput) {
  questionList(categorySlug: $categorySlug, limit: $limit, skip: $skip, filters: $filters) {
    questions: data { questionFrontendId title titleSlug difficulty isPaidOnly }
  }
}`;

const QUESTION_QUERY = `query q($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionFrontendId title titleSlug difficulty isPaidOnly content
    topicTags { name }
    codeSnippets { langSlug code }
  }
}`;

async function search(keywords) {
    const data = await gql(SEARCH_QUERY, {
        categorySlug: "",
        limit: 10,
        skip: 0,
        filters: { searchKeywords: keywords }
    }, "https://leetcode.com/problemset/");
    return data.questionList ? data.questionList.questions : [];
}

async function fetchQuestion(slug) {
    const data = await gql(QUESTION_QUERY, { titleSlug: slug }, `https://leetcode.com/problems/${slug}/`);
    return data.question;
}

/** Turn "2014", "two sum", "two-sum" or a problem URL into a titleSlug. */
async function resolveSlug(query) {
    const urlMatch = query.match(/leetcode\.com\/problems\/([a-z0-9-]+)/i);
    if (urlMatch) { return urlMatch[1]; }

    if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(query)) {
        const direct = await fetchQuestion(query);
        if (direct) { return query; }
    }

    const results = await search(query);
    if (results.length === 0) { fail(`No LeetCode problem matches "${query}".`); }

    if (/^\d+$/.test(query)) {
        const byNumber = results.find((r) => r.questionFrontendId === query);
        if (byNumber) { return byNumber.titleSlug; }
        const near = results.slice(0, 5).map((r) => `${r.questionFrontendId} ${r.title}`).join(", ");
        fail(`No problem has number ${query}. Closest matches: ${near}`);
    }

    const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const exact = results.find((r) => normalize(r.title) === normalize(query));
    if (exact) { return exact.titleSlug; }
    if (results.length === 1) { return results[0].titleSlug; }

    console.error(`setup-problem: "${query}" is ambiguous. Candidates:`);
    for (const r of results.slice(0, 8)) {
        const paid = r.isPaidOnly ? ", premium" : "";
        console.error(`  ${r.questionFrontendId}\t${r.title}\t(${r.difficulty}${paid})\t${r.titleSlug}`);
    }
    process.exit(2);
}

/* ------------------------------------------------------------------ html */

const NAMED_ENTITIES = {
    amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " ",
    ldquo: "\"", rdquo: "\"", lsquo: "'", rsquo: "'",
    hellip: "...", mdash: "-", ndash: "-", minus: "-", times: "x",
    le: "<=", ge: ">=", ne: "!=", infin: "infinity",
    rarr: "->", larr: "<-", harr: "<->", middot: "*", bull: "*"
};

function decodeEntities(str) {
    return str
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
        .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (whole, name) => (name in NAMED_ENTITIES ? NAMED_ENTITIES[name] : whole));
}

function stripTags(str) {
    return str.replace(/<[^>]*>/g, "");
}

/** <pre> holds the worked examples. Keep the text exactly, drop only markup. */
function preToText(body) {
    return decodeEntities(stripTags(body.replace(/<br\s*\/?>/gi, "\n")))
        .replace(/^\n+/, "")
        .replace(/\s+$/, "");
}

function htmlToMarkdown(html) {
    const blocks = [];
    let s = String(html).replace(/\r\n/g, "\n").replace(/&nbsp;/g, " ");

    // Lift the <pre> examples out first so their inner markup is never
    // reinterpreted as Markdown. They go back in as fenced blocks at the end.
    s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, body) => {
        blocks.push(preToText(body));
        return `\n${MARKER}${blocks.length - 1}\n`;
    });

    s = s.replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*>/gi, (_, alt, src) => `![${alt}](${src})`);
    s = s.replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, (_, src) => `![](${src})`);
    s = s.replace(/<br\s*\/?>/gi, "\n");
    s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, text) => {
        const hashes = "#".repeat(Math.min(Number(level) + 1, 6));
        return `\n\n${hashes} ${stripTags(text).trim()}\n`;
    });
    s = s.replace(/<li[^>]*>/gi, "\n- ").replace(/<\/li>/gi, "");
    s = s.replace(/<\/?(?:ul|ol|div|section|article|table|tbody|thead|tr)[^>]*>/gi, "\n");
    s = s.replace(/<\/?(?:td|th)[^>]*>/gi, " ");
    s = s.replace(/<p[^>]*>/gi, "\n\n").replace(/<\/p>/gi, "\n");

    s = s.replace(/<sup[^>]*>([\s\S]*?)<\/sup>/gi, (_, text) => `^${stripTags(text).trim()}`);
    s = s.replace(/<sub[^>]*>([\s\S]*?)<\/sub>/gi, (_, text) => `_${stripTags(text).trim()}`);
    s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, text) => {
        const inner = stripTags(text).replace(/`/g, "").trim();
        return inner ? `\`${inner}\`` : "";
    });
    s = s.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => `[${stripTags(text).trim()}](${href})`);
    s = s.replace(/<(?:strong|b)[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (_, text) => {
        const inner = stripTags(text).trim();
        return inner ? `**${inner}** ` : "";
    });
    s = s.replace(/<(?:em|i|var)[^>]*>([\s\S]*?)<\/(?:em|i|var)>/gi, (_, text) => {
        const inner = stripTags(text).trim();
        return inner ? `*${inner}*` : "";
    });

    s = decodeEntities(stripTags(s));

    s = s.split("\n").map((line) => line.replace(/[ \t]+$/, "").replace(/[ \t]{2,}/g, " ").trimEnd()).join("\n");
    // Emphasis carries a trailing space so words do not run together; drop it
    // again where the next character is punctuation.
    s = s.replace(/\*\* ([.,;:!?)\]])/g, "**$1");
    s = s.replace(/\n{3,}/g, "\n\n").trim();
    // Keep consecutive bullets tight; LeetCode's <li> markup leaves gaps.
    s = s.replace(/^(- .*)\n\n(?=- )/gm, "$1\n");

    const markerRe = new RegExp(`${MARKER}(\\d+)`, "g");
    s = s.replace(markerRe, (_, index) => `\n\`\`\`\n${blocks[Number(index)]}\n\`\`\`\n`);
    return s.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Newer statements wrap examples in <div class="example-block"> with one <p>
 * per line instead of a <pre>. Flatten one to the same plain-text shape.
 */
function blockToText(body) {
    const withBreaks = body
        .replace(/<\/p>/gi, "\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<li[^>]*>/gi, "\n- ")
        .replace(/<\/li>/gi, "");
    return decodeEntities(stripTags(withBreaks))
        .split("\n")
        .map((line) => line.trim())
        .join("\n")
        .replace(/\n{2,}/g, "\n")
        .trim();
}

/** Pull Input / Output / Explanation out of every example block, old or new. */
function extractExamples(html) {
    const examples = [];
    const re = /<pre[^>]*>([\s\S]*?)<\/pre>|<div class="example-block">([\s\S]*?)<\/div>/gi;
    let match = re.exec(html);
    while (match !== null) {
        const text = match[1] !== undefined ? preToText(match[1]) : blockToText(match[2]);
        const input = text.match(/^[ \t]*Input:?[ \t]*([\s\S]*?)(?=^[ \t]*Output:?|$(?![\s\S]))/m);
        const output = text.match(/^[ \t]*Output:?[ \t]*([\s\S]*?)(?=^[ \t]*Explanation:?|$(?![\s\S]))/m);
        const explanation = text.match(/^[ \t]*Explanation:?[ \t]*([\s\S]*)$/m);
        if (input && output) {
            examples.push({
                input: input[1].trim(),
                output: output[1].trim(),
                explanation: explanation ? explanation[1].trim() : null,
                raw: text
            });
        }
        match = re.exec(html);
    }
    return examples;
}

/* ------------------------------------------------------------- signature */

function splitTopLevel(str) {
    const parts = [];
    let depth = 0;
    let quote = "";
    let cur = "";
    for (let i = 0; i < str.length; i++) {
        const ch = str[i];
        if (quote) {
            cur += ch;
            if (ch === "\\") { cur += str[++i] || ""; }
            else if (ch === quote) { quote = ""; }
            continue;
        }
        if (ch === "\"" || ch === "'") { quote = ch; cur += ch; continue; }
        if (ch === "[" || ch === "{" || ch === "(" || ch === "<") { depth++; cur += ch; continue; }
        if (ch === "]" || ch === "}" || ch === ")" || ch === ">") { depth--; cur += ch; continue; }
        if (ch === "," && depth === 0) { parts.push(cur); cur = ""; continue; }
        cur += ch;
    }
    if (cur.trim() !== "") { parts.push(cur); }
    return parts.map((p) => p.trim()).filter(Boolean);
}

function parseSignature(tsCode) {
    const bare = tsCode.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    const classMatch = bare.match(/^\s*class\s+([A-Za-z_$][\w$]*)/m);
    const fnMatch = bare.match(/function\s+([A-Za-z_$][\w$]*)\s*\(([\s\S]*?)\)\s*:\s*([^{]+?)\s*\{/);
    if (!fnMatch) {
        return {
            kind: classMatch ? "class" : "unknown",
            className: classMatch ? classMatch[1] : null,
            raw: tsCode.trim()
        };
    }
    const params = splitTopLevel(fnMatch[2]).map((p) => {
        const colon = p.indexOf(":");
        return colon === -1
            ? { name: p.trim(), type: "any" }
            : { name: p.slice(0, colon).trim(), type: p.slice(colon + 1).trim() };
    });
    return { kind: "function", fn: fnMatch[1], params, returnType: fnMatch[3].trim(), raw: tsCode.trim() };
}

/* ---------------------------------------------------------------- values */

function parseValue(raw) {
    const text = raw.trim().replace(/,$/, "");
    try { return { ok: true, value: JSON.parse(text) }; }
    catch { /* not plain JSON, try harder below */ }
    try { return { ok: true, value: JSON.parse(text.replace(/'/g, "\"")) }; }
    catch { /* give up and let the caller flag it */ }
    return { ok: false, text };
}

function formatLiteral(value) {
    if (value === null) { return "null"; }
    if (Array.isArray(value)) { return `[${value.map(formatLiteral).join(", ")}]`; }
    if (typeof value === "string") { return JSON.stringify(value); }
    if (typeof value === "object") {
        const entries = Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${formatLiteral(v)}`);
        return `{ ${entries.join(", ")} }`;
    }
    return String(value);
}

/** Keep generated lines under the repo's max-len rule by chunking big arrays. */
function renderValue(value, indent) {
    const flat = formatLiteral(value);
    if (indent + flat.length <= MAX_LINE || !Array.isArray(value)) { return flat; }
    const pad = " ".repeat(indent + 4);
    const lines = [];
    let cur = "";
    for (const item of value.map(formatLiteral)) {
        const joined = cur === "" ? item : `${cur}, ${item}`;
        if (pad.length + joined.length > MAX_LINE) { lines.push(cur); cur = item; }
        else { cur = joined; }
    }
    if (cur !== "") { lines.push(cur); }
    return `[\n${lines.map((l) => pad + l).join(",\n")}\n${" ".repeat(indent)}]`;
}

/** "nums = [2,7,11,15], target = 9" -> ordered {name, raw} pairs. */
function parseInput(inputText) {
    const oneLine = inputText.replace(/\n+/g, ", ").trim();
    return splitTopLevel(oneLine).map((part) => {
        const m = part.match(/^([A-Za-z_$][\w$]*)\s*=\s*([\s\S]+)$/);
        return m ? { name: m[1], raw: m[2].trim() } : { name: null, raw: part };
    });
}

/** Line the example's values up with the signature's parameters. */
function alignArguments(assigned, params) {
    const warnings = [];
    const byName = new Map(assigned.filter((a) => a.name).map((a) => [a.name, a.raw]));
    const args = params.map((param, index) => {
        const raw = byName.has(param.name) ? byName.get(param.name) : (assigned[index] ? assigned[index].raw : null);
        if (raw === null) {
            warnings.push(`no value found for parameter "${param.name}"`);
            return { param, ok: false, text: "undefined" };
        }
        const parsed = parseValue(raw);
        if (!parsed.ok) {
            warnings.push(`could not parse the value for "${param.name}": ${raw}`);
            return { param, ok: false, text: raw };
        }
        return { param, ok: true, value: parsed.value };
    });
    return { args, warnings };
}

/* ------------------------------------------------------------- scaffolds */

function camelCase(slug) {
    return slug.split("-")
        .map((word, i) => (i === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
        .join("");
}

function kebabCase(name) {
    return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

const LIST_NODE_CLASS = [
    "export class ListNode {",
    "    val: number;",
    "    next: ListNode | null;",
    "",
    "    constructor(val?: number, next?: ListNode | null) {",
    "        this.val = (val === undefined ? 0 : val);",
    "        this.next = (next === undefined ? null : next);",
    "    }",
    "}"
];

const TREE_NODE_CLASS = [
    "export class TreeNode {",
    "    val: number;",
    "    left: TreeNode | null;",
    "    right: TreeNode | null;",
    "",
    "    constructor(val?: number, left?: TreeNode | null, right?: TreeNode | null) {",
    "        this.val = (val === undefined ? 0 : val);",
    "        this.left = (left === undefined ? null : left);",
    "        this.right = (right === undefined ? null : right);",
    "    }",
    "}"
];

const LIST_HELPERS = [
    "const arrayToList = (values: number[]): ListNode | null => {",
    "    let head: ListNode | null = null;",
    "    let tail: ListNode | null = null;",
    "    for (const value of values) {",
    "        const node = new ListNode(value);",
    "        if (tail) {",
    "            tail.next = node;",
    "            tail = node;",
    "        }",
    "        else {",
    "            head = node;",
    "            tail = node;",
    "        }",
    "    }",
    "    return head;",
    "};",
    "",
    "const listToArray = (head: ListNode | null): number[] => {",
    "    const values: number[] = [];",
    "    let node = head;",
    "    while (node) {",
    "        values.push(node.val);",
    "        node = node.next;",
    "    }",
    "    return values;",
    "};"
];

const TREE_HELPERS = [
    "// LeetCode serialises a tree in level order, with null for a missing child.",
    "const arrayToTree = (values: (number | null)[]): TreeNode | null => {",
    "    if (values.length === 0 || values[0] === null) {",
    "        return null;",
    "    }",
    "    const root = new TreeNode(values[0]);",
    "    const queue: TreeNode[] = [root];",
    "    let index = 1;",
    "    while (queue.length > 0 && index < values.length) {",
    "        const node = queue.shift();",
    "        const left = values[index++];",
    "        if (left !== null && left !== undefined) {",
    "            node.left = new TreeNode(left);",
    "            queue.push(node.left);",
    "        }",
    "        const right = values[index++];",
    "        if (right !== null && right !== undefined) {",
    "            node.right = new TreeNode(right);",
    "            queue.push(node.right);",
    "        }",
    "    }",
    "    return root;",
    "};",
    "",
    "const treeToArray = (root: TreeNode | null): (number | null)[] => {",
    "    const values: (number | null)[] = [];",
    "    const queue: (TreeNode | null)[] = [root];",
    "    while (queue.length > 0) {",
    "        const node = queue.shift();",
    "        if (node) {",
    "            values.push(node.val);",
    "            queue.push(node.left);",
    "            queue.push(node.right);",
    "        }",
    "        else {",
    "            values.push(null);",
    "        }",
    "    }",
    "    while (values.length > 0 && values[values.length - 1] === null) {",
    "        values.pop();",
    "    }",
    "    return values;",
    "};"
];

function needsNode(signature, className) {
    if (signature.kind !== "function") { return false; }
    const types = signature.params.map((p) => p.type).concat(signature.returnType).join(" ");
    return types.includes(className);
}

/** Render one argument as TypeScript, wrapping node-typed values in a builder. */
function renderArgument(arg, indent) {
    if (!arg.ok) { return arg.text; }
    if (arg.param.type.includes("ListNode")) { return `arrayToList(${renderValue(arg.value, indent)})`; }
    if (arg.param.type.includes("TreeNode")) { return `arrayToTree(${renderValue(arg.value, indent)})`; }
    return renderValue(arg.value, indent);
}

function toFile(lines) {
    return lines.join("\n").split("\n").join(EOL) + EOL;
}

function renderReadme(question, url) {
    const tags = question.topicTags.map((t) => t.name).join(", ");
    // Topics sit in a <details> block. GitHub and the VS Code preview both collapse it,
    // so the tags stay one click away instead of spoiling the first read.
    const topics = tags ? ["", "<details>", "<summary>Topics</summary>", "", tags, "", "</details>"] : [];
    return toFile([
        `# ${question.questionFrontendId}. ${question.title}`,
        "",
        url,
        "",
        `**${question.difficulty}**`,
        ...topics,
        "",
        "---",
        "",
        htmlToMarkdown(question.content)
    ]);
}

function renderSolution(signature, examples, aligned, warnings) {
    const lines = [];
    const wantsList = needsNode(signature, "ListNode");
    const wantsTree = needsNode(signature, "TreeNode");

    if (signature.kind !== "function") {
        lines.push("// TODO(setup-problem): this problem is class-based, so the stub below is the raw");
        lines.push("// LeetCode snippet. Shape it however you like before you start.");
        lines.push("");
        lines.push(...signature.raw.split("\n"));
        return toFile(lines);
    }

    if (wantsList) { lines.push(...LIST_NODE_CLASS, ""); }
    if (wantsTree) { lines.push(...TREE_NODE_CLASS, ""); }

    const params = signature.params.map((p) => `${p.name}: ${p.type}`).join(", ");
    lines.push(`export function ${signature.fn}(${params}): ${signature.returnType} {`);
    lines.push("    // TODO: your solution goes here.");
    if (signature.returnType !== "void") {
        // Without this the empty body is a TS2355 error, and the tests would
        // fail on a type error rather than on a wrong answer.
        lines.push("    throw new Error(\"Not implemented\");");
    }
    lines.push("}");
    lines.push("");

    if (examples.length === 0 || !aligned) {
        warnings.push("no example could be parsed, so main() was left out of the solution file");
        return toFile(lines);
    }

    const takesList = signature.params.some((p) => p.type.includes("ListNode"));
    const returnsList = signature.returnType.includes("ListNode");

    if (wantsList || wantsTree) {
        lines.push("// Scaffolding for main() only. The test file carries its own copies.");
        if (takesList) {
            lines.push("const toList = (values: number[]): ListNode | null =>");
            lines.push("    values.reduceRight<ListNode | null>((next, val) => new ListNode(val, next), null);");
        }
        if (returnsList) {
            lines.push("const fromList = (head: ListNode | null): number[] =>");
            lines.push("    (head ? [head.val].concat(fromList(head.next)) : []);");
        }
        if (wantsTree) {
            lines.push("// TODO(setup-problem): build the tree for main(), or copy arrayToTree from the test file.");
        }
        lines.push("");
    }

    const callArgs = aligned.args.map((a) => {
        if (a.param.type.includes("ListNode") && a.ok) { return `toList(${renderValue(a.value, 8)})`; }
        if (a.param.type.includes("TreeNode")) { return "null /* TODO: build the tree */"; }
        return renderArgument(a, 8);
    });

    lines.push("function main(): void {");
    lines.push(`    // Example 1: ${examples[0].input.replace(/\s+/g, " ")}`);
    lines.push(`    // expected:  ${examples[0].output.replace(/\s+/g, " ")}`);
    if (signature.returnType === "void") {
        // In-place problem: the answer is the mutated argument, so print that.
        const firstName = aligned.args.length > 0 ? aligned.args[0].param.name : "input";
        lines.push(`    const ${firstName} = ${callArgs[0]};`);
        lines.push(`    ${signature.fn}(${[firstName].concat(callArgs.slice(1)).join(", ")});`);
        lines.push(`    console.log(${firstName});`);
    }
    else {
        const call = `${signature.fn}(${callArgs.join(", ")})`;
        lines.push(`    console.log(${returnsList ? `fromList(${call})` : call});`);
    }
    lines.push("}");
    lines.push("");
    lines.push("if (require.main === module) {");
    lines.push("    main();");
    lines.push("}");

    return toFile(lines);
}

function renderTest(signature, examples, dirName, warnings) {
    const lines = [];
    const wantsList = needsNode(signature, "ListNode");
    const wantsTree = needsNode(signature, "TreeNode");

    if (signature.kind !== "function") {
        lines.push("// TODO(setup-problem): class-based problem - write the operation sequence by hand.");
        lines.push("// The examples from LeetCode:");
        for (const example of examples) {
            lines.push(`// ${example.raw.replace(/\n/g, "\n// ")}`);
        }
        return toFile(lines);
    }

    const imported = [signature.fn];
    if (wantsList) { imported.push("ListNode"); }
    if (wantsTree) { imported.push("TreeNode"); }
    lines.push(`import { ${imported.join(", ")} } from "./${dirName}";`);
    lines.push("");
    if (wantsList) { lines.push(...LIST_HELPERS, ""); }
    if (wantsTree) { lines.push(...TREE_HELPERS, ""); }

    lines.push(`describe("test ${signature.fn}", () => {`);

    examples.forEach((example, index) => {
        const aligned = alignArguments(parseInput(example.input), signature.params);
        for (const w of aligned.warnings) { warnings.push(`example ${index + 1}: ${w}`); }

        const expected = parseValue(example.output);
        const title = `Example ${index + 1}: ${example.input.replace(/\s+/g, " ")}`.replace(/"/g, "\\\"");
        const callArgs = aligned.args.map((a) => renderArgument(a, 12));

        lines.push(`    it("${title}", () => {`);
        if (example.explanation) {
            lines.push(`        // ${example.explanation.replace(/\n/g, "\n        // ")}`);
        }

        if (signature.returnType === "void") {
            // In-place problems: LeetCode's Output describes the mutated first argument.
            const firstName = aligned.args.length > 0 ? aligned.args[0].param.name : "input";
            lines.push(`        const ${firstName} = ${callArgs[0]};`);
            lines.push(`        ${signature.fn}(${[firstName].concat(callArgs.slice(1)).join(", ")});`);
            lines.push("");
            if (expected.ok) {
                lines.push(`        expect(${firstName}).toEqual(${renderValue(expected.value, 8)});`);
            }
            else {
                warnings.push(`example ${index + 1}: could not parse the expected output "${example.output}"`);
                lines.push(`        // TODO(setup-problem): unparsed expected output: ${example.output}`);
                lines.push(`        expect(${firstName}).toEqual(undefined);`);
            }
        }
        else {
            const returnType = signature.returnType;
            lines.push(`        const result: ${returnType} = ${signature.fn}(${callArgs.join(", ")});`);
            lines.push("");
            const actual = returnType.includes("ListNode") ? "listToArray(result)"
                : returnType.includes("TreeNode") ? "treeToArray(result)"
                    : "result";
            if (expected.ok) {
                const matcher = (typeof expected.value === "object" && expected.value !== null) ? "toEqual" : "toBe";
                lines.push(`        expect(${actual}).${matcher}(${renderValue(expected.value, 8)});`);
            }
            else {
                warnings.push(`example ${index + 1}: could not parse the expected output "${example.output}"`);
                lines.push(`        // TODO(setup-problem): unparsed expected output: ${example.output}`);
                lines.push(`        expect(${actual}).toEqual(undefined);`);
            }
        }
        lines.push("    });");
        if (index < examples.length - 1) { lines.push(""); }
    });

    lines.push("});");
    return toFile(lines);
}

/* ------------------------------------------------------------------ main */

const opts = parseArgs(process.argv.slice(2));
if (!opts.query) {
    fail("give me a problem number, name, slug or URL. Example: setup-problem.mjs 2014");
}

const slug = await resolveSlug(opts.query);
const question = await fetchQuestion(slug);
if (!question) { fail(`LeetCode has no problem with slug "${slug}".`); }

const url = `https://leetcode.com/problems/${question.titleSlug}/`;

if (!question.content) {
    const premium = question.isPaidOnly ? " It is a premium problem." : "";
    fail([
        `LeetCode returned no statement for ${question.questionFrontendId}. ${question.title}.${premium}`,
        process.env.LEETCODE_SESSION
            ? "LEETCODE_SESSION is set, so the account behind it probably has no premium subscription."
            : "Premium problems need a LEETCODE_SESSION cookie from a subscribed account, exported as an environment variable.",
        `Open ${url} and paste the statement in by hand if you want to work on it anyway.`
    ].join("\n"));
}

const snippet = question.codeSnippets.find((s) => s.langSlug === "typescript");
if (!snippet) { fail(`LeetCode has no TypeScript snippet for ${question.title}.`); }

const signature = parseSignature(snippet.code);
const examples = extractExamples(question.content);
const warnings = [];

if (examples.length === 0) {
    warnings.push("no Input/Output example blocks were found in the statement");
}
// Tags sit between the words in the HTML, so test the stripped text.
if (/in any order/i.test(stripTags(question.content).replace(/\s+/g, " "))) {
    warnings.push("the statement accepts the answer \"in any order\", but the generated expectations compare order strictly - loosen them if your answer is valid in a different order");
}
if (signature.kind !== "function") {
    const shape = signature.kind === "class" ? "class-based (a design problem)" : "an unrecognised shape";
    warnings.push(`this problem is ${shape}, so the stub and the test need shaping by hand`);
}

const dirName = opts.name || camelCase(question.titleSlug);
const dir = join(opts.root, dirName);
if (existsSync(dir) && !opts.force) {
    fail(`${dir} already exists. Pass --force to overwrite it.`);
}

const aligned = (signature.kind === "function" && examples.length > 0)
    ? alignArguments(parseInput(examples[0].input), signature.params)
    : null;

const files = {
    "README.md": renderReadme(question, url),
    [`${dirName}.ts`]: renderSolution(signature, examples, aligned, warnings),
    [`${dirName}.test.ts`]: renderTest(signature, examples, dirName, warnings)
};

mkdirSync(dir, { recursive: true });
for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, "utf8");
}

// Follow the repo convention of one test-<problem> script per solution.
let scriptName = null;
if (!opts.scratch) {
    scriptName = `test-${kebabCase(dirName)}`;
    try {
        const pkg = JSON.parse(readFileSync("package.json", "utf8"));
        if (!pkg.scripts[scriptName]) {
            const testPath = `${join(opts.root, dirName).replace(/\\/g, "/")}/${dirName}.test.ts`;
            pkg.scripts[scriptName] = `jest -- ${testPath}`;
            writeFileSync("package.json", `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
        }
    }
    catch (err) {
        warnings.push(`could not add the npm script: ${err.message}`);
        scriptName = null;
    }
}

// Keep the root checklist in step with what is actually on disk.
let readmeCount = null;
if (!opts.scratch) {
    try {
        const result = updateReadme(opts.root);
        if (result) { readmeCount = `${result.solved} of ${result.problems.length} solved`; }
    }
    catch (err) {
        warnings.push(`could not update the root README: ${err.message}`);
    }
}

const summary = {
    id: question.questionFrontendId,
    title: question.title,
    slug: question.titleSlug,
    difficulty: question.difficulty,
    url,
    dir: dir.replace(/\\/g, "/"),
    fn: signature.kind === "function" ? signature.fn : null,
    signature: signature.kind === "function"
        ? `${signature.fn}(${signature.params.map((p) => `${p.name}: ${p.type}`).join(", ")}): ${signature.returnType}`
        : signature.kind,
    examples: examples.length,
    files: Object.keys(files),
    npmScript: scriptName,
    warnings
};

if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
}
else {
    console.log(`${summary.id}. ${summary.title}  (${summary.difficulty})`);
    console.log(`  ${url}`);
    console.log(`  folder     ${summary.dir}`);
    console.log(`  signature  ${summary.signature}`);
    console.log(`  tests      ${summary.examples} example${summary.examples === 1 ? "" : "s"}`);
    if (scriptName) { console.log(`  npm script npm run ${scriptName}`); }
    if (readmeCount) { console.log(`  README.md  ${readmeCount}`); }
    console.log(`  run stub   npx ts-node ${summary.dir}/${dirName}.ts`);
    if (warnings.length > 0) {
        console.log("");
        console.log("  warnings:");
        for (const w of warnings) { console.log(`    - ${w}`); }
    }
}
