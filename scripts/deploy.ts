import { execFileSync } from 'node:child_process';
import { confirm } from '@inquirer/prompts';
import { resolveCdkSelection } from './cdk-selection';
import { computeGroups } from './deploy-set';
import { runPrompt } from './prompt';

const {
	stackIds: selectedIds,
	stage: selectedStage,
	cdkArguments,
} = await resolveCdkSelection('deploy');

const groups = computeGroups(selectedIds);
const formatDuration = (milliseconds: number): string =>
	`${(milliseconds / 1000).toFixed(1)}s`;
const operationStartedAt = performance.now();
let succeeded = 0;
let failed = 0;

const isCI = /^(?:1|true)$/i.test(process.env.CI ?? '') ||
	process.env.GITHUB_ACTIONS === 'true';
const shouldBuild = isCI
	? false
	: await runPrompt(() =>
		confirm({
			message: 'Build selected stack artifacts before deploying?',
			default: true,
		}),
	);
if (shouldBuild) {
	console.log(
		`\n🛠️ Building ${selectedIds.length} selected stack(s) for ${selectedStage}`,
	);
	execFileSync('pnpm', ['build', ...selectedIds], {
		stdio: 'inherit',
		env: { ...process.env, BUILD_STAGE: selectedStage },
	});
}

console.log(
	`\n🚀 Deploying ${selectedIds.length} stack(s) in ${groups.length} dependency group(s) to ${selectedStage}`,
);

for (const [groupIndex, group] of groups.entries()) {
	const groupStartedAt = performance.now();
	console.log(
		`\n📦 Group ${groupIndex + 1}/${groups.length} · ${group.length} stack(s): ${group.join(', ')}`,
	);

	for (const id of group) {
		const stackStartedAt = performance.now();
		console.log(`🚚 Deploying ${id}...`);

		try {
			execFileSync(
				'pnpm',
				[
					'exec',
					'cdk',
					'deploy',
					id,
					'--exclusively',
					...cdkArguments,
					'--context',
					`stacks=${id}`,
				],
				{ stdio: 'inherit' },
			);
			succeeded += 1;
			console.log(`✅ ${id} deployed in ${formatDuration(performance.now() - stackStartedAt)}`);
		} catch {
			failed += 1;
			console.error(`❌ ${id} failed after ${formatDuration(performance.now() - stackStartedAt)}`);
			console.error('⏭️  Remaining stacks and dependent groups were not attempted.');
			break;
		}
	}

	console.log(
		`📊 Group ${groupIndex + 1} finished in ${formatDuration(performance.now() - groupStartedAt)}`,
	);
	if (failed > 0) {
		break;
	}
}

const skipped = selectedIds.length - succeeded - failed;
console.log(
	`\n📈 Summary · ✅ ${succeeded} succeeded · ❌ ${failed} failed · ⏭️  ${skipped} skipped · ⏱️  ${formatDuration(performance.now() - operationStartedAt)}`,
);

if (failed > 0) {
	process.exitCode = 1;
} else {
	console.log('🎉 Deployment complete.');
}
