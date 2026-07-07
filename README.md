# cdk-decoupled-stacks

A worked example of how to manage many AWS CDK stacks in one repository so that:

1. **Only the stacks that actually changed are deployed** on merge to `main` —
   in the correct dependency order.
2. **Stacks share values without being tightly coupled** — no CloudFormation
   exports/imports, so any stack can be deployed, updated or destroyed
   independently.

It is deliberately small (a producer stack and a consumer stack) so the pattern
is easy to read and copy into a real project.

---

## Why this pattern

A typical CDK monorepo grows to dozens of stacks. Two problems show up quickly:

- **Deploying everything on every merge** is slow, noisy, and risky — a change
  to one stack shouldn't roll the whole estate.
- **Cross-stack references via `CfnOutput` + `Fn.importValue`** (or passing
  constructs between stacks) create hard CloudFormation dependencies. Once
  stack B imports an export from stack A, CloudFormation refuses to modify or
  delete that export while B uses it, and the CLI insists on deploying A before
  B. Stacks become welded together.

This repo shows a way to avoid both: **surgical, dependency-ordered deploys**
driven by a git diff, and **loose cross-stack links through SSM Parameter
Store** that are validated at compile time but never coupled at deploy time.

---

## The two example stacks

| Stack           | Folder             | Role     | What it does                                            |
| --------------- | ------------------ | -------- | ------------------------------------------------------- |
| `ProducerStack` | `stacks/producer/` | Producer | Creates a DynamoDB table, publishes its name + ARN |
| `ConsumerStack` | `stacks/consumer/` | Consumer | Imports the name + ARN and runs a batch-put and batch-get lambda against the table |

`ProducerStack` publishes its table's name and ARN; `ConsumerStack` reads both
and uses them from its lambdas. They never import each other's constructs.

---

<!-- todo: I really like this file structure overview, but new stacks would have to be added manually. Maybe we can automate this? -->
## File structure

```
config/
  stacks.ts          # Single source of truth: stack ids, names, paths & deploy order
  contracts.ts       # Type-checked names of cross-stack outputs, keyed by producer
constructs/
  app.ts             # App + stage handling
  cross-stack.ts     # CrossStackProducer base class + importCrossStackValue (SSM-backed)
  lambda.ts          # NodejsFunction wrapper (handler = repo-root-relative path)
utils/               # SHARED helpers used by more than one stack
types/               # SHARED types
bin/
  app.ts             # Wires each registered stack id to its class
stacks/
  producer/
    stack.ts         # ProducerStack (owns the table, publishes name + ARN)
  consumer/
    stack.ts         # ConsumerStack (imports name + ARN, runs the lambdas)
    lambdas/         # batch-put.ts / batch-get.ts — used ONLY by this stack
scripts/
  changed-stacks.ts  # Deploy set (and order) from a git diff — used by deploy.yml
  resolve-stacks.ts  # Deploy set from an explicit list — used by manual-deploy.yml
  deploy-set.ts      # Shared wave ordering + GitHub Actions output
.github/workflows/
  deploy.yml         # Auto-deploy changed stacks on merge to main
  manual-deploy.yml  # Deploy chosen stacks on demand (workflow_dispatch)
    validate.yml       # Lint & type-check (whole repo) + synth of changed stacks on PRs
```

---

## Pillar 1 — Deploy only what changed

### How change detection works

The `detect` job in [.github/workflows/deploy.yml](.github/workflows/deploy.yml)
runs [scripts/changed-stacks.ts](scripts/changed-stacks.ts), which decides what
to deploy purely from the **list of changed files** — no CDK synth required:

1. Get changed files: `git diff --name-only <before> <after>`, where `before`
   is the previous commit on `main` and `after` is the merge commit.
2. Match each changed file against the paths declared in
   [config/stacks.ts](config/stacks.ts). Matching is intentionally simple:
   - a pattern ending in `/` is a **directory-prefix** match — `stacks/consumer/`
     matches `stacks/consumer/lambdas/batch-put.ts`;
   - any other pattern is an **exact-file** match — e.g. `cdk.json`.
3. Decide the deploy set:
   - if any changed file matches a **`SHARED_PATH`** (`constructs/`, `utils/`,
     `types/`, `config/`, `bin/`, `cdk.json`, `package.json`, `pnpm-lock.yaml`,
     `tsconfig.json`) → **deploy every stack**, because shared code can affect
     all of them;
   - otherwise, select each stack whose own `paths` contain a changed file.
4. First push (no previous commit) → **deploy every stack**.

#### Examples

