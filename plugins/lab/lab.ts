/**
 * The lab: the rules of prompts, versions, models, runs and evaluations over one state, saved through a store port. Every page plugin reaches it as `ctx.lab`.
 * A comparison starts its runs in the background and answers at once, so a page can show them pending; `settled()` lets a test wait for them.
 */
import {
  CRITERIA,
  cleanRating,
  cleanTags,
  cleanTemperature,
  cleanText,
  dayOf,
  estimateTokens,
  type Evaluation,
  labelOf,
  LabError,
  type LabState,
  type Model,
  PREFERRED,
  type Prompt,
  type PromptVersion,
  render,
  type Run,
  type Slot,
  stampOf,
  tokenState,
  variablesIn,
  whenText,
} from './domain.ts'
import { type Complete, modelProblem } from './models.ts'
import { seed } from './seed.ts'
import type { Store } from './store.ts'

export interface LabAdapters {
  readonly store: Store<LabState>
  readonly clock: () => Date
  readonly newId: (kind: string) => string
  readonly complete: Complete
  readonly env: Readonly<Record<string, string | undefined>>
}

export interface PromptDraft {
  readonly systemText: unknown
  readonly userTemplate: unknown
  readonly inputs?: Readonly<Record<string, string>>
  readonly name?: unknown
  readonly description?: unknown
  readonly tags?: unknown
}

export interface ComparisonRequest {
  readonly modelA: unknown
  readonly modelB?: unknown
  readonly temperature: unknown
}

export interface ModelInput {
  readonly name: unknown
  readonly model: unknown
  readonly baseUrl: unknown
  readonly keyEnv?: unknown
  readonly contextTokens: unknown
  readonly costPer1k?: unknown
}

export interface ScoreRow {
  readonly model: string
  readonly runs: number
  readonly rated: number
  readonly average: number | undefined
  readonly wins: number
}

export interface EvaluationRow {
  readonly evaluation: Evaluation
  readonly run: Run
  readonly prompt: Prompt
}

/** What the pages share from the domain: a page plugin imports only its types, never its files. */
export const LAB_KIT = {
  CRITERIA,
  PREFERRED,
  isRefusal: (error: unknown): error is LabError => error instanceof LabError,
  labelOf,
  tokenState,
  whenText,
}

const asNumber = (value: unknown, label: string, min: number): number => {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN
  if (!Number.isFinite(number) || number < min) throw new LabError('invalid', `${label} must be a number of at least ${min}.`)
  return number
}

export class Lab {
  readonly kit = LAB_KIT
  private readonly adapters: LabAdapters
  private readonly current: LabState
  private readonly running = new Set<Promise<void>>()
  /** Saves go one at a time: two runs can finish together, and a file store writes through one temporary file. */
  private saving: Promise<void> = Promise.resolve()

  private constructor(adapters: LabAdapters, current: LabState) {
    this.adapters = adapters
    this.current = current
  }

  /** Open the lab over what the store holds, or the seed on a first start. A run left pending by a stop can never finish, so it is marked failed. */
  static async open(adapters: LabAdapters): Promise<Lab> {
    const saved = await adapters.store.load()
    const state = saved ?? seed(adapters.clock())
    const stale = state.runs.some((run) => run.status === 'pending')
    state.runs = state.runs.map((run) => (run.status === 'pending' ? { ...run, status: 'failed', error: 'The app stopped before this run finished.' } : run))
    const lab = new Lab(adapters, state)
    if (saved === undefined || stale) await lab.commit()
    return lab
  }

  private commit(): Promise<void> {
    const next = this.saving.then(() => this.adapters.store.save(this.current))
    this.saving = next.catch(() => undefined)
    return next
  }

  private get stamp(): string {
    return stampOf(this.adapters.clock())
  }

  get today(): string {
    return dayOf(this.adapters.clock())
  }

  // Prompts

