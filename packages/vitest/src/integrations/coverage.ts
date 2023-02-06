import { importModule } from 'local-pkg'
import type { CoverageOptions, CoverageProvider, CoverageProviderModule } from '../types'

type Loader = (id: string) => Promise<{ default: CoverageProviderModule }>

export const CoverageProviderMap: Record<string, string> = {
  c8: '@vitest/coverage-c8',
  istanbul: '@vitest/coverage-istanbul',
}

export async function resolveCoverageProvider(provider: NonNullable<CoverageOptions['provider']>, loader: Loader) {
  const pkg = CoverageProviderMap[provider]

  if (pkg)
    return await importModule<CoverageProviderModule>(pkg)

  console.log('Importing', provider)
  const loaded = await loader(provider)
  console.log('Loaded', loaded)

  return loaded.default
}

export async function getCoverageProvider(options: CoverageOptions, loader: Loader): Promise<CoverageProvider | null> {
  if (options.enabled && options.provider) {
    const { getProvider } = await resolveCoverageProvider(options.provider, loader)
    return await getProvider()
  }
  return null
}

export async function takeCoverageInsideWorker(options: CoverageOptions, loader: Loader) {
  if (options.enabled && options.provider) {
    const { takeCoverage } = await resolveCoverageProvider(options.provider, loader)
    return await takeCoverage?.()
  }
}
