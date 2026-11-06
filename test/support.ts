/**
 * What every route test shares: the app booted in process (no port) over a throwaway home, with the lab's outside effects faked (a memory store, a
 * fixed clock, counted ids, a fake model), so a test sees the seed exactly as a person sees it on Friday 6 November 2026 at 09:41.
 */
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LabState } from '../plugins/promptlab/domain.ts'
import { fakeModel, type ModelClient } from '../plugins/promptlab/model.ts'
import { memoryStore } from '../plugins/promptlab/store.ts'
import { pinnedInstance, withPort } from '../plugins/instance/index.ts'
import { type App, type AppOptions, createApp } from '../src/app.ts'

export const projectRoot = fileURLToPath(new URL('..', import.meta.url))

/** Throwaway homes live inside the project (`.acrylblends/` is ignored by git): a sandboxed agent may not write to the system temp folder. */
const scratch = join(projectRoot, '.acrylblends', 'test')
mkdirSync(scratch, { recursive: true })

// The app stores wall-clock stamps; pin the zone so a fixture means the same time on every machine.
process.env.TZ = 'UTC'

/** The tests' "now": Friday 6 November 2026, 09:41 local time. */
export const NOW = new Date(2026, 10, 6, 9, 41)

export interface TestApp extends App {
  readonly store: ReturnType<typeof memoryStore<LabState>>
  page(path: string): Promise<{ status: number; html: string; response: Response }>
  post(path: string, fields: Record<string, string>): Promise<Response>
}

export interface TestOptions extends AppOptions {
  readonly state?: LabState
}

/** Boot the app in a throwaway home, run the test, always stop it and remove the home. */
export async function withApp(run: (app: TestApp) => Promise<void>, options: TestOptions = {}): Promise<void> {
  const home = await mkdtemp(join(scratch, 'app-test-'))
  let ids = 0
  const store = memoryStore<LabState>(options.state)
  const defaultModel: ModelClient = fakeModel({ 'fake-model': 'A concise answer.\n\n- One benefit.\n- Another benefit.' })
  const app = await createApp(withPort(pinnedInstance(home, { root: projectRoot }), 0), {
    ...options,
    listen: false,
    overrides: {
      ...options.overrides,
      promptlab: {
        store,
        clock: () => NOW,
        newId: (kind: string) => `${kind}-${++ids}`,
        model: defaultModel,
        ...options.overrides?.promptlab,
      },
    },
  })
  const prefix = options.prefix ?? ''
  const test: TestApp = {
    ...app,
    store,
    async page(path) {
      const response = await app.root.router.request(`${prefix}${path}`, { headers: { accept: 'text/html' } })
      return { status: response.status, html: await response.text(), response }
    },
    post(path, fields) {
      return Promise.resolve(
        app.root.router.request(`${prefix}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html' },
          body: new URLSearchParams(fields).toString(),
        }),
      )
    },
  }
  try {
    await run(test)
  } finally {
    await app.stop()
    await rm(home, { recursive: true, force: true })
  }
}

export function noticeOf(response: Response): { kind: string; text: string; path: string } {
  const location = response.headers.get('location') ?? ''
  const url = new URL(location, 'http://local')
  for (const kind of ['ok', 'error', 'warn']) {
    const text = url.searchParams.get(kind)
    if (text !== null) return { kind, text, path: url.pathname }
  }
  return { kind: '', text: '', path: url.pathname }
}
