import { Stack, type StackProps } from 'aws-cdk-lib';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import type { CONTRACTS } from '../config/contracts';
import { convertToPascalCase } from '../utils/string';
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

/** A stack id's contract, or `never` if it doesn't declare one (not a producer). */
type ContractFor<Id extends string> = Id extends ProducerId
	? Contracts[Id]
	: never;

/** Output names declared by a given producer's contract. */
export type OutputName<Id extends string> = keyof ContractFor<Id> & string;

/** JS value matching a contract output's declared `ContractType`. */
type ValueForType<T> = T extends 'number'
	? number
	: T extends 'boolean'
	? boolean
	: string;

const parameterName = (
	producer: string,
	segment: string,
): string => `/cross-stack-contracts/${producer}/${segment}`;

export interface CrossStackProps extends StackProps {
	stage: Stage;
}

/**
 * A regular CDK stack with cross-stack `export`/`import` helpers layered on
 * top. A stack can be a producer, a consumer, or both at once – there is no
 * need for separate producer/consumer base classes.
 *
 * `import` works out of the box, since it only needs the *other* stack's id.
 * `export` is different: it needs to know *this* stack's own id at compile
 * time, to look up its contract in `config/contracts.ts` and type-check the
 * output name/value against it. Generics are erased at runtime, so that link
 * can't be inferred from the class automatically – a producer must restate
 * its own id as the generic, matching its class name exactly:
 *
 * ```ts
 * class ProducerStack extends CrossStack<'ProducerStack'> { ... }
 * ```
 *
 * A stack that only imports (no contract of its own) can omit the generic
 * and just `extends CrossStack`; `export` will then be unusable, since no
 * output name would type-check against it.
 *
 * The construct id itself is always the class name (via `new.target`), so
 * – unlike the generic – it never needs to be typed out again at the call
 * site.
 */
export abstract class CrossStack<Id extends string = string> extends Stack {
	private readonly stage: Stage;

	constructor(scope: Construct, props: CrossStackProps) {
		super(scope, new.target.name, props);
		this.stage = props.stage;
	}

	/** Publish a contract output for other stacks to import. */
	protected export<K extends OutputName<Id>>(
		output: K,
		value: ValueForType<ContractFor<Id>[K]>,
	): StringParameter {
		const segment = convertToPascalCase(output);

		return new StringParameter(
			this,
			`CrossStackOutput-${this.node.id}-${output}`,
			{
				description: `Cross-stack contract ${this.node.id}.${output} for stage ${this.stage}`,
				parameterName: parameterName(this.node.id, segment),
				stringValue: String(value),
			},
		);
	}

	/** Import a value published by another stack. */
	protected import<P extends ProducerId>(
		producer: P,
		output: OutputName<P>,
	): string {
		const segment = convertToPascalCase(output);

		return StringParameter.valueForStringParameter(
			this,
			parameterName(producer, segment),
		);
	}
}
