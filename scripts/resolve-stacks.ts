/**
 * Resolves an explicit, user-supplied list of stack ids for the manual deploy
 * workflow, validates them against the registry, and emits dependency-ordered
 * waves for GitHub Actions.
 *
 * Inputs (env):
 *   STACKS – space/comma-separated stack ids, or "all" for every stack.
 *
 * Outputs:
 *   stdout          – JSON array of stack ids.
 *   $GITHUB_OUTPUT  – `waves=<json>` and `count=<n>` for downstream jobs.
 */
import { STACKS } from '../config/stacks';
import { emitWaves } from './deploy-set';

const requested = (process.env.STACKS ?? '')
	.split(/[\s,]+/)
	.map((id) => id.trim())
	.filter(Boolean);

if (requested.length === 0) {
	throw new Error('No stacks provided. Pass stack ids or "all".');
}

const knownIds: string[] = STACKS.map((stack) => stack.id);

const resolved = requested.some((id) => id.toLowerCase() === 'all')
	? knownIds
	: requested;

const unknown = resolved.filter((id) => !knownIds.includes(id));

if (unknown.length > 0) {
	throw new Error(
		`Unknown stack id(s): ${unknown.join(', ')}. Known stacks: ${knownIds.join(', ')}.`,
	);
}

// De-duplicate while preserving the registry's order.
const ids = knownIds.filter((id) => resolved.includes(id));

emitWaves(ids);
