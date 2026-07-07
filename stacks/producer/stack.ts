import { AttributeType, Billing, TableV2 } from 'aws-cdk-lib/aws-dynamodb';
import type { Construct } from 'constructs';
import {
	CrossStackProducer,
	type CrossStackProducerProps,
} from '../../constructs/cross-stack';

/**
 * Producer stack. Owns a table and publishes its name and ARN as cross-stack
 * outputs so consumers can read and access it without any CloudFormation
 * coupling. The producer id is the stack's construct id (`ProducerStack`);
 * `publish` derives it from the stack and only accepts outputs declared in the
 * stack's contract (`config/contracts.ts`).
 */
export class ProducerStack extends CrossStackProducer<'ProducerStack'> {
	constructor(scope: Construct, props: CrossStackProducerProps) {
		// todo: maybe we want this cross stack producer functionality built in on all stacks (have a biome rule warns about usage of native cdk stacks and suggests using CrossStackProducer instead. The name would have to be revised since it's not sure that all stacks will actually produce something, but the idea is that all stacks should be able to publish outputs without having to remember to extend a special class)
		// todo: it would also be nice if the developer would not have to bother with passing the stack id to the CrossStackProducer type and the constructor, not sure if this is possible though, maybe with some type magic
		super(scope, 'ProducerStack', props);

		const table = new TableV2(this, 'Table', {
			partitionKey: { name: 'id', type: AttributeType.STRING },
			billing: Billing.onDemand(),
		});

		this.publish('tableName', table.tableName);
		this.publish('tableArn', table.tableArn);
	}
}
