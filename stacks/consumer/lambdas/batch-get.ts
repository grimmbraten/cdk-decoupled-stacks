import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchGetCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// Name of the Producer stack's table, imported cross-stack at deploy time.
const TABLE_NAME = process.env.TABLE_NAME;

/**
 * Reads a small batch of items from the Producer stack's table, proving the
 * consumer can use a value shared purely through the cross-stack contract.
 */
export const handler = async () => {
	if (!TABLE_NAME) {
		throw new Error('TABLE_NAME environment variable is not set');
	}

	const keys = [{ id: 'item-1' }, { id: 'item-2' }];

	const result = await client.send(
		new BatchGetCommand({
			RequestItems: {
				[TABLE_NAME]: { Keys: keys },
			},
		}),
	);

	return { items: result.Responses?.[TABLE_NAME] ?? [] };
};
