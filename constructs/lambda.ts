import { RemovalPolicy } from 'aws-cdk-lib';
import { Architecture, LoggingFormat, Runtime } from 'aws-cdk-lib/aws-lambda';
import {
	NodejsFunction as CDKNodejsFunction,
	type NodejsFunctionProps as CDKNodejsFunctionProps,
	OutputFormat,
} from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import type { Stage } from './app';

interface NodejsFunctionProps extends Omit<CDKNodejsFunctionProps, 'entry'> {
	stage: Stage;
	/**
	 * Path to the handler file, relative to the repo root. Colocate handlers
	 * with the stack that owns them (e.g. `stacks/<name>/lambdas/create.ts`) so
	 * changes are attributed to that stack by the deploy pipeline.
	 */
	handler: `${string}.ts`;
}

export class NodejsFunction extends CDKNodejsFunction {
	constructor(
		scope: Construct,
		id: string,
		{ bundling, handler, ...props }: NodejsFunctionProps,
	) {
		super(scope, id, {
			memorySize: 512,
			runtime: Runtime.NODEJS_24_X,
			architecture: Architecture.ARM_64,
			bundling: {
				format: OutputFormat.ESM,
				minify: false,
				sourceMap: false,
				...bundling,
			},
			entry: handler,
			loggingFormat: LoggingFormat.JSON,
			logGroup: new LogGroup(scope, `${id}LogGroup`, {
				logGroupName: `/aws/lambda/${props.functionName || id}`,
				retention: RetentionDays.TWO_WEEKS,
				removalPolicy: RemovalPolicy.DESTROY,
			}),
			...props,
		});
	}
}
