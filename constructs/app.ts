import { type AppProps, App as CDKApp } from 'aws-cdk-lib';

export const stage = {
	playground: 'playground',
} as const;

export type Stage = keyof typeof stage;

export class App extends CDKApp {
	public readonly stage: Stage;

	constructor(props?: AppProps) {
		super(props);

		this.stage = assertStage(this.node.tryGetContext('stage'));
	}
}

const assertStage = (contextValue?: unknown): Stage => {
	if (!contextValue || !Object.values(stage).includes(contextValue as Stage)) {
		throw new Error(
			`Invalid stage context value: ${contextValue}. Valid values are: ${Object.values(stage).join(', ')}`,
		);
	}

	return contextValue as Stage;
};
