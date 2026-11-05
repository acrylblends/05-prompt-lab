/**
 * Prompt Lab's data and its pure rules: what a prompt, a version, a model, a run and an evaluation are, how `{{variables}}` are found and filled, how tokens
 * are estimated. Nothing here touches the clock, the disk or the network.
 */

export type RunStatus = 'pending' | 'done' | 'failed'
export type Slot = 'A' | 'B'
export type TokenState = 'ok' | 'warn' | 'over'

export interface Prompt {
  readonly id: string
  readonly name: string
  readonly description: string
  /** The working copy: what the editor shows, saved or not. */
  readonly systemText: string
  readonly userTemplate: string
  readonly tags: readonly string[]
  /** The last values typed for the variables, by variable name. */
  readonly inputs: Readonly<Record<string, string>>
  /** The latest saved revision; 0 before the first save. */
  readonly version: number
  readonly updatedAt: string
}

export interface PromptVersion {
  readonly id: string
  readonly promptId: string
  readonly revision: number
  readonly systemText: string
  readonly userTemplate: string
  readonly note: string
  readonly createdAt: string
}

export interface Model {
  readonly id: string
  readonly name: string
  /** `sample` writes offline from the inputs; `openai-compatible` calls `baseUrl`. */
  readonly provider: 'sample' | 'openai-compatible'
  /** The model id sent to the provider. */
  readonly model: string
  readonly baseUrl?: string
  /** The name of the environment variable that holds the key. The key itself is never stored. */
  readonly keyEnv?: string
  readonly contextTokens: number
  /** Euro per 1,000 tokens. */
  readonly costPer1k: number
}

export interface Run {
  readonly id: string
  /** The runs started together share it. */
  readonly comparisonId: string
  readonly slot: Slot
  readonly promptId: string
  /** The version the run used; absent when it ran an unsaved draft. */
  readonly promptVersionId?: string
  readonly modelId: string
  readonly modelName: string
  readonly temperature: number
  readonly inputs: Readonly<Record<string, string>>
  readonly systemText: string
  readonly userTemplate: string
  /** The prompt as sent, variables filled. */
  readonly userText: string
  readonly output: string
  readonly tokens: number
  readonly durationMs: number
  readonly cost: number
  readonly status: RunStatus
  readonly error?: string
  readonly createdAt: string
}

export interface Evaluation {
  readonly id: string
  readonly runId: string
  readonly criterion: string
  /** 1 to 5. */
  readonly rating: number
  readonly note: string
  readonly createdAt: string
}

export interface LabState {
  readonly version: 1
  prompts: Prompt[]
  versions: PromptVersion[]
  models: Model[]
  runs: Run[]
  evaluations: Evaluation[]
}

export type LabErrorCode = 'invalid' | 'not-found' | 'missing-variable' | 'not-configured' | 'token-limit'

/** A refusal a person can act on; its message is shown to them. */
export class LabError extends Error {
  readonly code: LabErrorCode

  constructor(code: LabErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'LabError'
  }
}

/** The criterion a quick "A is better" writes. */
export const PREFERRED = 'Preferred'
export const CRITERIA = ['Clarity', 'Accuracy', 'Tone', 'Concreteness'] as const
export const MAX_TEMPERATURE = 2
/** From this share of the model's context on, the editor warns. */
export const TOKEN_WARN_SHARE = 0.8

const pad = (n: number): string => String(n).padStart(2, '0')

/** `2026-11-05` for a local date. */
export function dayOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** `2026-11-05T08:40` for a local date-time. */
export function stampOf(date: Date): string {
  return `${dayOf(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return dayOf(new Date(y, m - 1, d + days))
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `Today, 13:42`, `Yesterday, 09:10` or `Oct 30, 10:00`. */
export function whenText(stamp: string, today: string): string {
  const day = stamp.slice(0, 10)
  const time = stamp.slice(11, 16)
  if (day === today) return `Today, ${time}`
  if (day === addDays(today, -1)) return `Yesterday, ${time}`
  return `${MONTHS[Number(day.slice(5, 7)) - 1]} ${Number(day.slice(8, 10))}, ${time}`
}

/** The names in `{{name}}`, in order of first use. */
export function variablesIn(...templates: readonly string[]): string[] {
  const names = templates.flatMap((text) => [...text.matchAll(/\{\{\s*([A-Za-z_]\w*)\s*\}\}/g)].map((match) => match[1] as string))
  return [...new Set(names)]
}

/** The template with its variables filled; a variable with no value stays as it is written. */
export function render(template: string, inputs: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{\s*([A-Za-z_]\w*)\s*\}\}/g, (whole, name: string) => {
    const value = inputs[name]?.trim()
    return value === undefined || value === '' ? whole : value
  })
}

/** `product_name` as a person reads it: `Product name`. */
export function labelOf(variable: string): string {
  const words = variable.replaceAll('_', ' ').trim()
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`
}

/** A rough count, about four characters a token: good enough to warn, and it needs no tokenizer. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

export function tokenState(tokens: number, limit: number): TokenState {
  if (tokens > limit) return 'over'
  return tokens >= limit * TOKEN_WARN_SHARE ? 'warn' : 'ok'
}

export function cleanText(value: unknown, label: string, max: number, required = true): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (required && text === '') throw new LabError('invalid', `${label} is required.`)
  if (text.length > max) throw new LabError('invalid', `${label} must be at most ${max.toLocaleString('en-US')} characters.`)
  return text
}

export function cleanTemperature(value: unknown): number {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
  if (!Number.isFinite(number) || number < 0 || number > MAX_TEMPERATURE) throw new LabError('invalid', `Temperature must be a number from 0 to ${MAX_TEMPERATURE}.`)
  return number
}

export function cleanRating(value: unknown): number {
  const number = typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isInteger(number) || number < 1 || number > 5) throw new LabError('invalid', 'A rating is a whole number from 1 to 5.')
  return number
}

export function cleanTags(value: unknown): string[] {
  const text = typeof value === 'string' ? value : ''
  return [...new Set(text.split(',').map((tag) => tag.trim()).filter((tag) => tag !== ''))]
}
