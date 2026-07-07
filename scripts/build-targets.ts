import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STACKS } from '../config/stacks';

export interface BuildTarget {
    readonly name: string;
    readonly scriptPath: string;
}

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const excludedRootDirectories = new Set([
    'stacks',
    'scripts',
    'node_modules',
    'cdk.out',
]);

export const sourceAreas: BuildTarget[] = readdirSync(repoRoot, {
    withFileTypes: true,
})
    .filter(
        (entry) =>
            entry.isDirectory() &&
            !entry.name.startsWith('.') &&
            !excludedRootDirectories.has(entry.name),
    )
    .map((entry) => ({
        name: entry.name,
        scriptPath: resolve(repoRoot, entry.name, 'scripts/build.ts'),
    }))
    .filter((area) => existsSync(area.scriptPath))
    .sort((a, b) => a.name.localeCompare(b.name));

export const stackBuildTargets: BuildTarget[] = STACKS.flatMap((stack) => {
    const stackPath = stack.paths.find((path) => /^stacks\/[^/]+\/$/.test(path));
    if (!stackPath) {
        return [];
    }

    const scriptPath = resolve(repoRoot, stackPath, 'scripts/build.ts');
    return existsSync(scriptPath) ? [{ name: stack.id, scriptPath }] : [];
});

export const customBuildTargets = [...sourceAreas, ...stackBuildTargets];