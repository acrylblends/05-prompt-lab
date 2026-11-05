/**
 * What every route test shares: the app booted in process (no port) over a throwaway home, with the lab's outside effects faked (a memory store, a fixed
 * clock, counted ids, a model that answers at once), so a test sees the seed as a person sees it on Thursday 5 November 2026 at 08:40.
 */
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { type Complete, type LabState, memoryStore } from '../plugins/lab/index.ts'
import { pinnedInstance, withPort } from '../plugins/instance/index.ts'
import { type App, type AppOptions, createApp } from '../src/app.ts'

export const projectRoot = fileURLToPath(new URL('..', import.meta.url))

/** Throwaway homes live inside the project (`.acrylblends/` is ignored by git): a sandboxed agent may not write to the system temp folder. */
const scratch = join(projectRoot, '.acrylblends', 'test')
mkdirSync(scratch, { recursive: true })

/** The tests' "now": Thursday 5 November 2026, 08:40 local time. */
export const NOW = new Date(2026, 10, 5, 8, 40)

/** A model that answers at once with its own name. */
export const fakeComplete: Complete = async ({ model, user }) => ({ text: `From ${model.name}\n\n${user}`, tokens: 40 })

/** A model that answers only when `release` is called, so a test can see a run pending. */
export function heldComplete(): { complete: Complete; release: () => void } {
  let release = (): void => undefined
  const gate = new Promise<void>((done) => {
    release = done
  })
  return {
    complete: async (request) => {
      await gate
      return fakeComplete(request)
    },
    release: () => release(),
  }
}

export interface TestApp extends App {
  readonly store: ReturnType<typeof memoryStore<LabState>>
  page(path: string): Promise<{ status: number; html: string }>
  /** POST a form (urlencoded) as a browser on this site does, without following the redirect. */
  post(path: string, fields: Record<string, string>, headers?: Record<string, string>): Promise<Response>
}

export interface TestOptions extends AppOptions {
  readonly state?: LabState
  readonly complete?: Complete
  readonly env?: Readonly<Record<string, string | undefined>>
}

/** Boot the app in a throwaway home, run the test, always stop it and remove the home. */
export async function withApp(run: (app: TestApp) => Promise<void>, options: TestOptions = {}): Promise<void> {
  const home = await mkdtemp(join(scratch, 'app-test-'))
  let ids = 0
  const store = memoryStore<LabState>(options.state)
  const app = await createApp(withPort(pinnedInstance(home, { root: projectRoot }), 0), {
    ...options,
    listen: false,
    overrides: {
      ...options.overrides,
      lab: { store, clock: () => NOW, newId: (kind: string) => `${kind}-${++ids}`, complete: options.complete ?? fakeComplete, env: options.env ?? {} },
    },
  })
  const prefix = options.prefix ?? ''
  const test: TestApp = {
    ...app,
    store,
    async page(path) {
      const response = await app.root.router.request(`${prefix}${path}`, { headers: { accept: 'text/html' } })
      return { status: response.status, html: await response.text() }
    },
    post(path, fields, headers = {}) {
      return Promise.resolve(
        app.root.router.request(`${prefix}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'text/html', origin: 'http://localhost', ...headers },
          body: new URLSearchParams(fields).toString(),
        }),
      )
    },
  }
  try {
    await run(test)
  } finally {
    await app.root.lab?.settled()
    await app.stop()
    await rm(home, { recursive: true, force: true })
  }
}

/** The notice text a redirect carries (`?ok=` / `?error=` / `?warn=`). */
export function noticeOf(response: Response): { kind: string; text: string; path: string } {
  const location = response.headers.get('location') ?? ''
  const url = new URL(location, 'http://local')
  for (const kind of ['ok', 'error', 'warn']) {
    const text = url.searchParams.get(kind)
    if (text !== null) return { kind, text, path: url.pathname }
  }
  return { kind: '', text: '', path: url.pathname }
}
