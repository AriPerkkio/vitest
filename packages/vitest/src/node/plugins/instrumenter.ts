import type { Plugin as VitePlugin } from 'vite'

import type { Vitest } from '../core'

export function InstrumenterPlugin(ctx: Vitest): VitePlugin | null {
  // TODO: This would be great but ctx has not yet been initialized
  // // Skip coverage reporters which do not need code transforms, e.g. native v8
  // if (typeof ctx.coverageReporter.instrument !== 'function')
  //   return null

  return {
    name: 'vitest:instrumenter',

    config(config) {
      ctx.coverageReporter.processUserConfig(config)
    },

    transform(srcCode, id) {
      return ctx.coverageReporter.instrument?.(srcCode, id, this)
    },
  }
}
