/**
 * The lab: the saved prompts, versions, runs and evaluations, and every operation a page may run on them. The model is an injected port, so the same
 * rules apply to a fake in tests and to the configured provider in the app.
 */
import {
  cleanText,
  dayOf,
  fillTemplate,
  type Evaluation,
  filterPrompts,
  LabError,
  type LabState,
  missingVariables,
  type Prompt,
  type PromptFilter,
  type PromptInput,
  type PromptVersion,
  type Run,
  stampOf,
  validatePrompt,
} from './domain.ts'
import { modelNotConfigured, type ModelClient } from './model.ts'
import { seed } from './seed.ts'
import type { Store } from './store.ts'

export interface LabAdapters {
  readonly store: Store<LabState>
  readonly clock: () => Date
  readonly newId: (kind: string) => string
  readonly model: ModelClient
}

export interface LabStats {
  readonly prompts: number
  readonly runs: number
  readonly evaluations: number
  readonly updatedAt: string | undefined
}

export class Lab {
  private state: LabState
  private readonly adapters: LabAdapters

  private constructor(state: LabState, adapters: LabAdapters) {
    this.state = state
    this.adapters = adapters
  }

  static async open(adapters: LabAdapters): Promise<Lab> {
    const saved = await adapters.store.load()
    return new Lab(saved ?? seed(adapters.clock(), adapters.newId), adapters)
  }

  get today(): string {
    return dayOf(this.adapters.clock())
  }

  get model(): ModelClient {
    return this.adapters.model
  }

  prompts(filter: PromptFilter = {}): readonly Prompt[] {
    return filterPrompts(this.state, filter)
  }

  prompt(id: string): Prompt | undefined {
    return this.state.prompts.find((prompt) => prompt.id === id)
  }

  versions(promptId: string): readonly PromptVersion[] {
    return this.state.versions
      .filter((version) => version.promptId === promptId)
      .sort((a, b) => b.revision - a.revision)
  }

  run(id: string): Run | undefined {
    return this.state.runs.find((run) => run.id === id)
  }

  runs(promptId: string): readonly Run[] {
    return this.state.runs.filter((run) => run.promptId === promptId)
  }

