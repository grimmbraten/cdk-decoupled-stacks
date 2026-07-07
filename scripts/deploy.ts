/**
 * Interactive local deploy script.
 * Run with: pnpm cdk:deploy
 */

import { execFileSync } from 'node:child_process';
import { checkbox, select } from '@inquirer/prompts';
import { STACKS } from '../config/stacks';
import { stage as stages } from '../constructs/app';
import { computeWaves } from './deploy-set';

const selectedStage = await select({
	message: 'Deploy to which stage?',
	choices: Object.values(stages).map((s) => ({ value: s })),
});

// todo: could a option be to deploy all changed stacks? (like the automatic pipeline does). Could this be a prompt input (like "a" that selects all?)
const selectedIds = await checkbox({
	message: 'Select stacks to deploy:',
	choices: STACKS.map((s) => ({
		value: s.id,
		name: s.id,
		description: s.description,
	})),
	validate: (input) => (input.length > 0 ? true : 'Select at least one stack.'),
});

const waves = computeWaves(selectedIds);

// todo: can we add more information and metrics here that could be useful to the operator (when debugging)?
// todo: emojis could be used to make the output more visually appealing and easier to read. For example, we could use a rocket emoji for the deploy command, a checkmark for successful deploys, and a warning sign for failed deploys. We could also use different colors for different stages (e.g., green for prod, yellow for staging, blue for dev) to make it easier to distinguish between them at a glance.
console.log(
	`\nDeploying ${selectedIds.length} stack(s) across ${waves.length} wave(s) → ${selectedStage}\n`,
);

for (const [i, wave] of waves.entries()) {
	if (waves.length > 1) {
		console.log(`── Wave ${i + 1}/${waves.length}: ${wave.join(', ')}`);
	}

	for (const id of wave) {
		console.log(`\n▶ ${id}`);

		// todo: if a stack fails because of a missing cross-stack value, we could provide a more helpful error message that tells the operator which stack they need to deploy first. This could be done by checking the stack's dependencies and seeing if any of them are in the selectedIds array. If not, we could print a message like "This stack depends on [stack name], which is not being deployed. Please deploy that stack first."
		execFileSync(
			'pnpm',
			[
				'exec',
				'cdk',
				'deploy',
				id,
				'--exclusively',
				'--context',
				`stage=${selectedStage}`,
				'--context',
				`stacks=${id}`,
			],
			{ stdio: 'inherit' },
		);
	}
}

console.log('\n✓ Done.');
