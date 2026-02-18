import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],

      commands: {
        async waitForNetwork(ctx) {
          // Playwright APIs typed
          await ctx.page.waitForLoadState('networkidle')
        },

        async interceptFetch(ctx) {
          const session = await ctx.provider.getCDPSession(ctx.sessionId)

          session.on('Fetch.requestPaused', async (event) => {
            const url = event.request.url
            //                ^^^^^^^ Property 'request' does not exist on type 'unknown'
          })
        },
      },
    },
  },
})

declare module 'vitest/browser' {
  interface BrowserCommands {
    waitForNetwork: () => Promise<void>
    interceptFetch: () => Promise<void>
  }
}