  /** The two runs the comparison column shows: the most recent ones, oldest first. */
  latestRuns(promptId: string): readonly Run[] {
    return [...this.runs(promptId)]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 2)
      .reverse()
  }

  /** A run's prompt, for the run page. */
  promptOf(run: Run): Prompt | undefined {
    return this.prompt(run.promptId)
  }

  evaluations(runId?: string): readonly Evaluation[] {
    return [...this.state.evaluations]
      .filter((evaluation) => runId === undefined || evaluation.runId === runId)
      .sort((a, b) => b.at.localeCompare(a.at))
  }

  evaluationOf(runId: string, criterion: string): Evaluation | undefined {
    return this.state.evaluations.find((evaluation) => evaluation.runId === runId && evaluation.criterion === criterion)
  }

  stats(): LabStats {
    const lastPrompt = [...this.state.prompts].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    return {
      prompts: this.state.prompts.length,
      runs: this.state.runs.length,
      evaluations: this.state.evaluations.length,
      updatedAt: lastPrompt?.updatedAt,
    }
  }

  async createPrompt(input: PromptInput): Promise<Prompt> {
    const now = stampOf(this.adapters.clock())
    const clean = validatePrompt(input)
    const prompt: Prompt = {
      id: this.adapters.newId('prompt'),
      ...clean,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    this.state.prompts.push(prompt)
    this.state.versions.push({
      id: this.adapters.newId('version'),
      promptId: prompt.id,
      revision: 1,
      content: `${prompt.systemText}\n\n${prompt.userTemplate}`,
      createdAt: now,
    })
    await this.save()
    return prompt
  }

  /** Change the prompt's text without making a version; {@link saveVersion} records one. */
  async updatePrompt(id: string, input: PromptInput): Promise<Prompt> {
    const prompt = this.prompt(id)
    if (prompt === undefined) throw new LabError('not-found', 'That prompt no longer exists.')
    const next: Prompt = { ...prompt, ...validatePrompt(input), updatedAt: stampOf(this.adapters.clock()) }
    this.state.prompts = this.state.prompts.map((item) => (item.id === id ? next : item))
    await this.save()
    return next
  }

  /** Make a version of the prompt as it stands now: the next revision, saved with its text. */
  async saveVersion(id: string): Promise<PromptVersion> {
    const prompt = this.prompt(id)
    if (prompt === undefined) throw new LabError('not-found', 'That prompt no longer exists.')
    const revision = Math.max(prompt.version, ...this.versions(id).map((version) => version.revision)) + 1
    const version: PromptVersion = {
      id: this.adapters.newId('version'),
      promptId: id,
      revision,
      content: `${prompt.systemText}\n\n${prompt.userTemplate}`,
      createdAt: stampOf(this.adapters.clock()),
    }
    this.state.versions.push(version)
    this.state.prompts = this.state.prompts.map((item) => (item.id === id ? { ...item, version: revision, updatedAt: version.createdAt } : item))
    await this.save()
    return version
  }

  /**
   * Run the prompt on each model, one run per model: a pending row is saved first, then the model answers, and a failure leaves a failed row with
   * the reason. Every variable must have a value before anything is sent.
   */
  async startRun(id: string, inputs: Readonly<Record<string, string>>, models: readonly string[], temperature: number): Promise<Run[]> {
    const prompt = this.prompt(id)
    if (prompt === undefined) throw new LabError('not-found', 'That prompt no longer exists.')
    if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2)
      throw new LabError('invalid', 'Temperature must be between 0 and 2.')
    if (models.length === 0 || models.length > 2) throw new LabError('invalid', 'Pick one or two models to compare.')
    const missing = missingVariables(prompt.userTemplate, inputs)
    if (missing.length > 0) throw new LabError('invalid', `Fill in every variable first: ${missing.join(', ')}.`)
    if (!this.adapters.model.configured) throw modelNotConfigured()
    const version = this.versions(id)[0]
    if (version === undefined) throw new LabError('conflict', 'Save a version of the prompt before running it.')
    const user = fillTemplate(prompt.userTemplate, inputs)
    const made: Run[] = []
    for (const model of models) {
      const run: Run = {
        id: this.adapters.newId('run'),
        promptId: id,
        promptVersionId: version.id,
        model,
        inputs: { ...inputs },
        output: '',
        tokens: 0,
        durationMs: 0,
        status: 'pending',
        createdAt: stampOf(this.adapters.clock()),
      }
      this.state.runs.push(run)
      made.push(run)
      try {
        const result = await this.adapters.model.complete({ model, system: prompt.systemText, user, temperature })
        this.replaceRun({ ...run, output: result.text, tokens: result.tokens, durationMs: result.durationMs, status: 'done' })
      } catch (error) {
        this.replaceRun({ ...run, status: 'failed', error: (error as Error).message })
      }
    }
    await this.save()
    return made.map((run) => this.run(run.id) ?? run)
  }

  /** Rate one run on one criterion, 1 to 5; rating it again replaces the rating. */
  async rate(runId: string, criterion: string, rating: number, note: string): Promise<Evaluation> {
    const run = this.run(runId)
    if (run === undefined) throw new LabError('not-found', 'That run no longer exists.')
    const cleanCriterion = cleanText(criterion, 'Criterion', 60).toLowerCase()
    const value = Math.round(rating)
    if (!Number.isInteger(value) || value < 1 || value > 5) throw new LabError('invalid', 'A rating is 1 to 5.')
    const at = stampOf(this.adapters.clock())
    const existing = this.evaluationOf(runId, cleanCriterion)
    const evaluation: Evaluation = {
      id: existing?.id ?? this.adapters.newId('evaluation'),
      runId,
      criterion: cleanCriterion,
      rating: value,
      note: note.trim().slice(0, 300),
      at,
    }
    this.state.evaluations = existing === undefined
      ? [...this.state.evaluations, evaluation]
      : this.state.evaluations.map((item) => (item.id === existing.id ? evaluation : item))
    await this.save()
    return evaluation
  }

  private replaceRun(next: Run): void {
    this.state.runs = this.state.runs.map((run) => (run.id === next.id ? next : run))
  }

  private async save(): Promise<void> {
    this.state = {
      ...this.state,
      prompts: [...this.state.prompts],
      versions: [...this.state.versions],
      runs: [...this.state.runs],
      evaluations: [...this.state.evaluations],
    }
    await this.adapters.store.save(this.state)
  }
}
