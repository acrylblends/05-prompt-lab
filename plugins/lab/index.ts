/**
 * Prompt Lab's domain as a plugin: it opens the lab over the app's data home (`<home>/prompt-lab.json`) and provides it as `ctx.lab`. Every page plugin
 * injects `lab`, so switching this row off takes every page with it.
 *
 * Config (all optional, for tests and for a different home): `store`, `clock`, `newId`, `complete` (how a model is called), `env` (where a key is read from),
 * `file` (the JSON file, relative to the app's home).
 */
import { randomUUID } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '../instance/index.ts'
import type { LabState } from './domain.ts'
import { Lab, type LabAdapters } from './lab.ts'
import { modelClient } from './models.ts'
import { jsonFileStore, type Store } from './store.ts'

export * from './domain.ts'
export * from './lab.ts'
export * from './models.ts'
export { seed } from './seed.ts'
export * from './store.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    lab: Lab
  }
}

export interface LabConfig {
  readonly store?: Store<LabState>
  readonly clock?: () => Date
  readonly newId?: LabAdapters['newId']
  readonly complete?: LabAdapters['complete']
  readonly env?: LabAdapters['env']
  readonly file?: string
}

export const DEFAULT_FILE = 'prompt-lab.json'

export const name = 'lab'
export const inject = ['appInstance']

export async function apply(ctx: Context, config: LabConfig = {}): Promise<void> {
  const file = config.file ?? DEFAULT_FILE
  const lab = await Lab.open({
    store: config.store ?? jsonFileStore<LabState>(isAbsolute(file) ? file : join(ctx.appInstance.home, file), 'Prompt Lab'),
    clock: config.clock ?? (() => new Date()),
    newId: config.newId ?? ((kind) => `${kind}-${randomUUID().slice(0, 8)}`),
    complete: config.complete ?? modelClient({ env: config.env ?? process.env }),
    env: config.env ?? process.env,
  })
  ctx.provide('lab', lab)
}
