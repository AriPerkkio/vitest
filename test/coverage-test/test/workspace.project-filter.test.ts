import { expect } from 'vitest'
import { readCoverageMap, runVitest, test } from '../utils'

test('coverage files include all projects', async () => {
  await runVitest({
    config: '../../configs/vitest.config.workspace.ts',
    coverage: {
      reporter: 'json',
      include: ['**/src/**'],
    },
    root: 'fixtures/workspaces/project',
  })

  const coverageMap = await readCoverageMap('fixtures/workspaces/project/coverage/coverage-final.json')
  const files = coverageMap.files()

  // All files from workspace should be picked
  expect(files).toMatchInlineSnapshot(`
    [
      "<process-cwd>/fixtures/workspaces/project/proj/src/example.ts",
      "<process-cwd>/fixtures/workspaces/project/project1/src/id.ts",
      "<process-cwd>/fixtures/workspaces/project/project1/src/untested.ts",
      "<process-cwd>/fixtures/workspaces/project/project2/src/konst.ts",
      "<process-cwd>/fixtures/workspaces/project/project2/src/untested.ts",
      "<process-cwd>/fixtures/workspaces/project/shared/src/utils.ts",
    ]
  `)
})

test('coverage files limited to specified project', async () => {
  await runVitest({
    config: '../../configs/vitest.config.workspace.ts',
    coverage: {
      reporter: 'json',
      include: ['**/src/**'],
    },
    project: 'project2',
    root: 'fixtures/workspaces/project',
  })

  const coverageMap = await readCoverageMap('fixtures/workspaces/project/coverage/coverage-final.json')
  const files = coverageMap.files()

  expect(files).toMatchInlineSnapshot(`
    [
      "<process-cwd>/fixtures/workspaces/project/project2/src/konst.ts",
      "<process-cwd>/fixtures/workspaces/project/project2/src/untested.ts",
    ]
  `)
})

test('coverage files limited to a single project name that matches multiple ones (#9275)', async () => {
  await runVitest({
    config: '../../configs/vitest.config.workspace.ts',
    coverage: {
      reporter: 'json',
      include: ['**/src/**'],
    },
    project: 'root-collison',
    root: 'fixtures/workspaces/project',
  })

  const coverageMap = await readCoverageMap('fixtures/workspaces/project/coverage/coverage-final.json')
  const files = coverageMap.files()

  // Expected: only project/proj/src files
  // Based on #9275 we should see project1/src and project2/src files too
  expect(files).toMatchInlineSnapshot(`
    [
      "<process-cwd>/fixtures/workspaces/project/proj/src/example.ts",
    ]
  `)
})