| Changed file                          | Deploys              |
| ------------------------------------- | -------------------- |
| `stacks/producer/stack.ts`            | `ProducerStack`      |
| `stacks/consumer/lambdas/batch-put.ts`| `ConsumerStack`      |
| `utils/chunk.ts`                      | all stacks (shared)  |
| `config/contracts.ts`                 | all stacks (shared)  |
| `README.md`                           | nothing              |

This is why stack-specific code must live under `stacks/<stack>/`: that prefix
is what attributes a change to a single stack.

### Where to put code

The rule follows change detection — **code lives next to whatever should be
redeployed when it changes:**

| Code used by...     | Put it in                         | A change redeploys |
| ------------------- | --------------------------------- | ------------------ |
| One stack           | `stacks/<stack>/...`              | that stack only    |
| More than one stack | `utils/`, `types/`, `constructs/` | every stack        |

- **Stack-specific lambda handlers** → `stacks/<stack>/lambdas/`, wired with a
  repo-root-relative path (see `ConsumerStack`):
  `new NodejsFunction(this, 'BatchPut', { stage, handler: 'stacks/consumer/lambdas/batch-put.ts' })`.
- **Stack-specific utilities** → `stacks/<stack>/utils/`.
- **Shared code** → root `utils/` / `types/` / `constructs/`. These are
  `SHARED_PATHS`, so a change redeploys everything — on purpose.

### Deploy behavior

On push to `main`, [deploy.yml](.github/workflows/deploy.yml) runs two jobs:

- **detect** — computes the deploy set and splits it into dependency-ordered
  **waves** (see below). Outputs `waves` (a JSON array of arrays) and `count`.
- **deploy** — walks the waves:
  - stacks **within a wave** deploy in parallel (`xargs -P 4`);
  - **waves run in order**, so a producer deploys before a consumer that reads
    its output;
  - each stack is deployed with `cdk deploy <id> --exclusively`, so an
    unchanged stack is **never** pulled in as a dependency;
  - if a stack in a wave fails, that wave still finishes, but later (dependent)
    waves are skipped.

> `cdk deploy` selects a stack by its **construct id** — the id passed to
> `new SomeStack(app, 'SomeStack', …)` — not by the CloudFormation `stackName`.

### Deploy order and waves

Ordering comes from each stack's optional `dependsOn` in
[config/stacks.ts](config/stacks.ts). It is a **CI ordering hint only** — it is
*not* a CDK/CloudFormation dependency and never couples the stacks. Ordering is
applied **only among stacks that are in the same deploy**:

- Add a producer **and** consumer in one merge → they land in two waves;
  producer first, consumer second, both succeed.
- Change **only** the consumer → the producer is *not* pulled in; the consumer
  deploys alone and fails if the producer's output doesn't exist yet (see
  Pillar 2). This is intentional — CI never silently deploys the producer.

### Manual deploys

[.github/workflows/manual-deploy.yml](.github/workflows/manual-deploy.yml)
(`workflow_dispatch`) deploys a chosen set on demand. Inputs:

- **stacks** — a space/comma-separated list of stack ids
  (e.g. `ProducerStack ConsumerStack`), or `all`.
- **stage** — `staging` or `prod`.

It validates the ids against the registry and reuses the exact same wave
rollout as the automatic pipeline.

---

## Pillar 2 — Cross-stack references without tight coupling

Stacks exchange values through **SSM Parameter Store**, not CloudFormation
exports.

### Producer side

A producer stack extends `CrossStackProducer<'<StackId>'>` and calls
`this.publish(output, value)`:

```ts
export class ProducerStack extends CrossStackProducer<'ProducerStack'> {
  constructor(scope: Construct, props: CrossStackProducerProps) {
    super(scope, 'ProducerStack', props);

    const table = new TableV2(this, 'Table', { /* … */ });

    this.publish('tableName', table.tableName);
    this.publish('tableArn', table.tableArn);
  }
}
```

The producer identity is the stack's own construct id (`'ProducerStack'`), which
the base class captures — it is **never passed to `publish`**. `publish` writes
an SSM parameter at `/cross-stack/<stage>/<producer>/<segment>`
(e.g. `/cross-stack/prod/ProducerStack/TableName`).

### Consumer side

A consumer reads the value with `importCrossStackValue`, which resolves at
**deploy time** via an SSM parameter reference:

```ts
const tableName = importCrossStackValue(this, {
  stage,
  producer: 'ProducerStack',
  output: 'tableName',
});
```

