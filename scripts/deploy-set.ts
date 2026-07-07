/**
 * Shared helpers for the deploy scripts (`changed-stacks.ts`,
 * `resolve-stacks.ts`). Keeps stack ordering and GitHub Actions output in one
 * place so the automatic and manual pipelines behave identically.
 */
import { appendFileSync } from 'node:fs';
import { STACKS, type StackDefinition } from '../config/stacks';

/**
 * Split a set of stack ids into dependency-ordered "waves". Every stack in a
 * wave can be deployed in parallel; each wave only runs once all earlier waves
 * have succeeded, so producers deploy before the consumers that read their
 * outputs.
 *
 * Only dependencies that are themselves part of the set are considered – an
 * unrelated producer is never pulled in.
 */
export const computeWaves = (ids: string[]): string[][] => {
	const inSet = new Set(ids);
	const definitionById = new Map<string, StackDefinition>(
		STACKS.map((stack) => [stack.id, stack]),
	);

	// Restrict each stack's dependencies to those also being deployed.
	const pending = new Map<string, Set<string>>(
		ids.map((id) => [
			id,
			new Set(
				(definitionById.get(id)?.dependsOn ?? []).filter((dep) =>
					inSet.has(dep),
				),
			),
		]),
	);

	const waves: string[][] = [];

	while (pending.size > 0) {
		const wave = [...pending.keys()]
			.filter((id) => (pending.get(id)?.size ?? 0) === 0)
			.sort();

		if (wave.length === 0) {
			throw new Error(
				`Cyclic cross-stack dependency detected among: ${[...pending.keys()].join(', ')}`,
			);
		}

		for (const id of wave) {
			pending.delete(id);
		}

		for (const remaining of pending.values()) {
			for (const id of wave) {
				remaining.delete(id);
			}
		}

		waves.push(wave);
	}

	return waves;
};

/**
 * Log the resolved waves and, when running in GitHub Actions, expose
 * `waves=<json>` and `count=<n>` for downstream jobs.
 */
export const emitWaves = (ids: string[]): void => {
	const waves = computeWaves(ids);

	console.error(`Stacks to deploy: ${JSON.stringify(ids)}`);
	console.error(
		`Deployment waves: ${waves.map((wave, i) => `\n  ${i + 1}. ${wave.join(', ')}`).join('') || ' (none)'}`,
	);

	// Machine-readable result on stdout.
	console.log(JSON.stringify(ids));

	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(
			process.env.GITHUB_OUTPUT,
			`waves=${JSON.stringify(waves)}\ncount=${ids.length}\n`,
		);
	}
};
