import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import {
	CrossStack,
	type CrossStackProps,
} from '../../constructs/cross-stack';
import { NodejsFunction } from '../../constructs/lambda';

/**
 * Consumer stack. Imports the Producer stack's table name and ARN at deploy
 * time and runs two lambdas against it – one batch put, one batch get – to
 * exercise the cross-stack contract.
 *
 * Coupling stays loose: the consumer only receives strings (name + ARN), never
 * the Producer's Table construct. IAM permissions are scoped to the imported
 * ARN, so there is no CloudFormation dependency on the Producer stack. If the
 * Producer's outputs do not exist yet, this stack's deployment fails on its
 * own – the Producer is never deployed automatically to satisfy it.
 */
export class ConsumerStack extends CrossStack {
	constructor(scope: Construct, props: CrossStackProps) {
		super(scope, props);

		const { stage } = props;

		const tableName = this.import('ProducerStack', 'tableName');
		const tableArn = this.import('ProducerStack', 'tableArn');

		const batchPut = new NodejsFunction(this, 'BatchPut', {
			stage,
			handler: 'stacks/consumer/lambdas/batch-put.ts',
			environment: { TABLE_NAME: tableName },
		});

		const batchGet = new NodejsFunction(this, 'BatchGet', {
			stage,
			handler: 'stacks/consumer/lambdas/batch-get.ts',
			environment: { TABLE_NAME: tableName },
		});

		// Scope permissions to the imported ARN – no reference to the Producer's
		// Table construct, so the stacks stay decoupled.
		batchPut.addToRolePolicy(
			new PolicyStatement({
				actions: ['dynamodb:BatchWriteItem'],
				resources: [tableArn],
			}),
		);

		batchGet.addToRolePolicy(
			new PolicyStatement({
				actions: ['dynamodb:BatchGetItem'],
				resources: [tableArn],
			}),
		);
	}
}
