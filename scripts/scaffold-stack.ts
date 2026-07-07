import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { STACKS } from '../config/stacks';

const usage = `Usage: pnpm scaffold:stack <lowercase-stack-folder> [description] [options]

Options:
	--contract, -c <name=type>       Add an output contract (string, number, boolean)
	--depends-on, -d <stack-id>      Add a deployment-order dependency

Repeat an option or provide comma-separated values to add more than one.`;
const arguments_ = process.argv.slice(2);
const folderName = arguments_.shift();

if (!folderName || arguments_.includes('--help') || folderName === '--help') {
	console.log(usage);
	process.exit(folderName ? 0 : 1);
}

if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(folderName)) {
	throw new Error(`Invalid stack folder name "${folderName}". Use lowercase kebab-case.`);
}

const descriptionParts: string[] = [];
const contracts = new Map<string, 'string' | 'number' | 'boolean'>();
const dependencyIds = new Set<string>();

for (let index = 0; index < arguments_.length; index += 1) {
	const argument = arguments_[index];
	if (argument !== '--contract' && argument !== '-c' && argument !== '--depends-on' && argument !== '-d') {
		if (argument.startsWith('-')) {
			throw new Error(`Unknown option "${argument}".\n\n${usage}`);
		}
		descriptionParts.push(argument);
		continue;
	}

	const value = arguments_[index + 1];
	if (!value || value.startsWith('-')) {
		throw new Error(`Option "${argument}" requires a value.`);
	}
	index += 1;

	for (const entry of value.split(',').filter(Boolean)) {
		if (argument === '--depends-on' || argument === '-d') {
			dependencyIds.add(entry);
			continue;
		}

		const [name, type, ...extra] = entry.split('=');
		if (
			!name ||
			!type ||
			extra.length > 0 ||
			!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ||
			!['string', 'number', 'boolean'].includes(type)
		) {
			throw new Error(
				`Invalid contract "${entry}". Use <name>=string|number|boolean.`,
			);
		}
		if (contracts.has(name)) {
			throw new Error(`Duplicate contract output: ${name}`);
		}
		contracts.set(name, type as 'string' | 'number' | 'boolean');
	}
}

const className = `${folderName
	.split('-')
	.map((part) => part[0].toUpperCase() + part.slice(1))
	.join('')}Stack`;
const stackDescription = descriptionParts.join(' ').trim() ||
	`${folderName
		.split('-')
		.map((part) => part[0].toUpperCase() + part.slice(1))
		.join(' ')} stack`;
const quotedDescription = stackDescription
	.replaceAll('\\', '\\\\')
	.replaceAll("'", "\\'")
	.replace(/[\r\n]/g, ' ');
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stackDirectory = resolve(repoRoot, 'stacks', folderName);
const stackFile = resolve(stackDirectory, 'stack.ts');
const registryFile = resolve(repoRoot, 'config/stacks.ts');
const contractsFile = resolve(repoRoot, 'config/contracts.ts');
const appFile = resolve(repoRoot, 'bin/app.ts');

if (existsSync(stackDirectory)) {
	throw new Error(`Stack directory already exists: stacks/${folderName}/`);
}

const knownStackIds = new Set<string>(STACKS.map((stack) => stack.id));
for (const dependencyId of dependencyIds) {
	if (!knownStackIds.has(dependencyId)) {
		throw new Error(
			`Unknown dependency "${dependencyId}". Known stacks: ${[...knownStackIds].join(', ')}.`,
		);
	}
	if (dependencyId === className) {
		throw new Error('A stack cannot depend on itself.');
	}
}

const parseSource = (filePath: string): ts.SourceFile => {
	const text = readFileSync(filePath, 'utf8');
	assertValidTypeScript(filePath, text);
	const source = ts.createSourceFile(
		filePath,
		text,
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TS,
	);

	return source;
};

