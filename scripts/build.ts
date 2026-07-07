import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { checkbox } from '@inquirer/prompts';
import { STACKS } from '../config/stacks';
import { repoRoot, sourceAreas } from './build-targets';
import { computeGroups } from './deploy-set';
import { runPrompt } from './prompt';

const usage = `Build source and stack artifacts (no CDK synthesis).

Usage:
	pnpm build                               Prompt to select source areas and stacks
	pnpm build ConsumerStack                 Build ConsumerStack only
	pnpm build schemas ConsumerStack         Build the schemas source area and ConsumerStack
	pnpm build --all                         Build everything without prompting
	pnpm build -a                            Alias for --all

Source-area hooks are opt-in: they run only with "all" or when named explicitly.
`;
const arguments_ = process.argv
	.slice(2)
	.filter((argument) => argument !== '--');

if (arguments_.includes('--help')) {
	console.log(usage);
	process.exit(0);
}

const buildAll = arguments_.some(
	(argument) =>
		argument === '--all' || argument === '-a' || argument.toLowerCase() === 'all',
);
const requested = arguments_
	.filter(
		(argument) =>
			argument !== '--all' &&
			argument !== '-a' &&
			argument.toLowerCase() !== 'all',
	)
	.flatMap((argument) => argument.split(/[\s,]+/))
	.filter(Boolean);

const knownIds = STACKS.map((stack) => stack.id);
const knownIdSet = new Set<string>(knownIds);
const sourceAreaByName = new Map(sourceAreas.map((area) => [area.name, area]));
const unknown = requested.filter(
	(id) => !knownIdSet.has(id) && !sourceAreaByName.has(id),
);
if (unknown.length > 0) {
	throw new Error(
		`Unknown target(s): ${unknown.join(', ')}. Known stacks: ${knownIds.join(', ')}. Known source areas: ${sourceAreas.map((area) => area.name).join(', ') || 'none'}.`,
	);
}

const selection = buildAll
	? [...sourceAreas.map((area) => area.name), ...knownIds]
	: requested.length > 0
		? requested
		: await runPrompt(() =>
			checkbox({
				message: 'Select targets to build:',
				choices: [
					...sourceAreas.map((area) => ({
						value: area.name,
						name: `${area.name} (source area)`,
					})),
					...STACKS.map((stack) => ({
						value: stack.id,
						name: stack.id,
						description: stack.description,
					})),
				],
				validate: (selected) =>
					selected.length > 0 ? true : 'Select at least one target.',
			}),
		);

const selectedSet = new Set(selection);
const selectedIds = knownIds.filter((id) => selectedSet.has(id));
const sourceBuildScripts = sourceAreas
	.filter((area) => selectedSet.has(area.name))
	.map((area) => area.scriptPath);
const groups = computeGroups(selectedIds);

const runBuildScript = (scriptPath: string, stackId?: string): void => {
	console.log(`▶ ${scriptPath.slice(repoRoot.length + 1)}`);
	execFileSync('pnpm', ['exec', 'tsx', scriptPath], {
		cwd: repoRoot,
		stdio: 'inherit',
		env: {
			...process.env,
			...(stackId ? { STACK_ID: stackId } : {}),
		},
	});
};

console.log(
	`🔨 Building ${sourceBuildScripts.length} selected source area(s) and ${selectedIds.length} selected stack(s)`,
);

for (const scriptPath of sourceBuildScripts) {
	runBuildScript(scriptPath);
}

let stackBuildsRun = 0;
for (const [index, group] of groups.entries()) {
	console.log(`\n📦 Stack build group ${index + 1}/${groups.length}: ${group.join(', ')}`);
	for (const id of group) {
		const stack = STACKS.find((definition) => definition.id === id);
		const stackPath = stack?.paths.find((path) => /^stacks\/[^/]+\/$/.test(path));
		if (!stack || !stackPath) {
			throw new Error(`Stack ${id} must declare a stack directory path (stacks/<name>/).`);
		}

		const buildScript = resolve(repoRoot, stackPath, 'scripts/build.ts');
		if (!existsSync(buildScript)) {
			console.log(`⏭️ ${id}: no custom build script; CDK handles its build during synth.`);
			continue;
		}

		runBuildScript(buildScript, id);
		stackBuildsRun += 1;
	}
}

console.log(
	`\n✅ Build complete: ${sourceBuildScripts.length} source hook(s), ${stackBuildsRun} stack hook(s).`,
);