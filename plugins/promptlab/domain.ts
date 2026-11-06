/**
 * Prompt Lab's types and pure rules: what a prompt, a version, a run and an evaluation are, how variables are read and filled, and what a prompt
 * form refuses. No clock, no disk, no model: the {@link Lab} class applies these rules to the saved state.
 */

export interface Prompt {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly systemText: string
  readonly userTemplate: string
  /** The `{{name}}` placeholders in the user template, in first-appearance order. */
  readonly variables: readonly string[]
  readonly tags: readonly string[]
  /** The current revision number; a saved version is a row in the versions list. */
  readonly version: number
  readonly createdAt: string
  readonly updatedAt: string
}

export interface PromptVersion {
  readonly id: string
  readonly promptId: string
  readonly revision: number
  /** The system and user text at that revision, as one text. */
  readonly content: string
  readonly createdAt: string
}

export type RunStatus = 'pending' | 'done' | 'failed'

export interface Run {
  readonly id: string
  readonly promptId: string
  readonly promptVersionId: string
  readonly model: string
  readonly inputs: Readonly<Record<string, string>>
  readonly output: string
  readonly tokens: number
  readonly durationMs: number
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
  readonly at: string
}

export interface LabState {
  readonly version: 1
  prompts: Prompt[]
  versions: PromptVersion[]
  runs: Run[]
  evaluations: Evaluation[]
}

export interface PromptInput {
  readonly name: string
  readonly description: string
  readonly systemText: string
  readonly userTemplate: string
  readonly tags: string | readonly string[]
}

export type LabErrorCode = 'invalid' | 'not-found' | 'conflict' | 'model'

/** A refusal written for the person who typed it. */
export class LabError extends Error {
  readonly code: LabErrorCode

  constructor(code: LabErrorCode, message: string) {
    super(message)
    this.code = code
    this.name = 'LabError'
  }
}

const pad = (n: number): string => String(n).padStart(2, '0')

export function dayOf(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** `2026-11-06T09:41` for a local date-time. */
export function stampOf(date: Date): string {
  return `${dayOf(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** `09:41` from a stamp, for the run cards. */
export function timeOf(stamp: string): string {
  return stamp.slice(11, 16)
}

/** `2h ago`, `Yesterday`, `31 Oct`. */
export function whenText(stamp: string, now: Date): string {
  const then = new Date(stamp)
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  if (hours < 48) return 'Yesterday'
  if (then.getFullYear() === now.getFullYear())
    return then.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })
  return then.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function cleanText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string') throw new LabError('invalid', `${field} is missing.`)
  const text = value.trim()
  if (text === '') throw new LabError('invalid', `${field} is required.`)
  if (text.length > max) throw new LabError('invalid', `${field} is longer than ${String(max)} characters.`)
  return text
}

/** Tags as typed (`marketing, copy` or one per item), trimmed, lower-cased, without duplicates. */
export function tagsOf(value: string | readonly string[]): string[] {
  const parts: readonly string[] = typeof value === 'string' ? value.split(',') : value
  const tags: string[] = []
  for (const part of parts) {
    const tag = part.trim().toLowerCase()
    if (tag !== '' && !tags.includes(tag)) tags.push(tag)
  }
  return tags
}

/** `{{product_name}}` become their trimmed names, each once, in first-appearance order. */
export function variablesOf(text: string): string[] {
  const names: string[] = []
  for (const match of text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/gu)) {
    const name = match[1]?.trim() ?? ''
    if (name !== '' && !names.includes(name)) names.push(name)
  }
  return names
}

/** The variables with no value in the form. */
export function missingVariables(template: string, inputs: Readonly<Record<string, string>>): string[] {
  return variablesOf(template).filter((name) => (inputs[name] ?? '').trim() === '')
}

/** The template with its placeholders replaced; a placeholder with no value is left as it is. */
export function fillTemplate(template: string, inputs: Readonly<Record<string, string>>): string {
  return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/gu, (whole, name: string) => (inputs[name] ?? '').trim() || whole)
}

export interface PromptFilter {
  readonly q?: string
  readonly tag?: string
}

/** The prompts matching the filter, most recently changed first. */
export function filterPrompts(state: LabState, filter: PromptFilter = {}): Prompt[] {
  const q = (filter.q ?? '').trim().toLowerCase()
  return state.prompts
    .filter((prompt) => {
      if (filter.tag !== undefined && !prompt.tags.includes(filter.tag)) return false
      if (q === '') return true
      return [prompt.name, prompt.description, prompt.systemText, prompt.userTemplate, ...prompt.tags]
        .join('\n')
        .toLowerCase()
        .includes(q)
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.name.localeCompare(b.name))
}

/** The run's output as the result card shows it: a heading and bullet list are read from the text's own lines. */
export interface OutputView {
  readonly headline: string
  readonly paragraphs: readonly string[]
  readonly bullets: readonly string[]
}

export function outputView(text: string): OutputView {
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line !== '')
  const bullets = lines.filter((line) => /^[-*•]\s+/u.test(line)).map((line) => line.replace(/^[-*•]\s+/u, ''))
  const rest = lines.filter((line) => !/^[-*•]\s+/u.test(line))
  return { headline: rest[0] ?? '', paragraphs: rest.slice(1), bullets }
}

/** The prompt form's rules, as a value the page can show. */
export function validatePrompt(input: PromptInput): {
  name: string
  description: string
  systemText: string
  userTemplate: string
  tags: string[]
  variables: string[]
} {
  const name = cleanText(input.name, 'Name', 120).replace(/\s+/gu, ' ')
  const description = cleanText(input.description, 'Description', 300)
  const systemText = cleanText(input.systemText, 'System instruction', 4000)
  const userTemplate = cleanText(input.userTemplate, 'User prompt', 8000)
  const tags = tagsOf(input.tags)
  if (tags.length > 8) throw new LabError('invalid', 'Use at most 8 tags.')
  if (tags.some((tag) => tag.length > 30)) throw new LabError('invalid', 'A tag is longer than 30 characters.')
  return { name, description, systemText, userTemplate, tags, variables: variablesOf(userTemplate) }
}

/** The provider label the model settings page shows. */
export const PROVIDER = 'OpenAI-compatible'

/** One 1-5 rating as a word. */
export function ratingText(rating: number): string {
  return ['', 'Poor', 'Fair', 'Good', 'Strong', 'Excellent'][rating] ?? String(rating)
}
