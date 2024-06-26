---
title: Migration Guide | Guide
outline: deep
---

# Migration Guide

## Migrating to Vitest 2.0

### Default pool is `forks`

Vitest 2.0 changes the default configuration for `pool` to `'forks'` for better stability. You can read the full motivation in [PR](https://github.com/vitest-dev/vitest/pull/5047).

If you've used `poolOptions` without specifying a `pool`, you might need to update the configuration:

```ts
export default defineConfig({
  test: {
    poolOptions: {
      threads: { // [!code --]
        singleThread: true, // [!code --]
      }, // [!code --]
      forks: { // [!code ++]
        singleFork: true, // [!code ++]
      }, // [!code ++]
    }
  }
})
```

### Hooks are running in a stack

Before Vitest 2.0, all hooks were running in parallel. In 2.0, all hooks run serially. In addition to this, `afterAll`/`afterEach` are running in a reverse order.

You can revert to the previous behaviour by changing [`sequence.hooks`](/config/#sequence-hooks) to `'parallel'`:

```ts
export default defineConfig({
  test: {
    sequence: { // [!code ++]
      hooks: 'parallel', // [!code ++]
    }, // [!code ++]
  },
})
```

### `suite.concurrent` runs all its tests concurrently

Previously, specifying `concurrent` on a suite would still group concurrent tests by suites and run them together one by one. Now, it follows jest's behaviour and runs all of them at once (still limited by [`maxConcurrency`](/config/#maxConcurrency))

### enable V8 coverage's `coverage.ignoreEmptyLines` by default

Changes default value of `coverage.ignoreEmptyLines` to `true`. This change will have major impact on users' code coverage reports. It is likely that projects using coverage thresholds need to adjust those values after this. This change affects only the default `coverage.provider: 'v8'`.

### No more `watchExclude` option

Vitest uses Vite's watcher. You can add your excludes to `server.watch.ignored` instead:

```ts
export default defineConfig({
  server: { // [!code ++]
    watch: { // [!code ++]
      ignored: ['!node_modules/examplejs'] // [!code ++]
    } // [!code ++]
  } // [!code ++]
})
```

### `--segfault-retry` removed

With the changes to default pool, this option is no longer needed. If you experience segfault errors, try switching to `'forks'` pool. If the problem persists, please open a new issue with a reproduction.

### Empty task in suite tasks removed

This is the change to the advanced [task API](/advanced/runner#your-task-function). Previously, traversing `.suite` would eventually lead to the empty internal suite that was used instead of a file task.

This makes `.suite` optional; if the task is defined at the top level, it will not have a suite. You can fallback to the `.file` property that is now present on all tasks (including the file task itself, so be careful not to fall into the endless recursion).

This change also removes the file from `expect.getState().currentTestName` and makes `expect.getState().testPath` required.

### Simplified generic types of mock functions (e.g. `vi.fn<T>`, `Mock<T>`)

Previously `vi.fn<TArgs, TReturn>` accepted two generic types separately for arguemnts and return value. This is changed to directly accept a function type `vi.fn<T>` to simplify the usage.

```ts
import { type Mock, vi } from 'vitest'

const add = (x: number, y: number): number => x + y

// using vi.fn<T>
const mockAdd = vi.fn<Parameters<typeof add>, ReturnType<typeof add>>() // [!code --]
const mockAdd = vi.fn<typeof add>() // [!code ++]

// using Mock<T>
const mockAdd: Mock<Parameters<typeof add>, ReturnType<typeof add>> = vi.fn() // [!code --]
const mockAdd: Mock<typeof add> = vi.fn() // [!code ++]
```

## Migrating to Vitest 1.0

<!-- introduction -->

### Minimum Requirements

Vitest 1.0 requires Vite 5.0 and Node.js 18 or higher.

All `@vitest/*` sub packages require Vitest version 1.0.

### Snapshots Update [#3961](https://github.com/vitest-dev/vitest/pull/3961)

Quotes in snapshots are no longer escaped, and all snapshots use backtick quotes (`) even if the string is just a single line.

1. Quotes are no longer escaped:

```diff
expect({ foo: 'bar' }).toMatchInlineSnapshot(`
  Object {
-    \\"foo\\": \\"bar\\",
+    "foo": "bar",
  }
`)
```

2. One-line snapshots now use "`" quotes instead of ':

```diff
- expect('some string').toMatchInlineSnapshot('"some string"')
+ expect('some string').toMatchInlineSnapshot(`"some string"`)
```

There were also [changes](https://github.com/vitest-dev/vitest/pull/4076) to `@vitest/snapshot` package. If you are not using it directly, you don't need to change anything.

- You no longer need to extend `SnapshotClient` just to override `equalityCheck` method: just pass it down as `isEqual` when initiating an instance
- `client.setTest` was renamed to `client.startCurrentRun`
- `client.resetCurrent` was renamed to `client.finishCurrentRun`

### Pools are Standardized [#4172](https://github.com/vitest-dev/vitest/pull/4172)

We removed a lot of configuration options to make it easier to configure the runner to your needs. Please, have a look at migration examples if you rely on `--threads` or other related flags.

- `--threads` is now `--pool=threads`
- `--no-threads` is now `--pool=forks`
- `--single-thread` is now `--poolOptions.threads.singleThread`
- `--experimental-vm-threads` is now `--pool=vmThreads`
- `--experimental-vm-worker-memory-limit` is now `--poolOptions.vmThreads.memoryLimit`
- `--isolate` is now `--poolOptions.<pool-name>.isolate` and `browser.isolate`
- `test.maxThreads` is now `test.poolOptions.<pool-name>.maxThreads`
- `test.minThreads` is now `test.poolOptions.<pool-name>.minThreads`
- `test.useAtomics` is now `test.poolOptions.<pool-name>.useAtomics`
- `test.poolMatchGlobs.child_process` is now `test.poolMatchGlobs.forks`
- `test.poolMatchGlobs.experimentalVmThreads` is now `test.poolMatchGlobs.vmThreads`

```diff
{
  scripts: {
-    "test": "vitest --no-threads"
     // For identical behaviour:
+    "test": "vitest --pool forks --poolOptions.forks.singleFork"
     // Or multi parallel forks:
+    "test": "vitest --pool forks"

  }
}
```

```diff
{
  scripts: {
-    "test": "vitest --experimental-vm-threads"
+    "test": "vitest --pool vmThreads"
  }
}
```

```diff
{
  scripts: {
-    "test": "vitest --isolate false"
+    "test": "vitest --poolOptions.threads.isolate false"
  }
}
```

```diff
{
  scripts: {
-    "test": "vitest --no-threads --isolate false"
+    "test": "vitest --pool forks --poolOptions.forks.isolate false"
  }
}
```

### Changes to Coverage [#4265](https://github.com/vitest-dev/vitest/pull/4265), [#4442](https://github.com/vitest-dev/vitest/pull/4442)

Option `coverage.all` is now enabled by default. This means that all project files matching `coverage.include` pattern will be processed even if they are not executed.

Coverage thresholds API's shape was changed, and it now supports specifying thresholds for specific files using glob patterns:

```diff
export default defineConfig({
  test: {
    coverage: {
-      perFile: true,
-      thresholdAutoUpdate: true,
-      100: true,
-      lines: 100,
-      functions: 100,
-      branches: 100,
-      statements: 100,
+      thresholds: {
+        perFile: true,
+        autoUpdate: true,
+        100: true,
+        lines: 100,
+        functions: 100,
+        branches: 100,
+        statements: 100,
+      }
    }
  }
})
```

### Mock Types [#4400](https://github.com/vitest-dev/vitest/pull/4400)

A few types were removed in favor of Jest-style "Mock" naming.

```diff
- import { EnhancedSpy, SpyInstance } from 'vitest'
+ import { MockInstance } from 'vitest'
```

::: warning
`SpyInstance` is deprecated in favor of `MockInstance` and will be removed in the next major release.
:::

### Timer mocks [#3925](https://github.com/vitest-dev/vitest/pull/3925)

`vi.useFakeTimers()` no longer automatically mocks [`process.nextTick`](https://nodejs.org/api/process.html#processnexttickcallback-args).
It's still possible to mock `process.nextTick` by explicitly specifying it by using `vi.useFakeTimers({ toFake: ['nextTick'] })`.

However, mocking `process.nextTick` is not possible when using `--pool=forks`. Use a different `--pool` option if you need `process.nextTick` mocking.

## Migrating from Jest

Vitest has been designed with a Jest compatible API, in order to make the migration from Jest as simple as possible. Despite those efforts, you may still run into the following differences:

### Globals as a Default

Jest has their [globals API](https://jestjs.io/docs/api) enabled by default. Vitest does not. You can either enable globals via [the `globals` configuration setting](/config/#globals) or update your code to use imports from the `vitest` module instead.

If you decide to keep globals disabled, be aware that common libraries like [`testing-library`](https://testing-library.com/) will not run auto DOM [cleanup](https://testing-library.com/docs/svelte-testing-library/api/#cleanup).

### Module Mocks

When mocking a module in Jest, the factory argument's return value is the default export. In Vitest, the factory argument has to return an object with each export explicitly defined. For example, the following `jest.mock` would have to be updated as follows:

```ts
jest.mock('./some-path', () => 'hello') // [!code --]
vi.mock('./some-path', () => ({ // [!code ++]
  default: 'hello', // [!code ++]
})) // [!code ++]
```

For more details please refer to the [`vi.mock` api section](/api/vi#vi-mock).

### Auto-Mocking Behaviour

Unlike Jest, mocked modules in `<root>/__mocks__` are not loaded unless `vi.mock()` is called. If you need them to be mocked in every test, like in Jest, you can mock them inside [`setupFiles`](/config/#setupfiles).

### Importing the Original of a Mocked Package

If you are only partially mocking a package, you might have previously used Jest's function `requireActual`. In Vitest, you should replace these calls with `vi.importActual`.

```ts
const { cloneDeep } = jest.requireActual('lodash/cloneDeep') // [!code --]
const { cloneDeep } = await vi.importActual('lodash/cloneDeep') // [!code ++]
```

### Extends mocking to external libraries

Where Jest does it by default, when mocking a module and wanting this mocking to be extended to other external libraries that use the same module, you should explicitly tell which 3rd-party library you want to be mocked, so the external library would be part of your source code, by using [server.deps.inline](https://vitest.dev/config/#server-deps-inline).

```
server.deps.inline: ["lib-name"]
```

### Accessing the Return Values of a Mocked Promise

Both Jest and Vitest store the results of all mock calls in the [`mock.results`](/api/mock.html#mock-results) array, where the return values of each call are stored in the `value` property.
However, when mocking or spying on a promise (e.g. using `mockResolvedValue`), in Jest the `value` property will be a promise, while in Vitest, it will become a resolved value when a promise is resolved.

```ts
await expect(spy.mock.results[0].value).resolves.toBe(123) // [!code --]
expect(spy.mock.results[0].value).toBe(123) // [!code ++]
```

### Envs

Just like Jest, Vitest sets `NODE_ENV` to `test`, if it wasn't set before. Vitest also has a counterpart for `JEST_WORKER_ID` called `VITEST_POOL_ID` (always less than or equal to `maxThreads`), so if you rely on it, don't forget to rename it. Vitest also exposes `VITEST_WORKER_ID` which is a unique ID of a running worker - this number is not affected by `maxThreads`, and will increase with each created worker.

### Replace property

If you want to modify the object, you will use [replaceProperty API](https://jestjs.io/docs/jest-object#jestreplacepropertyobject-propertykey-value) in Jest, you can use [`vi.stubEnv`](/api/#vi-stubenv) or [`vi.spyOn`](/api/vi#vi-spyon) to do the same also in Vitest.

### Done Callback

From Vitest v0.10.0, the callback style of declaring tests is deprecated. You can rewrite them to use `async`/`await` functions, or use Promise to mimic the callback style.

```
it('should work', (done) => {  // [!code --]
it('should work', () => new Promise(done => { // [!code ++]
  // ...
  done()
}) // [!code --]
})) // [!code ++]
```

### Hooks

`beforeAll`/`beforeEach` hooks may return [teardown function](/api/#setup-and-teardown) in Vitest. Because of that you may need to rewrite your hooks declarations, if they return something other than `undefined` or `null`:

```ts
beforeEach(() => setActivePinia(createTestingPinia())) // [!code --]
beforeEach(() => { setActivePinia(createTestingPinia()) }) // [!code ++]
```

In Jest hooks are called sequentially (one after another). By default, Vitest runs hooks in parallel. To use Jest's behavior, update [`sequence.hooks`](/config/#sequence-hooks) option:

```ts
export default defineConfig({
  test: {
    sequence: { // [!code ++]
      hooks: 'list', // [!code ++]
    } // [!code ++]
  }
})
```

### Types

Vitest doesn't have an equivalent to `jest` namespace, so you will need to import types directly from `vitest`:

```ts
let fn: jest.Mock<(name: string) => number> // [!code --]
import type { Mock } from 'vitest' // [!code ++]
let fn: Mock<(name: string) => number> // [!code ++]
```

### Timers

Vitest doesn't support Jest's legacy timers.

### Timeout

If you used `jest.setTimeout`, you would need to migrate to `vi.setConfig`:

```ts
jest.setTimeout(5_000) // [!code --]
vi.setConfig({ testTimeout: 5_000 }) // [!code ++]
```

### Vue Snapshots

This is not a Jest-specific feature, but if you previously were using Jest with vue-cli preset, you will need to install [`jest-serializer-vue`](https://github.com/eddyerburgh/jest-serializer-vue) package, and use it inside [setupFiles](/config/#setupfiles):

`vite.config.js`

```js twoslash
import { defineConfig } from 'vite'

export default defineConfig({
  test: {
    setupFiles: ['./tests/unit/setup.js']
  }
})
```

`tests/unit/setup.js`

```js
import vueSnapshotSerializer from 'jest-serializer-vue'

expect.addSnapshotSerializer(vueSnapshotSerializer)
```

Otherwise your snapshots will have a lot of escaped `"` characters.
