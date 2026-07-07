import { relative } from 'node:path';
import { customBuildTargets, repoRoot } from './build-targets';

const configuredTargets = new Set(process.argv.slice(2));
const missingTargets = customBuildTargets.filter(
    (target) => !configuredTargets.has(target.name),
);

for (const target of missingTargets) {
    const scriptPath = relative(repoRoot, target.scriptPath);
    console.warn(
        `::warning file=${scriptPath}::Custom build target ${target.name} is not configured in .github/actions/build/action.yml.`,
    );
}

if (missingTargets.length === 0) {
    console.log('All custom build hooks are configured in the composite action.');
}