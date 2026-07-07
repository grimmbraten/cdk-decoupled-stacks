import type { Stack } from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { STACKS, type StackId } from '../config/stacks';
import { App } from '../constructs/app';
import type { CrossStackProps } from '../constructs/cross-stack';
import { ConsumerStack } from '../stacks/consumer/stack';
import { ProducerStack } from '../stacks/producer/stack';

const app = new App();

const env = {
	region: 'eu-north-1',
	account: process.env.CDK_DEFAULT_ACCOUNT,
};

type StackClass = new (scope: Construct, props: CrossStackProps) => Stack;

// Maps each stack id to its class. Typed as Record<StackId, ...> so omitting
// a stack id here, after adding it to STACKS, is a compile error.
const STACK_CLASSES: Record<StackId, StackClass> = {
	ProducerStack,
	ConsumerStack,
};

// `-c stacks=Id1,Id2` limits which stacks are instantiated, so synth only
// builds what's requested instead of the whole app. Required (not optional)
// so an accidental full synth/deploy is never silent — pass `-c stacks=all`
// to explicitly build every stack (see the `build` script in package.json).
const requested = app.node.tryGetContext('stacks');
if (typeof requested !== 'string' || requested.trim() === '') {
	throw new Error(
		'No stacks specified. Use -c stacks=Id1,Id2 to synth/deploy specific stacks, or -c stacks=all for every stack.',
	);
}

const only =
	requested.trim() === 'all'
		? undefined
		: new Set(
			requested
				.split(/[\s,]+/)
				.map((id) => id.trim())
				.filter(Boolean),
		);

for (const { id, stackName, description } of STACKS) {
	if (only && !only.has(id)) {
		continue;
	}

	const StackClass = STACK_CLASSES[id];

	new StackClass(app, { env, stage: app.stage, stackName, description });
}
