import type { File, TaskResultPack } from '@vitest/runner'
import type { Vitest } from '../core'
import type { Reporter } from '../types/reporter'
import type { TestCase } from './reported-tasks'

export class NewReporterAPI implements Reporter {
  ctx!: Vitest

  onTestPrepare(_: TestCase) {}
  onTestFinished(_: TestCase) {}
  onTestFileFinished(_: File) {}
  onTestFailed(_: TestCase) {}

  onTaskUpdate(packs: TaskResultPack[]) {
    const entities = this.unpack(packs)

    if (entities.length === 0) {
      this.ctx.logger.console.log(packs)
    }

    for (const entity of entities) {
      if (entity?.type === 'test') {
        const result = entity.result()

        if (!result) {
          this.onTestPrepare(entity)
        }
        else if (result.state === 'passed') {
          this.onTestFinished(entity)
        }
        else if (result.state === 'failed') {
          this.onTestFailed(entity)
        }
      }
    }
  }

  private unpack(packs: TaskResultPack[]) {
    const entities: (ReturnType<typeof this.ctx.state.getReportedEntity>)[] = []

    for (const [id] of packs) {
      const task = this.ctx.state.idMap.get(id)

      if (task) {
        const entity = this.ctx.state.getReportedEntity(task)

        if (entity) {
          entities.push(entity)
        }
      }
    }

    return entities
  }
}
