import type { StackId } from './stacks';

/** JS value kinds a contract output can carry; `export()`/`import()` are typed off this. */
export type ContractType = 'string' | 'number' | 'boolean';

/**
 * Explicit cross-stack contracts, keyed by the *producing stack's id*.
 *
 * A contract is the agreed name of a value one stack publishes and another
 * consumes. Because the key is a `StackId`, a contract can only exist for a
 * real registered stack, and the producer identity is never a free-form
 * string. The key also doubles as the SSM parameter segment (PascalCased) at
 * `/cross-stack-contracts/<producer>/<segment>`, so it never needs repeating.
 * The value declares the type of the published value.
 *
 * Keeping the names here (a shared path) rather than importing them across
 * stack files means producers and consumers share one type-checked source of
 * truth, with no CloudFormation coupling.
 */
export const CONTRACTS = {
	ProducerStack: {
		/** DynamoDB table name, used by consumers as the SDK target. */
		tableName: 'string',
		/** DynamoDB table ARN, used by consumers to scope IAM permissions. */
		tableArn: 'string',
	},
} as const satisfies Partial<
	Record<StackId, Readonly<Record<string, ContractType>>>
>;
