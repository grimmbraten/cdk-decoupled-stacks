export const runPrompt = async <Result>(
    prompt: () => Promise<Result>,
): Promise<Result> => {
    try {
        return await prompt();
    } catch (error) {
        if (error instanceof Error && error.name === 'ExitPromptError') {
            console.log('\nCancelled.');
            process.exit(0);
        }
        throw error;
    }
};