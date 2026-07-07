/**
 * Shared helpers for the deploy scripts (`changed-stacks.ts`,
 * `resolve-stacks.ts`). Keeps stack ordering and GitHub Actions output in one
 * place so the automatic and manual pipelines behave identically.
 */
import { appendFileSync } from 'node:fs';
import { STACKS, type StackDefinition } from '../config/stacks';

/**
 * Split stack ids into dependency-ordered groups. Stacks in a group are
 * independent and can be deployed in parallel; each group follows its
 * dependencies so producers run before consumers that read their outputs.
 *
 * Only dependencies that are themselves part of the set are considered – an
 * unrelated producer is never pulled in.
 */
export const computeGroups = (ids: string[]): string[][] => {
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

	const groups: string[][] = [];

	while (pending.size > 0) {
		const group = [...pending.keys()]
			.filter((id) => (pending.get(id)?.size ?? 0) === 0)
			.sort();

		if (group.length === 0) {
			throw new Error(
				`Cyclic cross-stack dependency detected among: ${[...pending.keys()].join(', ')}`,
			);
		}

		for (const id of group) {
			pending.delete(id);
		}

		for (const remaining of pending.values()) {
			for (const id of group) {
				remaining.delete(id);
			}
		}

		groups.push(group);
	}

	return groups;
};

/**
 * Log the resolved groups and, when running in GitHub Actions, expose
 * `stacks=<json>`, `groups=<json>`, and `count=<n>` for downstream jobs.
 */
export const emitGroups = (ids: string[]): void => {
	const groups = computeGroups(ids);

	console.error(`📋 Selected ${ids.length} stack(s): ${ids.join(', ') || '(none)'}`);
	console.error(`🧩 Dependency groups (${groups.length}):`);
	for (const [index, group] of groups.entries()) {
		console.error(`  ${index + 1}. ${group.join(', ')}`);
	}
	// Machine-readable result on stdout.
	console.log(JSON.stringify(ids));

	if (process.env.GITHUB_OUTPUT) {
		appendFileSync(
			process.env.GITHUB_OUTPUT,
			`stacks=${JSON.stringify(ids)}\ngroups=${JSON.stringify(groups)}\ncount=${ids.length}\n`,
		);
	}
};
