# cdk-decoupled-stacks

A multi-stack AWS CDK app with independent deployments and typed cross-stack
values. Stacks share values through SSM Parameter Store, so consumers do not
create CloudFormation dependencies on producers.

## Prerequisites

- Node.js 24 LTS or newer
- pnpm 12.8.1, through Corepack or installed directly
- AWS credentials for deployment
- A bootstrapped CDK environment for each target account and region

```bash
pnpm install
pnpm exec cdk bootstrap --context stage=playground --context stacks=all
```

## Common commands

| Task | Command |
| --- | --- |
| Build interactively | `pnpm build` |
| Build selected targets | `pnpm build schemas ProducerStack` |
| Build everything | Full: `pnpm build --all`; short: `pnpm build -a` |
| Synthesize interactively | `pnpm cdk:synth` |
| Synthesize selected stacks | Full: `pnpm cdk:synth ProducerStack --context stage=playground`; short: `pnpm cdk:synth ProducerStack -c stage=playground` |
| Deploy interactively | `pnpm cdk:deploy` |
| Deploy selected stacks | Full: `pnpm cdk:deploy ProducerStack ConsumerStack --context stage=playground`; short: `pnpm cdk:deploy ProducerStack ConsumerStack -c stage=playground` |
| Deploy every stack | Full: `pnpm cdk:deploy --all --context stage=playground`; short: `pnpm cdk:deploy -a -c stage=playground` |
| Lint | `pnpm lint` |
| Type-check | `pnpm ts-check` |
| Test all stacks | `pnpm test` |
| Test selected stacks | `pnpm test ProducerStack ConsumerStack` |

Stack IDs and CDK options can appear in any order. With no stack IDs, synth and
deploy open a picker. Use `--all` or `-a` to select every stack. Local deploy
also asks whether to run stack build hooks first and defaults to building them.

Build and synthesis are separate. Run the relevant build hook before synth when
a stack imports generated artifacts.

## Project layout

```text
bin/app.ts                 # CDK entry point and stack class registration
config/
  stacks.ts                # Stack IDs, owned paths, and deployment ordering
  contracts.ts             # Typed cross-stack value contracts
constructs/                # Shared CDK constructs
scripts/                   # Build, synth, deploy, and change-detection tooling
stacks/<stack>/
  stack.ts                 # Stack entry point
  lambdas/                 # Stack-owned Lambda handlers
  scripts/build.ts         # Optional custom build hook
  generated/               # Optional generated artifacts
<source-area>/
  scripts/build.ts         # Optional shared source-area build hook
  generated/               # Optional generated artifacts
.github/actions/build/     # Cache-aware CI build steps
.github/workflows/         # Validation and deployment workflows
```

Keep code close to its owner. Root `constructs/`, `utils/`, `types/`, `config/`,
and source areas are shared. Everything below `stacks/<stack>/` belongs to that
stack. Keep tests beside the code they cover.

## Scaffold

Create and register a stack:

```bash
pnpm scaffold:stack inventory
```

This creates `stacks/inventory/stack.ts`, registers `InventoryStack`, and adds
its class to the CDK app. Folder names must use lowercase kebab-case.

Add typed outputs and deployment-order dependencies while scaffolding:

```bash
pnpm scaffold:stack inventory \
  --contract tableName=string,itemCount=number \
  --depends-on ProducerStack
```

Use `--contract` or `-c` with `string`, `number`, or `boolean`. Use
`--depends-on` or `-d` with an existing stack ID. Repeat either option or pass
comma-separated values when needed.

Add an optional build hook interactively or for a known target:

```bash
pnpm scaffold:build-script
pnpm scaffold:build-script -- source schemas
pnpm scaffold:build-script -- stack InventoryStack
```

The scaffold refuses to overwrite an existing hook and creates a small example
that writes to the target's `generated/` directory.

After adding a stack, run:

