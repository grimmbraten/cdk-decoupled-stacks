import { Stack, type StackProps } from 'aws-cdk-lib';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { CONTRACTS } from '../config/contracts';
import type { Stage } from './app';

/**
 * Loosely-coupled cross-stack values via SSM Parameter Store.
 *
 * Why not `CfnOutput` + `Fn.importValue` / passing constructs between stacks?
 * Those create hard CloudFormation dependencies: the producer can't be
 * updated or destroyed while a consumer references its export, and the CLI
 * insists on deploying the producer first. That is exactly the tight coupling
 * we want to avoid.
 *
 * Instead a producer writes a plain SSM parameter and the consumer reads it
 * with a deploy-time SSM reference. There is no CloudFormation link between the
 * stacks – they can be deployed, updated and destroyed in any order. If a
 * consumer is deployed before the parameter exists, the deployment simply
 * fails (by design), rather than silently pulling in the producer.
 *
 * The producer identity is always a `StackId` that declares a contract in
 * `config/contracts.ts`, so a stack can never publish (or a consumer read)
 * under a producer/output that does not exist.
 */

type Contracts = typeof CONTRACTS;

/** Stack ids that publish cross-stack outputs. */
export type ProducerId = keyof Contracts;

/** Output names declared by a given producer's contract. */
export type OutputName<P extends ProducerId> = keyof Contracts[P] & string;

// todo: stage could be removed since parameter names are unique per stage
// todo: "cross-stack" should be renamed to "cross-stack-contract" to convey that this parameter has been created to satisfy a contract between stacks, not just for any random value. Could also be "cross-stack-contracts" (plural) to convey that this is a general mechanism for all contracts, not just one.
// todo: we should utilize the "description" property of the SSM parameter to describe what contract this parameter satisfies. This would help operators understand what this parameter is for when they see it in the console or CLI.
const parameterName = (
	stage: Stage,
	producer: string,
	segment: string,
): string => `/cross-stack/${stage}/${producer}/${segment}`;

export interface CrossStackProducerProps extends StackProps {
	stage: Stage;
}

/**
 * Base class for stacks that publish cross-stack outputs.
 *
 * The producer id is the stack's own construct id (`P`), which is constrained
 * to a `StackId` that declares a contract. `publish` therefore derives the
 * producer from the stack itself – it is never passed in – and only accepts
 * outputs from that producer's contract, so a stack can never publish under
 * the wrong producer or an unknown output.
 */
export abstract class CrossStackProducer<P extends ProducerId> extends Stack {
	protected readonly producer: P;
	private readonly stage: Stage;

	constructor(scope: Construct, id: P, props: CrossStackProducerProps) {
		super(scope, id, props);
		this.producer = id;
		this.stage = props.stage;
	}

	/** Publish a contract output for other stacks to import. */
	protected publish(output: OutputName<P>, value: string): StringParameter {
		const segment = CONTRACTS[this.producer][output] as string;

		return new StringParameter(
			this,
			`CrossStackOutput-${this.producer}-${output}`,
			{
				parameterName: parameterName(this.stage, this.producer, segment),
				stringValue: value,
			},
		);
	}
}

interface CrossStackImportProps<P extends ProducerId> {
	stage: Stage;
	/** Id of the producing stack (must declare a contract). */
	producer: P;
	/** Output name from that producer's contract. */
	output: OutputName<P>;
}

/**
 * Import a value published by another stack. Resolves at deploy time via an
 * SSM reference – no CloudFormation dependency is created. The returned token
 * can be used in resource properties (env vars, names, ...).
 *
 * If the parameter does not exist when this stack deploys, the CloudFormation
 * deployment fails with a "parameter not found" error – the producer is never
 * deployed automatically to satisfy it.
 */
export const importCrossStackValue = <P extends ProducerId>(
	scope: Construct,
	{ stage, producer, output }: CrossStackImportProps<P>,
): string => {
	const segment = CONTRACTS[producer][output] as string;

	return StringParameter.valueForStringParameter(
		scope,
		parameterName(stage, producer, segment),
	);
};
