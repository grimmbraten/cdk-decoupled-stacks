import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
	BatchWriteCommand,
	DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Name of the Producer stack's table, imported cross-stack at deploy time.
const TABLE_NAME = process.env.TABLE_NAME;

/**
 * Writes a small batch of items to the Producer stack's table, proving the
 * consumer can use a value shared purely through the cross-stack contract.
 */
export const handler = async () => {
	if (!TABLE_NAME) {
		throw new Error('TABLE_NAME environment variable is not set');
	}

	const items = [
		{ id: 'item-1', value: 'alpha' },
		{ id: 'item-2', value: 'beta' },
	];

	await client.send(
		new BatchWriteCommand({
			RequestItems: {
				[TABLE_NAME]: items.map((Item) => ({ PutRequest: { Item } })),
			},
		}),
	);

	return { written: items.length };
};