The returned value is a normal string token — use it in any resource property
(env vars, names, …). `ConsumerStack` imports both `tableName` (passed to its
batch-put/batch-get lambdas as `TABLE_NAME`) and `tableArn` (used to scope the
lambdas' IAM to the table). It never references the Producer's `Table`
construct, so the stacks stay decoupled.

### The contract & compile-time safety

Output names live in [config/contracts.ts](config/contracts.ts), keyed by the
producing stack's id:

```ts
export const CONTRACTS = {
  ProducerStack: { tableName: 'TableName', tableArn: 'TableArn' },
} as const satisfies Partial<Record<StackId, Readonly<Record<string, string>>>;
```

Because `StackId` is derived from the stack registry
([config/stacks.ts](config/stacks.ts)) and `CONTRACTS` is keyed by `StackId`,
TypeScript enforces that:

- a stack can only extend `CrossStackProducer<P>` for a `P` that declares a
  contract;
- `publish(output, …)` only accepts outputs from *that* stack's contract;
- `importCrossStackValue({ producer, output })` only accepts a real producer and
  one of its declared outputs.

A typo — wrong producer or output name — is a compile error, not a runtime
surprise.

### Why this is loosely coupled

- **No CloudFormation dependency** between stacks. They can be deployed,
  updated, and destroyed in any order. Removing a producer is allowed —
  CloudFormation won't block it (unlike `Fn.importValue`).
- If a consumer is deployed **before** the parameter exists, its deployment
  **fails by design** with a "parameter not found" error. The producer is never
  deployed automatically to satisfy it.

---

## Scaling: more stacks or more apps?

Keep adding stacks to this single app until one of these starts to hurt:

- synth/CI time or noise grows too large;
- teams need **independent CDK versions, feature flags, or release schedules**
  (all per-app via `cdk.json`);
- you need **hard account/role isolation** between domains.

Then promote a group of stacks into its own app. Separate apps get their own
`cdk.json`, context cache, deploy role/bootstrap, and independent synth — and
they make accidental cross-stack coupling impossible. The cost is duplicated
tooling and cross-app refactors becoming real moves instead of imports.

### Keeping synth fast

`cdk deploy X` still runs all of `bin/app.ts`, so every stack is *constructed*
even to deploy one. To avoid that, [bin/app.ts](bin/app.ts) honours
`-c stacks=Id1,Id2` and instantiates only those stacks (absent → all). The
deploy workflows pass `--context stacks={}` per stack, so each deploy
synthesizes just that stack.

PR validation ([validate.yml](.github/workflows/validate.yml)) uses the same
trick: it runs the change-detection script and synthesizes **only the changed
stacks**. This is safe because a change to a shared path escalates to "all
stacks", so the only stacks skipped are ones that are genuinely unaffected and
would synthesize identically to `main`. `lint` and `ts-check` still run over the
whole repo, so cross-stack type safety is never skipped.

---

## Adding a stack

1. Create `stacks/<name>/stack.ts` exporting your stack class (plus any
   `stacks/<name>/lambdas/` or `stacks/<name>/utils/`).
2. Register it in [config/stacks.ts](config/stacks.ts): `id`, `stackName`,
   `description`, `paths: ['stacks/<name>/']`, and `dependsOn` if it consumes
   another stack's outputs.
3. Wire the `id` to the class in [bin/app.ts](bin/app.ts).
4. If it produces cross-stack values, add its contract to
   [config/contracts.ts](config/contracts.ts) and extend
   `CrossStackProducer<'<Id>'>`.

---

## Commands

### Local deploy

```bash
pnpm cdk:deploy
```

Interactive prompt ([scripts/deploy.ts](scripts/deploy.ts)) that asks which
stage and which stacks to deploy, then runs them in dependency order (same wave
logic as CI). Requires AWS credentials in the current session (env vars,
`~/.aws/credentials`, or an assumed role).

First time deploying to an account/region, bootstrap CDK first:

```bash
pnpm exec cdk bootstrap --context stage=<stage>
```

### Other commands

- `pnpm build` — synth all stacks (`stage=staging`).
- `pnpm lint` / `pnpm ts-check` — Biome + TypeScript checks.
- `pnpm exec tsx scripts/changed-stacks.ts` — preview the deploy set a git diff
  would produce (set `BASE_SHA` / `HEAD_SHA` env vars).
- `pnpm exec cdk synth --context stage=<stage> -c stacks=<Id1,Id2>` — synth
  only the listed stacks without building the full app.

## CI requirements

- Repo variable `AWS_DEPLOY_ROLE_ARN` (`Settings → Secrets and variables → Actions → Variables`) — the ARN of the OIDC role CI assumes to deploy. Stored as a variable (not a secret) because an ARN is an identifier, not a credential.
- Region and default stage are set in the workflows (`eu-north-1`, `prod` for
  the automatic deploy).
