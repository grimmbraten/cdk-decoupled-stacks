/**
 * Single source of truth for the stacks in this app.
 *
 * This file is intentionally free of any `aws-cdk-lib` imports so it can be
 * loaded cheaply by the change-detection script (`scripts/changed-stacks.ts`)
 * without paying the cost of importing the whole CDK library. Biome enforces
 * this: an `aws-cdk-lib` import here is a lint error (see `biome.json`).
 *
 * - `id` is the CDK construct id used by the CLI: `cdk deploy <id>`.
 * - `paths` are repo-root-relative prefixes owned exclusively by the stack.
 *   A path ending in `/` matches any file beneath it; otherwise it is an
 *   exact file match. A change to any of these paths deploys the stack.
 */

export interface StackDefinition<Id extends string = string> {
	readonly id: Id;
	readonly stackName: string;
	readonly description: string;
	/**
	 * Repo-root-relative files or directory prefixes owned by this stack.
	 *
	 * `scripts/changed-stacks.ts` selects the stack when a changed file matches
	 * one of these entries. Paths ending in `/` match everything below that
	 * directory; other paths require an exact match.
	 */
	readonly paths: readonly string[];
	/**
	 * Ids of stacks whose cross-stack outputs this stack consumes.
	 *
	 * This is a *CI deployment-ordering hint only* – it is NOT a CDK/CloudFormation
	 * dependency, so it never couples the stacks and never blocks destroying a
	 * producer. Ordering is applied solely among stacks that are part of the same
	 * deploy: if a dependency is not itself changing, it is NOT deployed, and this
	 * stack is left to fail if the producer's output does not yet exist.
	 */
	readonly dependsOn?: readonly NoInfer<Id>[];
}

/**
 * Registers the stacks and infers the set of valid ids from the `id` fields,
 * so `id` and `dependsOn` are constrained to real stack ids with no separate
 * list to keep in sync. `NoInfer` keeps `dependsOn` from widening the id union,
 * so a typo there is a compile error rather than a silently-accepted new id.
 */
const defineStacks = <const Ids extends string>(
	stacks: readonly StackDefinition<Ids>[],
): readonly StackDefinition<Ids>[] => stacks;

/**
 * Paths shared by every stack. A change to any of these is treated as a
 * change to ALL stacks, so everything is redeployed. Keep this list tight –
 * anything here is a "deploy the world" trigger.
 */
export const SHARED_PATHS = [
	'constructs/',
	'utils/',
	'types/',
	'config/',
	'bin/',
	'schemas/',
	'cdk.json',
	'package.json',
	'pnpm-lock.yaml',
	'tsconfig.json',
] as const;

export const STACKS = defineStacks([
	{
		id: 'ProducerStack',
		stackName: 'producer-stack',
		description: 'Producer stack that publishes cross-stack outputs',
		paths: ['stacks/producer/'],
	},
	{
		id: 'ConsumerStack',
		stackName: 'consumer-stack',
		description: 'Consumer stack that imports Producer outputs at deploy time',
		paths: ['stacks/consumer/'],
		dependsOn: ['ProducerStack'],
	},
]);

/** Union of every registered stack id, derived from `STACKS`. */
export type StackId = (typeof STACKS)[number]['id'];
