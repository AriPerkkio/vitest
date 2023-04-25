import { defineProject } from 'vitest/config'
import MagicString from 'magic-string'

export default defineProject({
  plugins: [
    {
      name: 'custom:workspace-1',
      transform(code, id) {
        if (id.endsWith('multiple-transforms.ts')) {
          const s = new MagicString(code)
          const start = code.indexOf('//! WORKSPACE_1_REMOVE_START')
          const end = code.indexOf('//! WORKSPACE_1_REMOVE_END')

          s.remove(start, end + '//! WORKSPACE_1_REMOVE_END'.length)
          return {
            code: s.toString(),
            map: s.generateMap({
              hires: true,
              source: id,
            }),
          }
        }
      },
    },
  ],
  test: {
    name: 'space_1',
    environment: 'happy-dom',
  },
})