const assertValidTypeScript = (filePath: string, text: string): void => {
	const diagnostics = ts.transpileModule(text, {
		fileName: filePath,
		reportDiagnostics: true,
		compilerOptions: { target: ts.ScriptTarget.Latest },
	}).diagnostics;
	if (diagnostics?.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
		throw new Error(`Cannot scaffold into invalid TypeScript: ${filePath}`);
	}
};

const findVariable = (
	source: ts.SourceFile,
	name: string,
): ts.VariableDeclaration => {
	for (const statement of source.statements) {
		if (!ts.isVariableStatement(statement)) {
			continue;
		}

		const declaration = statement.declarationList.declarations.find(
			(candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name,
		);
		if (declaration) {
			return declaration;
		}
	}

	throw new Error(`Could not find ${name} in ${source.fileName}`);
};

const propertyName = (property: ts.ObjectLiteralElementLike): string | undefined =>
	property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
		? property.name.text
		: undefined;

const stringProperty = (
	object: ts.ObjectLiteralExpression,
	name: string,
): string | undefined => {
	const property = object.properties.find(
		(candidate) =>
			ts.isPropertyAssignment(candidate) && propertyName(candidate) === name,
	);
	return property &&
		ts.isPropertyAssignment(property) &&
		ts.isStringLiteral(property.initializer)
		? property.initializer.text
		: undefined;
};

const unwrapExpression = (expression: ts.Expression): ts.Expression => {
	let current = expression;
	while (
		ts.isAsExpression(current) ||
		ts.isSatisfiesExpression(current) ||
		ts.isParenthesizedExpression(current)
	) {
		current = current.expression;
	}
	return current;
};

const appendElement = (
	text: string,
	source: ts.SourceFile,
	container: ts.ArrayLiteralExpression | ts.ObjectLiteralExpression,
	elementText: (indent: string) => string,
): string => {
	const elements = ts.isArrayLiteralExpression(container)
		? container.elements
		: container.properties;
	const closingPosition = container.end - 1;
	if (text[closingPosition] !== (ts.isArrayLiteralExpression(container) ? ']' : '}')) {
		throw new Error(`Could not locate closing delimiter in ${source.fileName}`);
	}

	let updated = text;
	if (elements.length > 0) {
		const lastElement = elements[elements.length - 1];
		const separator = updated.slice(lastElement.end, closingPosition);
		if (!/^\s*,/.test(separator)) {
			updated = `${updated.slice(0, lastElement.end)},${updated.slice(lastElement.end)}`;
		}
	}

	const adjustedClosingPosition = container.end - 1 + (updated.length - text.length);
	const lineStart = updated.lastIndexOf('\n', adjustedClosingPosition - 1) + 1;
	const closingIndent = updated.slice(lineStart, adjustedClosingPosition);
	if (!/^\t*$/.test(closingIndent)) {
		throw new Error(`Expected a multiline, tab-indented list in ${source.fileName}`);
	}

	const firstElement = elements[0];
	const firstLineStart = firstElement
		? updated.lastIndexOf('\n', firstElement.getStart(source) - 1) + 1
		: lineStart;
	const elementIndent = firstElement
		? updated.slice(firstLineStart, firstElement.getStart(source))
		: `${closingIndent}\t`;

	return `${updated.slice(0, lineStart)}${elementText(elementIndent)}${updated.slice(lineStart)}`;
};

const registryText = readFileSync(registryFile, 'utf8');
const registrySource = parseSource(registryFile);
const registryDeclaration = findVariable(registrySource, 'STACKS');
const registryInitializer = registryDeclaration.initializer;
if (
	!registryInitializer ||
	!ts.isCallExpression(registryInitializer) ||
	!ts.isArrayLiteralExpression(registryInitializer.arguments[0])
) {
	throw new Error('Expected STACKS to be defined with defineStacks([...])');
}

const stacksArray = registryInitializer.arguments[0];
for (const entry of stacksArray.elements) {
	if (ts.isObjectLiteralExpression(entry)) {
		const registeredId = stringProperty(entry, 'id');
		if (registeredId === className) {
			throw new Error(`Stack id is already registered: ${className}`);
		}
	}
}

const newRegistryText = appendElement(
	registryText,
	registrySource,
	stacksArray,
	(indent) =>
		`${indent}{\n${indent}\tid: '${className}',\n${indent}\tstackName: '${folderName}-stack',\n${indent}\tdescription: '${quotedDescription}',\n${indent}\tpaths: ['stacks/${folderName}/'],\n${
			dependencyIds.size > 0
				? `${indent}\tdependsOn: [${[...dependencyIds].map((id) => `'${id}'`).join(', ')}],\n`
				: ''
		}${indent}},\n`,
);

const contractsText = readFileSync(contractsFile, 'utf8');
const contractsSource = parseSource(contractsFile);
const contractsDeclaration = findVariable(contractsSource, 'CONTRACTS');
const contractsInitializer = contractsDeclaration.initializer &&
	unwrapExpression(contractsDeclaration.initializer);
if (!contractsInitializer || !ts.isObjectLiteralExpression(contractsInitializer)) {
	throw new Error('Expected CONTRACTS to be an object literal');
}
if (contractsInitializer.properties.some((property) => propertyName(property) === className)) {
	throw new Error(`Contract is already registered: ${className}`);
}

const newContractsText = contracts.size > 0
	? appendElement(
			contractsText,
			contractsSource,
			contractsInitializer,
			(indent) =>
				`${indent}${className}: {\n${[...contracts]
					.map(([name, type]) => `${indent}\t${name}: '${type}',\n`)
					.join('')}${indent}},\n`,
		)
	: contractsText;

const appText = readFileSync(appFile, 'utf8');
const appSource = parseSource(appFile);
const importPath = `../stacks/${folderName}/stack`;
if (
	appSource.statements.some(
		(statement) =>
			ts.isImportDeclaration(statement) &&
			ts.isStringLiteral(statement.moduleSpecifier) &&
			statement.moduleSpecifier.text === importPath,
	)
) {
	throw new Error(`Stack import already exists: ${importPath}`);
}

const classMapDeclaration = findVariable(appSource, 'STACK_CLASSES');
const classMap = classMapDeclaration.initializer;
if (!classMap || !ts.isObjectLiteralExpression(classMap)) {
	throw new Error('Expected STACK_CLASSES to be an object literal');
}
if (classMap.properties.some((property) => propertyName(property) === className)) {
	throw new Error(`Stack class is already mapped: ${className}`);
}

let newAppText = appendElement(
	appText,
	appSource,
	classMap,
	(indent) => `${indent}${className},\n`,
);

const classImport = `import { ${className} } from '${importPath}';`;
const lastImport = [...appSource.statements]
	.reverse()
	.find(ts.isImportDeclaration);
if (!lastImport) {
	throw new Error(`Could not find imports in ${appFile}`);
}
newAppText = `${newAppText.slice(0, lastImport.end)}\n${classImport}${newAppText.slice(lastImport.end)}`;

const stackSource = `import type { Construct } from 'constructs';
import { CrossStack, type CrossStackProps } from '../../constructs/cross-stack';

export class ${className} extends CrossStack${contracts.size > 0 ? `<'${className}'>` : ''} {
	constructor(scope: Construct, props: CrossStackProps) {
		super(scope, props);
	}
}
`;

const validateUpdatedSource = (filePath: string, text: string): void => {
	assertValidTypeScript(filePath, text);
};

validateUpdatedSource(registryFile, newRegistryText);
validateUpdatedSource(contractsFile, newContractsText);
validateUpdatedSource(appFile, newAppText);

mkdirSync(stackDirectory);
writeFileSync(stackFile, stackSource, { flag: 'wx' });
writeFileSync(registryFile, newRegistryText);
if (contracts.size > 0) {
	writeFileSync(contractsFile, newContractsText);
}
writeFileSync(appFile, newAppText);

console.log(`Created stack ${className}: stacks/${folderName}/`);
console.log('Next: add resources, optional stack-local code, and any output contract.');