```bash
pnpm lint
pnpm ts-check
pnpm cdk:synth InventoryStack -c stage=playground
```

## Cross-stack values

Define shared values in [`config/contracts.ts`](config/contracts.ts). The
contract checks producer IDs, output names, and value types at compile time.

```ts
// Producer
this.export('tableName', table.tableName);

// Consumer
const tableName = this.import('ProducerStack', 'tableName');
```

Add the producer ID to the consumer's `dependsOn` in
[`config/stacks.ts`](config/stacks.ts) so CI deploys selected stacks in the right
order. This controls CI ordering only. It does not create a CDK or
CloudFormation dependency.

Values are stored at
`/cross-stack-contracts/<producer>/<PascalCaseOutput>`. Deploying a consumer before
its producer value exists fails without automatically deploying the producer.

## Build hooks

Use custom hooks for generated artifacts that CDK does not build, such as types
or clients generated from OpenAPI, AsyncAPI, or Protobuf. Lambda bundling does
not need a hook because CDK handles it during synthesis.

- Root source area: `<area>/scripts/build.ts`
- Stack: `stacks/<stack>/scripts/build.ts`
- Stack hooks receive `STACK_ID`
- CI hooks receive `BUILD_STAGE`
- Generated directories are gitignored

Source-area hooks run only when selected explicitly or through `build -a`.
Selected stack hooks run in dependency order.

### CI builds and caching

CI build policy lives in
[`action.yml`](.github/actions/build/action.yml). Add a conditional cache and
build block whenever a stack or root source area gains a custom hook. Also add
the target to the action's coverage check. CI warns when it finds a custom
`scripts/build.ts` that is missing from the action.

Cache keys must include every source, schema, configuration, package, and tool
input that can change generated output. Never hash the output itself.

The example uses exact cache keys. A miss builds fresh artifacts and saves a new
cache. Add `restore-keys` only for an incremental generator that still runs
after a partial match and removes obsolete output. Include `runner.os` only for
OS-dependent artifacts. Add a manual version such as `v2` when a cache-policy
or output-format change is not captured by hashed inputs.

## Deployment behavior

[`scripts/changed-stacks.ts`](scripts/changed-stacks.ts) selects stacks from
changed paths. Stack-owned changes select that stack. Changes to shared paths
select every stack. Documentation-only changes select none.

Selected stacks are split into dependency groups. CI deploys each group in
parallel, then moves to the next group. Each deployment uses `--exclusively`,
so an unchanged producer is never pulled into a consumer deployment.

- Pull requests lint and type-check the repository, then test and synth changed
  stacks. Shared tests always run when any stack is selected.
- [`deploy.yml`](.github/workflows/deploy.yml) deploys detected stacks.
- [`manual-deploy.yml`](.github/workflows/manual-deploy.yml) deploys requested
  stacks and a selected stage.
- Deployment uses OIDC and requires the `AWS_DEPLOY_ROLE_ARN` repository
  variable.

Preview change detection locally by setting `BASE_SHA` and `HEAD_SHA`:

```bash
pnpm exec tsx scripts/changed-stacks.ts
```

## Dependency build scripts

Dependency install scripts are denied unless reviewed in
[`pnpm-workspace.yaml`](pnpm-workspace.yaml). When pnpm reports an unreviewed
build script, record the default denial with:

```bash
pnpm approve-builds '!package-name'
```

The quotes prevent the shell from interpreting `!`. This writes
`package-name: false` under `allowBuilds`. Set it to `true` only after reviewing
the install scripts and confirming that they are required. Never enable all
dependency builds globally.

## CDK feature flags

CDK may report that feature flags are not configured. Review and adopt its
currently recommended flags with:

```bash
pnpm exec cdk flags --set --unconfigured --recommended
```

Commit the resulting `cdk.json` changes so local development and CI use the
same behavior. Run this after CDK upgrades and review the diff because feature
flags can change synthesized templates.
