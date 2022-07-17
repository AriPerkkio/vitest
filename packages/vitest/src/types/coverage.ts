import type { Arrayable } from './general'

export type CoverageReporter =
  | 'clover'
  | 'cobertura'
  | 'html-spa'
  | 'html'
  | 'json-summary'
  | 'json'
  | 'lcov'
  | 'lcovonly'
  | 'none'
  | 'teamcity'
  | 'text-lcov'
  | 'text-summary'
  | 'text'

export type CoverageProviders = 'c8' | 'istanbul'

export type CoverageOptions =
  | ({ provider: 'c8' } & C8Options)
  | ({ provider: 'istanbul' } & IstanbulOptions)

interface BaseCoverageOptions {
  /**
   * Enable coverage, pass `--coverage` to enable
   *
   * @default false
   */
  enabled?: boolean

  /**
   * Clean coverage report on watch rerun
   *
   * @default false
   */
  cleanOnRerun?: boolean

  /**
   * Directory to write coverage report to
   */
  reportsDirectory?: string
}

export interface IstanbulOptions extends BaseCoverageOptions {
  /* Name of global coverage variable. (optional, default __coverage__) */
  coverageVariable?: string

  /* Report boolean value of logical expressions. (optional, default false) */
  reportLogic?: boolean

  /* Preserve comments in output. (optional, default false) */
  preserveComments?: boolean

  /* Generate compact code. (optional, default true) */
  compact?: boolean

  /* Set to true to instrument ES6 modules. (optional, default false) */
  esModules?: boolean

  /* Set to true to allow return statements outside of functions. (optional, default false) */
  autoWrap?: boolean

  /* Set to true to produce a source map for the instrumented code. (optional, default false) */
  produceSourceMap?: boolean

  /* Set to array of class method names to ignore for coverage. (optional, default []) */
  ignoreClassMethods?: string[]

  /* A callback function that is called when a source map URL. is found in the original code. This function is called with the source file name and the source map URL. (optional, default null) */
  sourceMapUrlCallback?: Function

  /* Turn debugging on. (optional, default false) */
  debug?: boolean

  /* Set babel parser plugins, see @istanbuljs/schema for defaults. */
  parserPlugins?: string[]

  /* The global coverage variable scope. (optional, default this) */
  coverageGlobalScope?: string

  /* Use an evaluated function to find coverageGlobalScope. (optional, default true) */
  coverageGlobalScopeFunc?: boolean
}

export interface C8Options extends BaseCoverageOptions {

  /**
   * Clean coverage before running tests
   *
   * @default true
   */
  clean?: boolean
  /**
   * Allow files from outside of your cwd.
   *
   * @default false
   */
  allowExternal?: any
  /**
   * Reporters
   *
   * @default 'text'
   */
  reporter?: Arrayable<CoverageReporter>
  /**
   * Exclude coverage under /node_modules/
   *
   * @default true
   */
  excludeNodeModules?: boolean
  exclude?: string[]
  include?: string[]
  skipFull?: boolean
  extension?: string | string[]

  all?: boolean
  src?: string[]

  100?: boolean
  lines?: number
  functions?: number
  branches?: number
  statements?: number
}

export type ResolvedCoverageOptions =
  & { tempDirectory: string }
  & Required<
    | ({ provider: 'c8' } & C8Options)
    | ({ provider: 'istanbul' } & IstanbulOptions)
  >
