import { execFileSync } from 'node:child_process';
import { resolveCdkSelection } from './cdk-selection';

const { stackIds, cdkArguments } = await resolveCdkSelection('synth');

execFileSync(
    'pnpm',
    [
        'exec',
        'cdk',
        'synth',
        ...stackIds,
        ...cdkArguments,
        '--context',
        `stacks=${stackIds.join(',')}`,
    ],
    { stdio: 'inherit' },
);