import vm from 'node:vm'
import { readFileSync } from 'node:fs'
import type { VitestRunner } from '@vitest/runner'
import { globalApis } from '../../constants'
import { VitestTestRunner } from './test'

interface ReferencingModule {
  identifier: string
}

interface VmModule {
  status: 'linked' | 'unlinked'
  link: (loader: ImportModuleDynamically) => Promise<void>
  evaluate: () => Promise<void>
  setExport: (key: string, value: any) => void
}

type ImportModuleDynamically = (
  specifier: string,
  referencingModule: ReferencingModule
) => Promise<VmModule>

interface Options {
  context: vm.Context
  identifier: string
  importModuleDynamically: ImportModuleDynamically
}

interface VmSourceTextModule {
  new(code: string, opts: Options): VmModule
}

interface VmSyntheticModule {
  new(properties: string[], init: () => void, opts: Options): VmModule
}

const SourceTextModule: VmSourceTextModule = (vm as any).SourceTextModule
const SyntheticModule: VmSyntheticModule = (vm as any).SyntheticModule

export class ExperimentalVmModulesRunner
  extends VitestTestRunner
  implements VitestRunner {
  context!: vm.Context
  moduleCache = new Map()
  runningFile?: string

  constructor(config: VitestTestRunner['config']) {
    super(config)
    this.config = config

    const context = { setTimeout }

    if (config.globals)
      // @ts-expect-error -- intentional
      globalApis.forEach(key => (context[key] = globalThis[key]))

    this.context = vm.createContext(context)
  }

  async importFile(filepath: string) {
    const code = await this.fetchModule(filepath)
    await this.runInVm(code, filepath)
  }

  async fetchModule(filepath: string): Promise<string> {
    const [id] = await this.__vitest_executor.resolveUrl(filepath)

    let { code, externalize } = await this.__vitest_executor.options
      .fetchModule(id, 'web')
      .catch((error) => {
        console.error(`fetchModule() failed for ${id}`)
        throw error
      })

    if (externalize)
      code = readFileSync(externalize, 'utf-8')

    if (!code)
      throw new Error(`Unable to fetch module ${id}`)

    return this.prepareCode(code)
  }

  async runInVm(code: string, filename: string) {
    const wrapped = `
    async function asyncWrapper() {
      ${code}
    }
    asyncWrapper();
    `

    this.runningFile = filename

    await vm.runInContext(wrapped, this.context, {
      filename,
      columnOffset: -6,
      lineOffset: -2,
      // @ts-expect-error -- experimental
      importModuleDynamically: this.importModuleDynamically.bind(this),
    })

    this.runningFile = undefined
  }

  async importModuleDynamically(
    specifier: string,
    referencingModule: ReferencingModule,
  ) {
    const m = await this.load(specifier, referencingModule)

    if (m.status === 'unlinked')
      await m.link(this.load.bind(this))

    if (m.status === 'linked')
      await m.evaluate()

    return m
  }

  async load(specifier: string, referencingModule: ReferencingModule): Promise<VmModule> {
    const name = await this.resolve(specifier, referencingModule)

    if (this.moduleCache.has(name))
      return this.moduleCache.get(name)

    const options: Options = {
      context: this.context,
      identifier: name,
      importModuleDynamically: this.importModuleDynamically.bind(this),
    }

    let mod: VmModule

    if (name.startsWith('/')) {
      const code = await this.fetchModule(name)
      mod = new SourceTextModule(code, options)
    }

    mod ||= await this.externalize(options)
    this.moduleCache.set(name, mod)

    return mod
  }

  async resolve(specifier: string, referencingModule: ReferencingModule) {
    const identifier = referencingModule.identifier || this.runningFile!

    const name = await import.meta.resolve!(
      specifier.replace('/@fs', ''),
      identifier.replace('/@fs', ''),
    ).catch(() => null)

    if (name)
      return name

    const [resolvedUrl] = await this.__vitest_executor.resolveUrl(
      specifier,
      identifier,
    )

    return resolvedUrl || specifier
  }

  async externalize(options: Options) {
    const mod = await import(options.identifier)

    const externalized: VmModule = new SyntheticModule(
      Object.keys(mod),
      () =>
        Object.keys(mod).forEach(key =>
          externalized.setExport(key, mod[key]),
        ),
      options,
    )

    return externalized
  }

  // TODO: Request ESM from Vite and replace imports with dynamic imports
  prepareCode(code: string): string {
    return (
      code
        .replace(/await __vite_ssr_import__\(/g, 'await import(')
        .replace(/__vite_ssr_exports__\.(.*) =/g, 'export $1')
        // imports
        .replace(
          /const (.*), {(.*)} = await import\((.*)\);/g,
          'const { default: $1 } = await import($3);\nconst { $2 } = await import($3);',
        )
        // .replace(
        //   /const (\w*) = await import\(/g,
        //   "const { default: $1 } = await import("
        // )
        // exports
        .replace(
          /Object\.defineProperty\(__vite_ssr_exports__, "default", { enumerable: true, configurable: true, value: (.*) }\);/g,
          'export default $1;',
        )
        .replace(
          /Object.defineProperty\(__vite_ssr_exports__, "default", { enumerable: true, configurable: true, get\(\){ return (.*) }}\);/g,
          'export default $1;',
        )
        .replace(
          /Object.defineProperty\(__vite_ssr_exports__, "(.*)", { enumerable: true, configurable: true, get\(\){ return (.*)\.(.*) }}\);/g,
          'const $1 = $2.$3;\nexport { $1 };',
        )
        .replace(
          /Object.defineProperty\(__vite_ssr_exports__, "(.*)", { enumerable: true, configurable: true, get\(\){ return (.*) }}\);/g,
          'export { $1 };',
        )
    )
  }
}
