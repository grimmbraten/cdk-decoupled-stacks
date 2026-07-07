export const convertToKebabCase = (str: string): string =>
	str
		.replace(/([a-z0-9])([A-Z])|[^a-zA-Z0-9]+/g, (_, a, b) =>
			a ? `${a}-${b}` : '-',
		)
		.replace(/^-+|-+$/g, '')
		.toLowerCase();

export const convertToPascalCase = (str: string): string =>
	str.replace(/(^|[^a-zA-Z0-9]+)([a-zA-Z0-9])/g, (_, __, c) => c.toUpperCase());
