import type { ModuleExecutionInfo } from 'vite-node/client'
import type { CoverageProvider } from '../node/types/coverage'
import type { SerializedCoverageConfig } from '../runtime/config'
import type { CoverageRuntime } from '../types/coverage-runtime'

export interface RuntimeCoverageModuleLoader {
  executeId: (id: string) => Promise<{ default: { new(): CoverageProvider } | CoverageRuntime }>
  isBrowser?: boolean
  moduleExecutionInfo?: ModuleExecutionInfo
}

export const CoverageProviderMap: Record<string, string> = {
  v8: '@vitest/coverage-v8',
  istanbul: '@vitest/coverage-istanbul',
}

export async function resolveCoverageProvider(
  options: SerializedCoverageConfig | undefined,
  loader: RuntimeCoverageModuleLoader,
): Promise<{ new(): CoverageProvider } | null> {
  return resolveCoverageModule(options, loader, '/provider')
}

export async function resolveCoverageRuntime(
  options: SerializedCoverageConfig | undefined,
  loader: RuntimeCoverageModuleLoader,
): Promise<CoverageRuntime | null> {
  return resolveCoverageModule(options, loader)
}

async function resolveCoverageModule(options: SerializedCoverageConfig | undefined, loader: RuntimeCoverageModuleLoader, entrypoint: '/provider'): Promise<{ new(): CoverageProvider } | null>
async function resolveCoverageModule(options: SerializedCoverageConfig | undefined, loader: RuntimeCoverageModuleLoader): Promise<CoverageRuntime | null>
async function resolveCoverageModule(
  options: SerializedCoverageConfig | undefined,
  loader: RuntimeCoverageModuleLoader,
  entrypoint?: '/provider',
) {
  if (!options?.enabled || !options.provider) {
    return null
  }

  const provider = options.provider

  if (provider === 'v8' || provider === 'istanbul') {
    const builtInModule = CoverageProviderMap[provider]

    const { default: coverageModule } = await loader.executeId(`${builtInModule}${entrypoint || ''}`)

    if (!coverageModule) {
      throw new Error(
        `Failed to load ${CoverageProviderMap[provider]}${entrypoint || ''}. Default export is missing.`,
      )
    }

    return coverageModule
  }

  let customProviderModule

  try {
    customProviderModule = await loader.executeId(`${options.customProviderModule}${entrypoint || ''}`)
  }
  catch (error) {
    throw new Error(
      `Failed to load custom coverage ${entrypoint} from ${options.customProviderModule}${entrypoint || ''}`,
      { cause: error },
    )
  }

  if (customProviderModule.default == null) {
    throw new Error(
      `Custom coverage ${entrypoint} loaded from ${options.customProviderModule}${entrypoint || ''} was not the default export`,
    )
  }

  return customProviderModule.default
}
