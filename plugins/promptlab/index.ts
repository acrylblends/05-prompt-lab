/**
 * The lab as a plugin: it opens the prompts, versions, runs and evaluations over the app's data home (`<home>/prompt-lab.json`) and provides them as
 * `ctx.lab`. The model is a port on config: the server builds the environment model, tests pass a fake. Every page plugin injects `lab`.
 */
import { randomUUID } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { LabState } from './domain.ts'
import { Lab, type LabAdapters } from './lab.ts'
import { envModel, type ModelClient } from './model.ts'
import { jsonFileStore, type Store } from './store.ts'

export * from './domain.ts'
export * from './lab.ts'
export * from './model.ts'
export * from './store.ts'
export { seed } from './seed.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    lab: Lab
  }
}

export interface LabConfig {
  readonly store?: Store<LabState>
  readonly clock?: () => Date
  readonly newId?: LabAdapters['newId']
  readonly model?: ModelClient
  readonly file?: string
}

export const DEFAULT_FILE = 'prompt-lab.json'

export const name = 'promptlab'
export const inject = ['appInstance']

export async function apply(ctx: Context, config: LabConfig = {}): Promise<void> {
  const file = config.file ?? DEFAULT_FILE
  const lab = await Lab.open({
    store:
      config.store ??
      jsonFileStore<LabState>(isAbsolute(file) ? file : join(ctx.appInstance.home, file), 'Prompt Lab'),
    clock: config.clock ?? (() => new Date()),
    newId: config.newId ?? ((kind) => `${kind}-${randomUUID().slice(0, 8)}`),
    model: config.model ?? envModel(),
  })
  ctx.provide('lab', lab)
}
