/**
 * The model the lab runs on, behind a small port: the domain never calls a provider itself. The app's server builds {@link envModel}, which reads an
 * OpenAI-compatible endpoint and key from the environment; tests pass {@link fakeModel}. A model that is not configured says so instead of failing
 * silently: the page then keeps its seeded results and names the setting to add.
 */
import { LabError as LabFailure } from './domain.ts'

export interface ModelRequest {
  readonly model: string
  readonly system: string
  readonly user: string
  readonly temperature: number
}

export interface ModelResult {
  readonly text: string
  readonly tokens: number
  readonly durationMs: number
}

export interface ModelClient {
  /** False when no key is set: the page says so and a run is refused with {@link modelNotConfigured}. */
  readonly configured: boolean
  readonly provider: string
  /** The model names the settings page offers. */
  readonly models: readonly string[]
  complete(request: ModelRequest): Promise<ModelResult>
}

export const DEEPSEEK_BASE = 'https://api.deepseek.com/v1'
export const DEFAULT_MODELS = ['deepseek-chat', 'deepseek-reasoner'] as const

/** The message a page shows when a run needs a key. */
export function modelNotConfigured(): LabFailure {
  return new LabFailure(
    'model',
    'No model is configured. Set DEEPSEEK_API_KEY (and optionally PROMPT_LAB_BASE_URL and PROMPT_LAB_MODELS) and restart the app to run live; the results below are seeded examples.',
  )
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** The OpenAI-compatible endpoint the environment names; configured only when it has a key. */
export function envModel(env: Readonly<Record<string, string | undefined>> = process.env, fetcher: FetchLike = (input, init) => fetch(input, init)): ModelClient {
  const key = env.DEEPSEEK_API_KEY ?? env.PROMPT_LAB_API_KEY ?? ''
  const base = (env.PROMPT_LAB_BASE_URL ?? DEEPSEEK_BASE).replace(/\/$/u, '')
  const models = (env.PROMPT_LAB_MODELS ?? DEFAULT_MODELS.join(','))
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')
  return {
    configured: key !== '',
    provider: 'DeepSeek-compatible',
    models: models.length === 0 ? [...DEFAULT_MODELS] : models,
    async complete(request) {
      if (key === '') throw modelNotConfigured()
      const started = Date.now()
      const response = await fetcher(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: request.model,
          temperature: request.temperature,
          messages: [
            { role: 'system', content: request.system },
            { role: 'user', content: request.user },
          ],
        }),
      })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new LabFailure('model', `The model answered HTTP ${String(response.status)}${detail === '' ? '' : `: ${detail.slice(0, 200)}`}.`)
      }
      const body = (await response.json()) as {
        choices?: { message?: { content?: unknown } }[]
        usage?: { total_tokens?: unknown }
      }
      const text = body.choices?.[0]?.message?.content
      if (typeof text !== 'string')
        throw new LabFailure('model', 'The model answered without a message.')
      return {
        text,
        tokens: typeof body.usage?.total_tokens === 'number' ? body.usage.total_tokens : 0,
        durationMs: Date.now() - started,
      }
    },
  }
}

/** A model that answers from a fixed map (by model name) or one text; the tests' stand-in for a provider. */
export function fakeModel(answers: string | Readonly<Record<string, string>>, options: { readonly tokens?: number; readonly durationMs?: number } = {}): ModelClient {
  const answer = (model: string): string => (typeof answers === 'string' ? answers : answers[model] ?? answers.default ?? `Answer from ${model}`)
  return {
    configured: true,
    provider: 'Fake model',
    models: typeof answers === 'string' ? ['fake-model'] : Object.keys(answers).filter((name) => name !== 'default'),
    async complete(request) {
      const text = answer(request.model)
      return {
        text,
        tokens: options.tokens ?? text.split(/\s+/u).length,
        durationMs: options.durationMs ?? 12,
      }
    },
  }
}
