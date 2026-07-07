import { checkbox, select } from '@inquirer/prompts';
import { STACKS, type StackId } from '../config/stacks';
import { stage as stages } from '../constructs/app';
import { runPrompt } from './prompt';

export interface CdkSelection {
    readonly stackIds: StackId[];
    readonly stage: string;
    readonly cdkArguments: string[];
}

const contextValue = (argument: string): string | undefined => {
    const equalsIndex = argument.indexOf('=');
    return equalsIndex === -1 ? undefined : argument.slice(equalsIndex + 1);
};

const contextEntries = (arguments_: readonly string[]): string[] => {
    const entries: string[] = [];
    for (const [index, argument] of arguments_.entries()) {
        if (argument === '-c' || argument === '--context') {
            const value = arguments_[index + 1];
            if (value) {
                entries.push(value);
            }
            continue;
        }
        if (argument.startsWith('-c=') || argument.startsWith('--context=')) {
            const value = contextValue(argument);
            if (value) {
                entries.push(value);
            }
        }
    }
    return entries;
};

export const resolveCdkSelection = async (
    operation: 'deploy' | 'synth',
): Promise<CdkSelection> => {
    const arguments_ = process.argv.slice(2).filter((argument) => argument !== '--');
    const knownIds = new Set<StackId>(STACKS.map((stack) => stack.id));
    const requestedIds = arguments_.filter((argument): argument is StackId =>
        knownIds.has(argument as StackId),
    );
    const buildAll = arguments_.some(
        (argument) => argument === '--all' || argument === '-a',
    );

    if (buildAll && requestedIds.length > 0) {
        throw new Error('Do not combine explicit stack ids with --all or -a.');
    }

    const stackIds = buildAll
        ? STACKS.map((stack) => stack.id)
        : requestedIds.length > 0
            ? STACKS.map((stack) => stack.id).filter((id) => requestedIds.includes(id))
            : await runPrompt(() =>
                checkbox({
                    message: `Select stacks to ${operation}:`,
                    choices: STACKS.map((stack) => ({
                        value: stack.id,
                        name: stack.id,
                        description: stack.description,
                    })),
                    validate: (selected) =>
                        selected.length > 0 ? true : 'Select at least one stack.',
                }),
            );

    const cdkArguments = arguments_.filter(
        (argument) =>
            argument !== '--all' &&
            argument !== '-a' &&
            !knownIds.has(argument as StackId),
    );
    const contexts = contextEntries(cdkArguments);
    if (contexts.some((entry) => entry.startsWith('stacks='))) {
        throw new Error('Provide stacks as positional ids, not with -c stacks=...');
    }

    const suppliedStage = contexts
        .filter((entry) => entry.startsWith('stage='))
        .at(-1)
        ?.slice('stage='.length);
    const stage = suppliedStage ||
        (await runPrompt(() =>
            select({
                message: `${operation === 'deploy' ? 'Deploy' : 'Synthesize'} for which stage?`,
                choices: Object.values(stages).map((value) => ({ value })),
            }),
        ));
    if (!suppliedStage) {
        cdkArguments.push('--context', `stage=${stage}`);
    }

    return { stackIds, stage, cdkArguments };
};