import MagicString from 'magic-string'
import { defineProject } from 'vitest/config'

export default defineProject({
  plugins: [
    {
      name: 'custom:workspace-3',
      transform(code, id) {
        if (id.endsWith('multiple-transforms.ts')) {
          const s = new MagicString(code)
          const start = code.indexOf('//! WORKSPACE_3_REMOVE_START')
          const end = code.indexOf('//! WORKSPACE_3_REMOVE_END')

          s.remove(start, end + '//! WORKSPACE_3_REMOVE_END'.length)
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
    include: ['**/*.space-3-test.ts'],
    name: 'space_3',
    environment: 'node',
  },
})
