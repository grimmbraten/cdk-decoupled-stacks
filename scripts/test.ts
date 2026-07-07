import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { SHARED_PATHS, STACKS } from '../config/stacks';
import { repoRoot } from './build-targets';

const requested = process.argv
	.slice(2)
	.flatMap((argument) => argument.split(/[\s,]+/))
	.filter(Boolean);
const knownIds: string[] = STACKS.map((stack) => stack.id);
const knownIdSet = new Set<string>(knownIds);
const runAll = requested.length === 0 ||
	requested.some((id) => id.toLowerCase() === 'all');
const unknown = requested.filter(
	(id) => id.toLowerCase() !== 'all' && !knownIdSet.has(id),
);
if (unknown.length > 0) {
	throw new Error(
		`Unknown stack id(s): ${unknown.join(', ')}. Known stacks: ${knownIds.join(', ')}.`,
	);
}

const selectedStacks = runAll
	? STACKS
	: STACKS.filter((stack) => requested.includes(stack.id));
const testFiles = new Set<string>();
const excludedDirectories = new Set(['cdk.out', 'generated', 'node_modules']);

const collectTests = (path: string): void => {
	const absolutePath = resolve(repoRoot, path);
	if (!existsSync(absolutePath)) {
		return;
	}
	if (!statSync(absolutePath).isDirectory()) {
		if (absolutePath.endsWith('.test.ts')) {
			testFiles.add(absolutePath);
		}
		return;
	}

	for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
		if (entry.isDirectory() && excludedDirectories.has(entry.name)) {
			continue;
		}
		const entryPath = resolve(absolutePath, entry.name);
		if (entry.isDirectory()) {
			collectTests(entryPath);
		} else if (entry.name.endsWith('.test.ts')) {
			testFiles.add(entryPath);
		}
	}
};

for (const path of SHARED_PATHS) {
	collectTests(path);
}
for (const stack of selectedStacks) {
	for (const path of stack.paths) {
		collectTests(path);
	}
}

if (testFiles.size === 0) {
	console.log(
		`No tests found for shared code or selected stacks: ${selectedStacks.map((stack) => stack.id).join(', ') || '(none)'}.`,
	);
	process.exit(0);
}

console.log(
	`Testing shared code and ${selectedStacks.length} selected stack(s) with ${testFiles.size} test file(s).`,
);
execFileSync('pnpm', ['exec', 'tsx', '--test', ...[...testFiles].sort()], {
	cwd: repoRoot,
	stdio: 'inherit',
});