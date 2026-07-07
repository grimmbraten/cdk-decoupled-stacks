import { STACKS, type StackDefinition } from '../config/stacks';
import { App } from '../constructs/app';
import { ConsumerStack } from '../stacks/consumer/stack';
import { ProducerStack } from '../stacks/producer/stack';

const app = new App();

const env = {
	region: 'eu-north-1',
	account: process.env.CDK_DEFAULT_ACCOUNT,
};

// Maps each registered stack id to how it is instantiated. The registry
// (`config/stacks.ts`) stays free of CDK imports; the wiring lives here.
type StackFactory = (app: App, definition: StackDefinition) => void;

const factories: Record<string, StackFactory> = {
	// Producer stacks derive their id from the class, so it is not passed here.
	ProducerStack: (scope, { stackName, description }) =>
		new ProducerStack(scope, {
			env,
			stage: scope.stage,
			stackName,
			description,
		}),
	ConsumerStack: (scope, { id, stackName, description }) =>
		new ConsumerStack(scope, id, {
			env,
			stage: scope.stage,
			stackName,
			description,
		}),
};

// todo: -c stacks should NOT be optional since it's needed to avoid unnecessary stack synths and/or deploys. If no stacks are specified, the app should error and exit with a message like "No stacks specified. Use -c stacks=Id1,Id2 to specify which stacks to synth/deploy."
// Optional `-c stacks=Id1,Id2` limits which stacks are instantiated, so synth
// only builds what's requested instead of the whole app. Absent → build all.
const requested = app.node.tryGetContext('stacks');
const only =
	typeof requested === 'string' && requested.trim() !== ''
		? new Set(
				requested
					.split(/[\s,]+/)
					.map((id) => id.trim())
					.filter(Boolean),
			)
		: undefined;

for (const definition of STACKS) {
	if (only && !only.has(definition.id)) {
		continue;
	}

	const factory = factories[definition.id];

	if (!factory) {
		throw new Error(`No factory registered for stack "${definition.id}".`);
	}

	factory(app, definition);
}
