import { AttributeType, Billing, TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';
import {
	CrossStack,
	type CrossStackProps,
} from '../../constructs/cross-stack';
import { NodejsFunction } from '../../constructs/lambda';

/**
 * Producer stack. Owns a table and publishes its name and ARN as cross-stack
 * outputs so consumers can read and access it without any CloudFormation
 * coupling. The producer id is the stack's construct id (`ProducerStack`);
 * `export` derives it from the stack and only accepts outputs declared in the
 * stack's contract (`config/contracts.ts`).
 */
export class ProducerStack extends CrossStack<'ProducerStack'> {
	constructor(scope: Construct, props: CrossStackProps) {
		super(scope, props);

		const table = new TableV2(this, 'Table', {
			partitionKey: { name: 'id', type: AttributeType.STRING },
			billing: Billing.onDemand(),
		});

		new NodejsFunction(this, 'Test', {
			stage: props.stage,
			handler: 'stacks/producer/lambdas/test.ts',
			environment: { TABLE_NAME: table.tableName },
		});

		this.export('tableName', table.tableName);
		this.export('tableArn', table.tableArn);
	}
}
