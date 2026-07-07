import type { StackId } from './stacks';

/**
 * Explicit cross-stack contracts, keyed by the *producing stack's id*.
 *
 * A contract is the agreed name of a value one stack publishes and another
 * consumes. Because the key is a `StackId`, a contract can only exist for a
 * real registered stack, and the producer identity is never a free-form
 * string. The value of each output is the segment used in the SSM parameter
 * path (`/cross-stack/<stage>/<producer>/<segment>`).
 *
 * Keeping the names here (a shared path) rather than importing them across
 * stack files means producers and consumers share one type-checked source of
 * truth, with no CloudFormation coupling.
 */
export const CONTRACTS = {
	ProducerStack: {
		/** DynamoDB table name, used by consumers as the SDK target. */
		tableName: 'TableName',
		/** DynamoDB table ARN, used by consumers to scope IAM permissions. */
		tableArn: 'TableArn',
	},
} as const satisfies Partial<Record<StackId, Readonly<Record<string, string>>>>;
