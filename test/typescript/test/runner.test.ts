import { resolve } from 'pathe'
import { execa } from 'execa'
import { describe, it } from 'vitest'

describe('should fail', async () => {
  const root = resolve(__dirname, '../failing')

  it('typecheck files', async () => {
    const { stdout, stderr } = await execa('npx', [
      'vitest',
      'typecheck',
      '--run',
      '--dir',
      resolve(__dirname, '..', './failing'),
      '--config',
      resolve(__dirname, './vitest.config.ts'),
    ], {
      cwd: root,
      reject: false,
      env: {
        ...process.env,
        CI: 'true',
        NO_COLOR: 'true',
      },
    })

    // eslint-disable-next-line no-console
    console.log('runner.test::stdout', stdout)

    // eslint-disable-next-line no-console
    console.log('runner.test::stderr', stderr)
  }, 30_000)
})
