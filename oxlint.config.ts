import { defineConfig } from "oxlint";

const GLOB_SRC = "**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}";

export default defineConfig({
  rules: {
    "typescript/consistent-type-imports": [
      "error",
      { prefer: "type-imports", disallowTypeAnnotations: false },
    ],
    "no-empty-pattern": "off",
    "no-unused-vars": [
      "warn",
      {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        ignoreRestSiblings: true,
      },
    ],

    // let TypeScript handle this
    "no-undef": "off",
    curly: ["error", "all"],

    "no-restricted-imports": [
      "error",
      {
        paths: ["path"],
      },
    ],

    "import/no-named-as-default": "off",
  },

  overrides: [
    {
      files: [`test/${GLOB_SRC}`],
      rules: {
        "no-constant-condition": "off",
        "unicorn/no-thenable": "off",
      },
    },
    {
      files: ["**/*.test-d.ts"],
      rules: {
        "no-unassigned-vars": "off",
      },
    },
    {
      files: [
        "packages/browser/dummy.js",
        "test/unit/deps/dep-esm-non-existing/index.mjs",
        "test/e2e/deps/vite-ssr-resolve/{other-dep,inline-dep,ssr-no-external-dep}/index.js",
      ],
      rules: {
        "unicorn/no-empty-file": "off",
      },
    },
    {
      files: [`packages/${GLOB_SRC}`],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: ["vitest", "path", "vitest/node"],
          },
        ],
      },
    },
    {
      // these files define vitest as peer dependency
      files: [`packages/{coverage-*,ui,browser,web-worker,browser-*}/${GLOB_SRC}`],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: ["path"],
          },
        ],
      },
    },
    {
      files: [`docs/${GLOB_SRC}`, `**/*.md`, `**/*.md/${GLOB_SRC}`],
      rules: {
        "prefer-arrow-callback": "off",
        "import/newline-after-import": "off",
        "import/first": "off",
        "no-self-compare": "off",
        "import/no-mutable-exports": "off",
        "no-throw-literal": "off",
        "import/no-duplicates": "off",
      },
    },
    {
      files: [`docs/${GLOB_SRC}`, `packages/web-worker/${GLOB_SRC}`, `test/unit/${GLOB_SRC}`],
      rules: {
        "no-restricted-globals": "off",
      },
    },

    {
      files: [`packages/browser/src/client/orchestrator.ts`],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: ["vitest/internal/browser", "vitest/node"],
          },
        ],
      },
    },
    // ivya should be loaded only once in "ivya chunk" (see browser rollup config)
    {
      files: [`packages/browser/${GLOB_SRC}`],
      excludeFiles: [
        // aria snapshots
        `packages/browser/src/vendor-types.ts`,
        `packages/browser/src/client/tester/aria.ts`,
        // primary use case - creates the engine
        `packages/browser/src/client/tester/locators.ts`,
        // uses utils from ivya to reuse locator syntax
        `packages/browser/src/client/tester/expect/${GLOB_SRC}`,
        // used as a type
        `packages/browser/src/client/utils.ts`,
      ],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            paths: ["ivya", "ivya/utils", "ivya/aria"],
          },
        ],
      },
    },
  ],

  ignorePatterns: [
    "**/coverage",
    "**/*.snap",
    "**/bench.json",
    "**/fixtures",
    "**/assets/**",
    "**/*.d.ts",
    "**/*.timestamp-*",
    "**/test-results",
    "test/unit/src/self",
    "test/unit/test/mocking/already-hoisted.test.ts",
    "test/cache/cache/.vitest-base/results.json",
    "test/unit/src/wasm/wasm-bindgen-no-cyclic",
    "test/workspaces/results.json",
    "test/workspaces-browser/results.json",
    "test/reporters/fixtures/with-syntax-error.test.js",
    "test/network-imports/public/slash@3.0.0.js",
    "test/coverage-test/src/transpiled.js",
    "test/coverage-test/src/original.ts",
    "test/e2e/deps/error/*",
    "test/e2e/deps/malformed-source-map/*.js",
    "examples/**/mockServiceWorker.js",
    "examples/sveltekit/.svelte-kit",
    "packages/browser/**/esm-client-injector.js",
    // contains technically invalid code to display pretty diff
    "docs/guide/snapshot.md",
    // uses invalid js example
    "docs/api/advanced/import-example.md",
    "docs/guide/examples/*.md",
  ],
});
