/**
 * Computes the minimal set of stacks to deploy from the files changed between
 * two git refs, and emits the result for GitHub Actions.
 *
 * Inputs (env):
 *   BASE_SHA  – previous ref (e.g. `github.event.before`). Empty / all-zeros
 *               (first push) means "deploy everything".
 *   HEAD_SHA  – current ref (defaults to HEAD).
 *
 * Outputs:
 *   stdout          – JSON array of stack ids.
 *   $GITHUB_OUTPUT  – `waves=<json>` (dependency-ordered groups) and
 *                     `count=<n>` for downstream jobs.
 */
import { execSync } from 'node:child_process';
import { SHARED_PATHS, STACKS } from '../config/stacks';
import { emitWaves } from './deploy-set';

const baseSha = process.env.BASE_SHA ?? '';
const headSha = process.env.HEAD_SHA || 'HEAD';

// No base ref (or the zero SHA GitHub sends for a brand-new branch) => full deploy.
const isInitial = baseSha === '' || /^0+$/.test(baseSha);

const getChangedFiles = (): string[] => {
	if (isInitial) {
		return [];
	}

	try {
		const output = execSync(`git diff --name-only ${baseSha} ${headSha}`, {
			encoding: 'utf8',
		});

		return output
			.split('\n')
			.map((line) => line.trim())
			.filter(Boolean);
	} catch (error) {
		console.error(`Failed to compute git diff: ${(error as Error).message}`);
		return [];
	}
};

// A trailing "/" is a directory prefix match; otherwise it is an exact match.
const matchesPath = (file: string, pattern: string): boolean =>
	pattern.endsWith('/') ? file.startsWith(pattern) : file === pattern;

const changedFiles = getChangedFiles();

const sharedChanged =
	isInitial ||
	changedFiles.some((file) => SHARED_PATHS.some((p) => matchesPath(file, p)));

const stacksToDeploy = sharedChanged
	? STACKS.map((stack) => stack.id)
	: STACKS.filter((stack) =>
			changedFiles.some((file) => stack.paths.some((p) => matchesPath(file, p))),
		).map((stack) => stack.id);

console.error(
	`Changed files:\n${changedFiles.map((f) => `  ${f}`).join('\n') || '  (none)'}`,
);
console.error(sharedChanged ? 'Shared path changed → deploying all stacks.' : '');

emitWaves(stacksToDeploy);
