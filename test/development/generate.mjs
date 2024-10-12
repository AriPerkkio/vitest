import { mkdirSync, rmSync, writeFileSync } from 'node:fs'

const COUNT = 50
const DELAY_MS = 10

rmSync('test', { recursive: true, force: true })
mkdirSync('test')

for (const _index of Array.from({ length: COUNT }).fill().keys()) {
  const index = 1 + _index
  const content = testTemplate(index)

  writeFileSync(`./test/example-${index}.test.ts`, content, 'utf-8')
}

function testTemplate(index) {
  return `// Generated
import { test } from 'vitest'

test('fixture ${index}.1', async () => {
  await new Promise(resolve => setTimeout(resolve, ${DELAY_MS}))
})

test('fixture ${index}.2', async () => {
  await new Promise(resolve => setTimeout(resolve, ${DELAY_MS}))
})

test('fixture ${index}.3', async () => {
  await new Promise(resolve => setTimeout(resolve, ${DELAY_MS}))
})

 test('fixture ${index}.4', async () => {
   await new Promise(resolve => setTimeout(resolve, ${DELAY_MS}))
 })

 test('fixture ${index}.5', async () => {
   await new Promise(resolve => setTimeout(resolve, ${DELAY_MS}))
 })
`
}