  /** The library, latest change first, narrowed by a search and a tag. */
  prompts(filter: { readonly q?: string; readonly tag?: string } = {}): readonly Prompt[] {
    const q = filter.q?.trim().toLowerCase() ?? ''
    return this.current.prompts
      .filter((prompt) => (filter.tag === undefined || filter.tag === '' ? true : prompt.tags.includes(filter.tag)))
      .filter((prompt) => q === '' || `${prompt.name} ${prompt.description} ${prompt.tags.join(' ')}`.toLowerCase().includes(q))
      .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  find(id: string): Prompt | undefined {
    return this.current.prompts.find((prompt) => prompt.id === id)
  }

  prompt(id: string): Prompt {
    const prompt = this.find(id)
    if (prompt === undefined) throw new LabError('not-found', 'That prompt no longer exists.')
    return prompt
  }

  tags(): readonly { readonly tag: string; readonly count: number }[] {
    const counts = new Map<string, number>()
    for (const prompt of this.current.prompts) for (const tag of prompt.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    return [...counts].map(([tag, count]) => ({ tag, count })).toSorted((a, b) => a.tag.localeCompare(b.tag))
  }

  variables(prompt: Prompt): readonly string[] {
    return variablesIn(prompt.systemText, prompt.userTemplate)
  }

  /** The variables the prompt uses that have no value yet. */
  missing(prompt: Prompt): readonly string[] {
    return this.variables(prompt).filter((name) => (prompt.inputs[name]?.trim() ?? '') === '')
  }

  /** The estimated size of the prompt as it would be sent. */
  tokens(prompt: Prompt): number {
    return estimateTokens(`${render(prompt.systemText, prompt.inputs)}${render(prompt.userTemplate, prompt.inputs)}`)
  }

  versions(promptId: string): readonly PromptVersion[] {
    return this.current.versions.filter((version) => version.promptId === promptId).toSorted((a, b) => b.revision - a.revision)
  }

  /** The working copy differs from the latest saved version. */
  isDirty(prompt: Prompt): boolean {
    const latest = this.versions(prompt.id)[0]
    return latest === undefined || latest.systemText !== prompt.systemText || latest.userTemplate !== prompt.userTemplate
  }

  private replacePrompt(next: Prompt): Prompt {
    this.current.prompts = this.current.prompts.map((prompt) => (prompt.id === next.id ? next : prompt))
    return next
  }

  async createPrompt(input: { readonly name: unknown; readonly description?: unknown; readonly tags?: unknown }): Promise<Prompt> {
    const prompt: Prompt = {
      id: this.adapters.newId('prompt'),
      name: cleanText(input.name, 'A name', 80),
      description: cleanText(input.description, 'A description', 200, false),
      systemText: 'You are a helpful assistant.',
      userTemplate: 'Write about {{topic}}.',
      tags: cleanTags(input.tags),
      inputs: {},
      version: 0,
      updatedAt: this.stamp,
    }
    this.current.prompts.push(prompt)
    await this.commit()
    return prompt
  }

  /** Keep the editor's text and values as the working copy; nothing becomes a version here. */
  async saveDraft(id: string, draft: PromptDraft): Promise<Prompt> {
    const prompt = this.prompt(id)
    const next = this.replacePrompt({
      ...prompt,
      name: draft.name === undefined ? prompt.name : cleanText(draft.name, 'A name', 80),
      description: draft.description === undefined ? prompt.description : cleanText(draft.description, 'A description', 200, false),
      tags: draft.tags === undefined ? prompt.tags : cleanTags(draft.tags),
      systemText: cleanText(draft.systemText, 'The system instruction', 20_000, false),
      userTemplate: cleanText(draft.userTemplate, 'The user prompt', 100_000),
      inputs: { ...prompt.inputs, ...draft.inputs },
      updatedAt: this.stamp,
    })
    await this.commit()
    return next
  }

  private addVersion(prompt: Prompt, content: { readonly systemText: string; readonly userTemplate: string }, note: string): PromptVersion {
    const version: PromptVersion = {
      id: this.adapters.newId('version'),
      promptId: prompt.id,
      revision: prompt.version + 1,
      systemText: content.systemText,
      userTemplate: content.userTemplate,
      note,
      createdAt: this.stamp,
    }
    this.current.versions.push(version)
    this.replacePrompt({ ...prompt, systemText: content.systemText, userTemplate: content.userTemplate, version: version.revision, updatedAt: version.createdAt })
    return version
  }

  async saveVersion(id: string, note?: unknown): Promise<PromptVersion> {
    const prompt = this.prompt(id)
    if (!this.isDirty(prompt)) throw new LabError('invalid', `Nothing changed since v${prompt.version}.`)
    const version = this.addVersion(prompt, prompt, cleanText(note, 'A note', 120, false))
    await this.commit()
    return version
  }

  /** Bring a saved version back into the editor as the working copy; it stays unsaved until a person saves it. */
  async restore(id: string, revision: number): Promise<Prompt> {
    const prompt = this.prompt(id)
    const version = this.versions(id).find((item) => item.revision === revision)
    if (version === undefined) throw new LabError('not-found', `This prompt has no v${revision}.`)
    const next = this.replacePrompt({ ...prompt, systemText: version.systemText, userTemplate: version.userTemplate, updatedAt: this.stamp })
    await this.commit()
    return next
  }

  /** Delete a prompt with its versions, runs and their evaluations. */
  async removePrompt(id: string): Promise<void> {
    this.prompt(id)
    const runs = new Set(this.current.runs.filter((run) => run.promptId === id).map((run) => run.id))
    this.current.prompts = this.current.prompts.filter((prompt) => prompt.id !== id)
    this.current.versions = this.current.versions.filter((version) => version.promptId !== id)
    this.current.runs = this.current.runs.filter((run) => !runs.has(run.id))
    this.current.evaluations = this.current.evaluations.filter((evaluation) => !runs.has(evaluation.runId))
    await this.commit()
  }

  // Models

  models(): readonly Model[] {
    return this.current.models
  }

  model(id: string): Model {
    const model = this.current.models.find((item) => item.id === id)
    if (model === undefined) throw new LabError('not-found', 'That model is not in the list.')
    return model
  }

  /** Why a model cannot run yet, or undefined. */
  problem(model: Model): string | undefined {
    return modelProblem(model, this.adapters.env)
  }

  /** Add a model, or change one that is not a sample. */
  async saveModel(id: string | undefined, input: ModelInput): Promise<Model> {
    if (id !== undefined && this.model(id).provider === 'sample') throw new LabError('invalid', 'A sample model cannot be changed.')
    const baseUrl = cleanText(input.baseUrl, 'The address', 300, false)
    if (baseUrl !== '' && !URL.canParse(baseUrl)) throw new LabError('invalid', 'The address must be a full URL, like http://127.0.0.1:11434/v1.')
    if (baseUrl !== '' && !/^https?:$/.test(new URL(baseUrl).protocol)) throw new LabError('invalid', 'The address must start with http or https.')
    const keyEnv = cleanText(input.keyEnv, 'The key variable', 80, false)
    if (keyEnv !== '' && !/^[A-Z][A-Z0-9_]*$/.test(keyEnv)) throw new LabError('invalid', 'The key variable is the name of an environment variable, like MY_MODEL_KEY.')
    const model: Model = {
      id: id ?? this.adapters.newId('model'),
      name: cleanText(input.name, 'A name', 60),
      provider: 'openai-compatible',
      model: cleanText(input.model, 'The model id', 120),
      contextTokens: Math.floor(asNumber(input.contextTokens, 'The context size', 1)),
      costPer1k: input.costPer1k === undefined || input.costPer1k === '' ? 0 : asNumber(input.costPer1k, 'The cost', 0),
      ...(baseUrl === '' ? {} : { baseUrl }),
      ...(keyEnv === '' ? {} : { keyEnv }),
    }
    this.current.models = id === undefined ? [...this.current.models, model] : this.current.models.map((item) => (item.id === id ? model : item))
    await this.commit()
    return model
  }

  /** Runs keep the model's name, so past results stay readable. */
  async removeModel(id: string): Promise<void> {
    if (this.model(id).provider === 'sample') throw new LabError('invalid', 'A sample model cannot be removed.')
    this.current.models = this.current.models.filter((model) => model.id !== id)
    await this.commit()
  }

  // Runs

  /** Check everything a run needs, then start one run per chosen model in the background. Answers with the comparison's id. */
  async startComparison(promptId: string, request: ComparisonRequest): Promise<string> {
    const prompt = this.prompt(promptId)
    const temperature = cleanTemperature(request.temperature)
    const ids = [request.modelA, request.modelB].filter((id): id is string => typeof id === 'string' && id !== '')
    if (ids.length === 0) throw new LabError('invalid', 'Pick a model to run.')
    const models = ids.map((id) => this.model(id))
    const missing = this.missing(prompt)
    if (missing.length > 0) throw new LabError('missing-variable', `Fill in ${missing.map(labelOf).join(', ')} before you run.`)
    for (const model of models) {
      const problem = this.problem(model)
      if (problem !== undefined) throw new LabError('not-configured', problem)
      const tokens = this.tokens(prompt)
      if (tokenState(tokens, model.contextTokens) === 'over')
        throw new LabError('token-limit', `This prompt is about ${tokens.toLocaleString('en-US')} tokens, over the ${model.contextTokens.toLocaleString('en-US')} ${model.name} can take.`)
    }
    const comparisonId = this.adapters.newId('comparison')
    const saved = this.isDirty(prompt) ? undefined : this.versions(prompt.id)[0]?.id
    const createdAt = this.stamp
    const runs = models.map((model, index): Run => ({
      id: this.adapters.newId('run'),
      comparisonId,
      slot: index === 0 ? 'A' : 'B',
      promptId: prompt.id,
      ...(saved === undefined ? {} : { promptVersionId: saved }),
      modelId: model.id,
      modelName: model.name,
      temperature,
      inputs: prompt.inputs,
      systemText: prompt.systemText,
      userTemplate: prompt.userTemplate,
      userText: render(prompt.userTemplate, prompt.inputs),
      output: '',
      tokens: 0,
      durationMs: 0,
      cost: 0,
      status: 'pending',
      createdAt,
    }))
    this.current.runs.push(...runs)
    await this.commit()
    runs.forEach((run, index) => {
      this.launch(run, models[index] as Model)
    })
    return comparisonId
  }

  private launch(run: Run, model: Model): void {
    const started = this.adapters.clock().getTime()
    const finish = async (result: Partial<Run>): Promise<void> => {
      const durationMs = this.adapters.clock().getTime() - started
      this.current.runs = this.current.runs.map((item) => (item.id === run.id ? { ...item, ...result, durationMs } : item))
      await this.commit()
    }
    const task = this.adapters
      .complete({ model, system: render(run.systemText, run.inputs), user: run.userText, temperature: run.temperature, inputs: run.inputs })
      .then(
        ({ text, tokens }) => finish({ status: 'done', output: text, tokens, cost: (tokens / 1000) * model.costPer1k }),
        (error: unknown) => finish({ status: 'failed', error: error instanceof Error ? error.message : String(error) }),
      )
      .catch((error: unknown) => console.error('prompt-lab: could not save a finished run', error))
      .finally(() => this.running.delete(task))
    this.running.add(task)
  }

  /** Resolves when no run is in flight. */
  async settled(): Promise<void> {
    await Promise.all(this.running)
  }

  run(id: string): Run | undefined {
    return this.current.runs.find((run) => run.id === id)
  }

  /** The prompt's newest comparison, A before B. */
  latestComparison(promptId: string): readonly Run[] {
    const runs = this.current.runs.filter((run) => run.promptId === promptId)
    const last = runs.at(-1)
    return last === undefined ? [] : this.comparison(last.comparisonId)
  }

  comparison(comparisonId: string): readonly Run[] {
    return this.current.runs.filter((run) => run.comparisonId === comparisonId).toSorted((a, b) => a.slot.localeCompare(b.slot))
  }

  /** Save what a run used as the prompt's next version. */
  async saveRunAsVersion(runId: string): Promise<PromptVersion> {
    const run = this.run(runId)
    if (run === undefined) throw new LabError('not-found', 'That run no longer exists.')
    const prompt = this.prompt(run.promptId)
    const latest = this.versions(prompt.id)[0]
    if (latest !== undefined && latest.systemText === run.systemText && latest.userTemplate === run.userTemplate)
      throw new LabError('invalid', `This run already matches v${latest.revision}.`)
    const version = this.addVersion(prompt, run, `Winner: ${run.modelName}`)
    await this.commit()
    return version
  }

  // Evaluations

  private addEvaluation(runId: string, criterion: string, rating: number, note: string): Evaluation {
    const evaluation: Evaluation = { id: this.adapters.newId('evaluation'), runId, criterion, rating, note, createdAt: this.stamp }
    this.current.evaluations.push(evaluation)
    return evaluation
  }

  async rate(runId: string, input: { readonly criterion: unknown; readonly rating: unknown; readonly note?: unknown }): Promise<Evaluation> {
    const run = this.run(runId)
    if (run === undefined) throw new LabError('not-found', 'That run no longer exists.')
    if (run.status !== 'done') throw new LabError('invalid', 'Only a finished run can be rated.')
    const criterion = cleanText(input.criterion, 'A criterion', 40)
    const rating = cleanRating(input.rating)
    const note = cleanText(input.note, 'A note', 300, false)
    // One rating per run and criterion: a second one replaces the first.
    this.current.evaluations = this.current.evaluations.filter((item) => !(item.runId === runId && item.criterion === criterion))
    const evaluation = this.addEvaluation(runId, criterion, rating, note)
    await this.commit()
    return evaluation
  }

  winner(comparisonId: string): Run | undefined {
    const runs = this.comparison(comparisonId)
    return runs.find((run) => this.current.evaluations.some((item) => item.runId === run.id && item.criterion === PREFERRED))
  }

  /** Mark one side of a comparison the better one; choosing again moves the mark. */
  async pickWinner(comparisonId: string, slot: Slot): Promise<Run> {
    const runs = this.comparison(comparisonId)
    const run = runs.find((item) => item.slot === slot)
    if (run === undefined) throw new LabError('not-found', 'That comparison no longer exists.')
    if (runs.length < 2 || runs.some((item) => item.status !== 'done')) throw new LabError('invalid', 'Both runs must finish before you can choose.')
    const ids = new Set(runs.map((item) => item.id))
    this.current.evaluations = this.current.evaluations.filter((item) => !(ids.has(item.runId) && item.criterion === PREFERRED))
    this.addEvaluation(run.id, PREFERRED, 5, '')
    await this.commit()
    return run
  }

  evaluationsOf(runId: string): readonly Evaluation[] {
    return this.current.evaluations.filter((item) => item.runId === runId)
  }

  /** Every rating, newest first, optionally of one prompt. */
  evaluations(promptId?: string): readonly EvaluationRow[] {
    const rows: EvaluationRow[] = []
    for (const evaluation of this.current.evaluations) {
      const run = this.run(evaluation.runId)
      const prompt = run === undefined ? undefined : this.find(run.promptId)
      if (run === undefined || prompt === undefined || (promptId !== undefined && prompt.id !== promptId)) continue
      rows.push({ evaluation, run, prompt })
    }
    return rows.toSorted((a, b) => b.evaluation.createdAt.localeCompare(a.evaluation.createdAt))
  }

  /** How each model did: finished runs, its average rating and the comparisons it won. */
  scores(promptId?: string): readonly ScoreRow[] {
    const names = new Set(this.current.runs.filter((run) => promptId === undefined || run.promptId === promptId).map((run) => run.modelName))
    const rows = this.evaluations(promptId)
    return [...names].map((model) => {
      const own = rows.filter((row) => row.run.modelName === model)
      const rated = own.filter((row) => row.evaluation.criterion !== PREFERRED)
      return {
        model,
        runs: this.current.runs.filter((run) => run.modelName === model && run.status === 'done' && (promptId === undefined || run.promptId === promptId)).length,
        rated: rated.length,
        average: rated.length === 0 ? undefined : rated.reduce((sum, row) => sum + row.evaluation.rating, 0) / rated.length,
        wins: own.length - rated.length,
      }
    })
  }
}
