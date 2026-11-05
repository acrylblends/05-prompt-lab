/**
 * The one door to a model, so the lab never calls the network itself and tests hand in a fake. Two kinds answer it:
 *
 * - `sample` writes a short draft offline from the inputs. It needs no account and no key, so a first start works; it is a stand-in, not a model, and the
 *   page says so.
 * - `openai-compatible` posts to `<baseUrl>/chat/completions`, which also covers a local server. The key is read from the environment at run time and is
 *   never written to the data file.
 */
import type { Model } from './domain.ts'
import { estimateTokens } from './domain.ts'

export interface CompletionRequest {
  readonly model: Model
  readonly system: string
  readonly user: string
  readonly temperature: number
  readonly inputs: Readonly<Record<string, string>>
}

export interface Completion {
  readonly text: string
  readonly tokens: number
}

export type Complete = (request: CompletionRequest) => Promise<Completion>

/** Why a model cannot run, in words for the page; undefined when it can. */
export function modelProblem(model: Model, env: Readonly<Record<string, string | undefined>>): string | undefined {
  if (model.provider === 'sample') return undefined
  if (model.baseUrl === undefined || model.baseUrl === '') return `${model.name} has no address yet. Add one in Models.`
  if (model.keyEnv !== undefined && model.keyEnv !== '' && (env[model.keyEnv] ?? '') === '')
    return `${model.name} needs its key: set ${model.keyEnv} in the environment and start the app again.`
  return undefined
}

/** A draft from the inputs: `crisp` is short, any other sample is longer. Same inputs, same draft. */
export function sampleText(modelId: string, inputs: Readonly<Record<string, string>>, user: string): string {
  const values = Object.values(inputs).map((value) => value.trim()).filter((value) => value !== '')
  const subject = values[0] ?? user.split('\n')[0]?.trim().slice(0, 60) ?? 'This'
  const who = values[1] ?? 'your team'
  const gain = values[2] ?? 'get the work done'
  const lower = `${gain.charAt(0).toLowerCase()}${gain.slice(1)}`
  if (modelId.includes('crisp'))
    return `${subject}: less effort, clear results.\n\n${subject} helps ${who} ${lower}.\n\n- Built for ${who}\n- Focused on one job: ${lower}\n- Ready to try today`
  return `Why ${subject} is worth a look.\n\n${subject} is made for ${who}. It takes on the routine part of the work, so people can ${lower} without extra steps, and every step stays visible.\n\n- Starts from what ${who} already do\n- Keeps the goal in view: ${lower}\n- Shows progress at each step\n- Easy to adjust later`
}

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))

export interface ModelClientOptions {
  readonly fetcher?: typeof fetch
  readonly env?: Readonly<Record<string, string | undefined>>
  /** How long a sample takes, so its pending state can be seen. */
  readonly sampleDelayMs?: number
  /** How long a provider may take. */
  readonly timeoutMs?: number
}

interface ChatResponse {
  readonly choices?: readonly { readonly message?: { readonly content?: unknown } }[]
  readonly usage?: { readonly total_tokens?: unknown }
}

export function modelClient(options: ModelClientOptions = {}): Complete {
  const fetcher = options.fetcher ?? fetch
  const env = options.env ?? process.env
  return async ({ model, system, user, temperature, inputs }) => {
    if (model.provider === 'sample') {
      await wait(options.sampleDelayMs ?? 700)
      const text = sampleText(model.id, inputs, user)
      return { text, tokens: estimateTokens(`${system}${user}${text}`) }
    }
    const key = model.keyEnv === undefined || model.keyEnv === '' ? undefined : env[model.keyEnv]
    const response = await fetcher(`${(model.baseUrl ?? '').replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key === undefined ? {} : { authorization: `Bearer ${key}` }) },
      body: JSON.stringify({
        model: model.model,
        temperature,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
    })
    if (!response.ok) throw new Error(`${model.name} answered ${response.status}.`)
    const body = (await response.json()) as ChatResponse
    const text = body.choices?.[0]?.message?.content
    if (typeof text !== 'string' || text === '') throw new Error(`${model.name} sent back no text.`)
    const tokens = body.usage?.total_tokens
    return { text, tokens: typeof tokens === 'number' ? tokens : estimateTokens(`${system}${user}${text}`) }
  }
}
