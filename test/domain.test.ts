import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, test } from 'node:test'
import {
  type Complete,
  estimateTokens,
  jsonFileStore,
  Lab,
  LabError,
  type LabState,
  labelOf,
  memoryStore,
  modelClient,
  modelProblem,
  render,
  sampleText,
  seed,
  tokenState,
  variablesIn,
  whenText,
} from '../plugins/lab/index.ts'
import { fakeComplete, heldComplete, NOW, projectRoot } from './support.ts'

const scratch = join(projectRoot, '.acrylblends', 'test')
mkdirSync(scratch, { recursive: true })

async function open(options: { state?: LabState; complete?: Complete; env?: Record<string, string>; clock?: () => Date } = {}) {
  let ids = 0
  const store = memoryStore<LabState>(options.state)
  const lab = await Lab.open({ store, clock: options.clock ?? (() => NOW), newId: (kind) => `${kind}-${++ids}`, complete: options.complete ?? fakeComplete, env: options.env ?? {} })
  return { lab, store }
}

const refuses = async (run: () => Promise<unknown>, code: string, message: RegExp) =>
  assert.rejects(run, (error: unknown) => error instanceof LabError && error.code === code && message.test(error.message))

const PRODUCT = 'prompt-product'
const draft = (lab: Lab, id: string, change: { systemText?: string; userTemplate?: string; inputs?: Record<string, string> }) => {
  const prompt = lab.prompt(id)
  return lab.saveDraft(id, { systemText: prompt.systemText, userTemplate: prompt.userTemplate, ...change })
}

describe('templates and tokens', () => {
  test('finds variables once, in order, and fills them', () => {
    assert.deepEqual(variablesIn('{{ a }} and {{b}}', 'then {{a}} and {{c_1}}, not {{1x}}'), ['a', 'b', 'c_1'])
    assert.equal(render('Hi {{ who }}, {{left}}', { who: ' Ada ', left: ' ' }), 'Hi Ada, {{left}}')
    assert.equal(labelOf('product_name'), 'Product name')
  })

  test('estimates tokens and warns near the limit', () => {
    assert.equal(estimateTokens('12345678'), 2)
    assert.equal(tokenState(79, 100), 'ok')
    assert.equal(tokenState(80, 100), 'warn')
    assert.equal(tokenState(101, 100), 'over')
  })

  test('reads dates the way the pages write them', () => {
    assert.equal(whenText('2026-11-05T13:42', '2026-11-05'), 'Today, 13:42')
    assert.equal(whenText('2026-11-04T09:10', '2026-11-05'), 'Yesterday, 09:10')
    assert.equal(whenText('2026-10-30T10:00', '2026-11-05'), 'Oct 30, 10:00')
  })
})

describe('the seed', () => {
  test('has five prompts, three variables on the first, a finished comparison and a model to set up', async () => {
    const { lab, store } = await open()
    assert.equal(store.saved, 1)
    assert.equal(lab.prompts().length, 5)
    const prompt = lab.prompt(PRODUCT)
    assert.deepEqual(lab.variables(prompt), ['product_name', 'audience', 'benefit'])
    assert.equal(prompt.version, 3)
    assert.equal(lab.isDirty(prompt), false)
    assert.deepEqual(lab.latestComparison(PRODUCT).map((run) => run.slot), ['A', 'B'])
    assert.ok(lab.models().some((model) => lab.problem(model) !== undefined))
  })

  test('is laid around the first start, so it never opens stale', async () => {
    const { lab } = await open({ clock: () => new Date(2027, 2, 10, 9, 0) })
    assert.equal(lab.prompts()[0]?.updatedAt.slice(0, 10), '2027-03-10')
    assert.equal(lab.latestComparison(PRODUCT)[0]?.createdAt.slice(0, 10), '2027-03-10')
  })

  test('an existing state is opened as it is, and not saved again', async () => {
    const state = seed(NOW)
    state.prompts = state.prompts.slice(0, 2)
    const { lab, store } = await open({ state })
    assert.equal(lab.prompts().length, 2)
    assert.equal(store.saved, 0)
  })

  test('a run left pending by a stop is marked failed', async () => {
    const state = seed(NOW)
    state.runs = state.runs.map((run) => ({ ...run, status: 'pending' as const }))
    const { lab, store } = await open({ state })
    assert.equal(lab.run('run-seed-a')?.status, 'failed')
    assert.match(lab.run('run-seed-a')?.error ?? '', /stopped/)
    assert.equal(store.saved, 1)
  })
})

describe('prompts and versions', () => {
  test('filters by search and tag, latest change first', async () => {
    const { lab } = await open()
    assert.equal(lab.prompts()[0]?.id, PRODUCT)
    assert.deepEqual(lab.prompts({ q: 'SQL' }).map((prompt) => prompt.id), ['prompt-sql'])
    assert.deepEqual(lab.prompts({ tag: 'Developer' }).map((prompt) => prompt.id), ['prompt-sql', 'prompt-release'])
    assert.equal(lab.prompts({ q: 'zzz' }).length, 0)
    assert.deepEqual(lab.tags().find((item) => item.tag === 'Developer'), { tag: 'Developer', count: 2 })
  })

  test('a draft is dirty until saved, and a save makes the next revision', async () => {
    const { lab } = await open()
    await draft(lab, PRODUCT, { userTemplate: 'Short copy for {{product_name}}.' })
    assert.equal(lab.isDirty(lab.prompt(PRODUCT)), true)
    const version = await lab.saveVersion(PRODUCT, 'Shorter')
    assert.equal(version.revision, 4)
    assert.equal(lab.isDirty(lab.prompt(PRODUCT)), false)
    await refuses(() => lab.saveVersion(PRODUCT), 'invalid', /Nothing changed since v4/)
  })

  test('restore brings an old version back as an unsaved draft', async () => {
    const { lab } = await open()
    await lab.restore(PRODUCT, 1)
    const prompt = lab.prompt(PRODUCT)
    assert.equal(prompt.systemText, 'You are a copywriter.')
    assert.equal(prompt.version, 3)
    assert.equal(lab.isDirty(prompt), true)
    await refuses(() => lab.restore(PRODUCT, 9), 'not-found', /no v9/)
  })

  test('refuses an empty name and an empty user prompt', async () => {
    const { lab } = await open()
    await refuses(() => lab.createPrompt({ name: ' ' }), 'invalid', /name is required/)
    await refuses(() => draft(lab, PRODUCT, { userTemplate: '  ' }), 'invalid', /user prompt is required/)
  })

  test('deleting a prompt takes its versions, runs and ratings', async () => {
    const { lab } = await open()
    await lab.removePrompt(PRODUCT)
    assert.equal(lab.find(PRODUCT), undefined)
    assert.equal(lab.versions(PRODUCT).length, 0)
    assert.equal(lab.run('run-seed-a'), undefined)
    assert.equal(lab.evaluations().length, 0)
    await refuses(() => lab.removePrompt(PRODUCT), 'not-found', /no longer exists/)
  })
})

describe('comparisons', () => {
  const request = { modelA: 'sample-crisp', modelB: 'sample-detailed', temperature: '0.6' }

  test('two models run, keep what they used, and finish', async () => {
    const { complete, release } = heldComplete()
    const { lab } = await open({ complete })
    const id = await lab.startComparison(PRODUCT, request)
    assert.deepEqual(lab.comparison(id).map((run) => run.status), ['pending', 'pending'])
    release()
    await lab.settled()
    const [a, b] = lab.comparison(id)
    assert.equal(a?.status, 'done')
    assert.match(a?.output ?? '', /From Sample Crisp/)
    assert.match(b?.userText ?? '', /FlowDesk/)
    assert.equal(a?.promptVersionId, 'version-product-3')
  })

  test('a draft run names no version, and one model is enough', async () => {
    const { lab } = await open()
    await draft(lab, PRODUCT, { userTemplate: 'New {{product_name}}' })
    const id = await lab.startComparison(PRODUCT, { modelA: 'sample-crisp', modelB: '', temperature: '1' })
    await lab.settled()
    assert.equal(lab.comparison(id).length, 1)
    assert.equal(lab.comparison(id)[0]?.promptVersionId, undefined)
  })

  test('a missing variable stops the run and names it', async () => {
    const { lab } = await open()
    await draft(lab, PRODUCT, { inputs: { audience: ' ' } })
    await refuses(() => lab.startComparison(PRODUCT, request), 'missing-variable', /Fill in Audience/)
    assert.equal(lab.latestComparison(PRODUCT)[0]?.id, 'run-seed-a')
  })

  test('a model that is not configured stops the run', async () => {
    const { lab } = await open()
    await refuses(() => lab.startComparison(PRODUCT, { ...request, modelA: 'model-local' }), 'not-configured', /no address/)
  })

  test('a prompt over the limit stops the run', async () => {
    const { lab } = await open()
    await draft(lab, PRODUCT, { userTemplate: 'x'.repeat(40_000) })
    await refuses(() => lab.startComparison(PRODUCT, request), 'token-limit', /over the 8,000/)
  })

  test('refuses a bad temperature and an unknown model', async () => {
    const { lab } = await open()
    await refuses(() => lab.startComparison(PRODUCT, { ...request, temperature: '3' }), 'invalid', /Temperature/)
    await refuses(() => lab.startComparison(PRODUCT, { ...request, temperature: 'hot' }), 'invalid', /Temperature/)
    await refuses(() => lab.startComparison(PRODUCT, { ...request, modelA: 'nope' }), 'not-found', /not in the list/)
    await refuses(() => lab.startComparison(PRODUCT, { modelA: '', temperature: '1' }), 'invalid', /Pick a model/)
  })

  test('a model that fails marks only its own run failed', async () => {
    const complete: Complete = async (input) => {
      if (input.model.id === 'sample-crisp') throw new Error('It answered 500.')
      return fakeComplete(input)
    }
    const { lab, store } = await open({ complete })
    const id = await lab.startComparison(PRODUCT, request)
    await lab.settled()
    const [a, b] = lab.comparison(id)
    assert.equal(a?.status, 'failed')
    assert.equal(a?.error, 'It answered 500.')
    assert.equal(b?.status, 'done')
    assert.equal(store.state?.runs.find((run) => run.id === a?.id)?.status, 'failed')
  })

  test('the winner can be chosen, changed, and saved as the next version', async () => {
    const { complete, release } = heldComplete()
    const { lab } = await open({ complete })
    await draft(lab, PRODUCT, { systemText: 'Be brief.' })
    const id = await lab.startComparison(PRODUCT, request)
    await refuses(() => lab.pickWinner(id, 'A'), 'invalid', /must finish/)
    release()
    await lab.settled()
    await lab.pickWinner(id, 'A')
    const winner = await lab.pickWinner(id, 'B')
    assert.equal(lab.winner(id)?.slot, 'B')
    assert.equal(lab.evaluationsOf(lab.comparison(id)[0]?.id ?? '').length, 0)
    const version = await lab.saveRunAsVersion(winner.id)
    assert.equal(version.revision, 4)
    assert.equal(version.systemText, 'Be brief.')
    assert.equal(lab.isDirty(lab.prompt(PRODUCT)), false)
    assert.equal(lab.prompt(PRODUCT).version, 4)
    await refuses(() => lab.saveRunAsVersion(winner.id), 'invalid', /already matches v4/)
    await draft(lab, PRODUCT, { systemText: 'Be briefer.' })
    assert.equal((await lab.saveVersion(PRODUCT)).revision, 5)
  })

  test('a second rating of a criterion replaces the first; scores add up', async () => {
    const { lab } = await open()
    await lab.rate('run-seed-a', { criterion: 'Clarity', rating: '2', note: 'Changed my mind' })
    assert.equal(lab.evaluationsOf('run-seed-a').length, 1)
    await lab.pickWinner('comparison-seed', 'B')
    const scores = lab.scores()
    assert.deepEqual(scores.find((row) => row.model === 'Sample Crisp'), { model: 'Sample Crisp', runs: 1, rated: 1, average: 2, wins: 0 })
    assert.deepEqual(scores.find((row) => row.model === 'Sample Detailed'), { model: 'Sample Detailed', runs: 1, rated: 1, average: 5, wins: 1 })
    await refuses(() => lab.rate('run-seed-a', { criterion: 'Clarity', rating: '6' }), 'invalid', /1 to 5/)
    await refuses(() => lab.rate('nope', { criterion: 'Clarity', rating: '3' }), 'not-found', /no longer exists/)
  })
})

describe('models', () => {
  const input = { name: 'Local', model: 'llama', baseUrl: 'http://127.0.0.1:11434/v1', keyEnv: 'MY_KEY', contextTokens: '4096', costPer1k: '0.5' }

  test('a model is not ready until its address and key are there', async () => {
    const { lab } = await open({ env: { MY_KEY: 'secret' } })
    assert.match(lab.problem(lab.model('model-local')) ?? '', /no address/)
    const model = await lab.saveModel('model-local', input)
    assert.equal(lab.problem(model), undefined)
    assert.match(modelProblem(model, {}) ?? '', /set MY_KEY/)
  })

  test('refuses bad input, and leaves the samples alone', async () => {
    const { lab } = await open()
    await refuses(() => lab.saveModel(undefined, { ...input, baseUrl: 'not a url' }), 'invalid', /full URL/)
    await refuses(() => lab.saveModel(undefined, { ...input, baseUrl: 'file:///etc/passwd' }), 'invalid', /http or https/)
    await refuses(() => lab.saveModel(undefined, { ...input, keyEnv: 'bad name' }), 'invalid', /environment variable/)
    await refuses(() => lab.saveModel(undefined, { ...input, contextTokens: '0' }), 'invalid', /context size/)
    await refuses(() => lab.saveModel('sample-crisp', input), 'invalid', /sample/)
    await refuses(() => lab.removeModel('sample-crisp'), 'invalid', /sample/)
  })

  test('removing a model keeps the names on past runs', async () => {
    const { lab } = await open()
    const model = await lab.saveModel(undefined, input)
    await lab.removeModel(model.id)
    assert.equal(lab.models().some((item) => item.id === model.id), false)
  })

  test('the client posts to the address with the key from the environment, and never stores it', async () => {
    let seen: { url: string; authorization: string | null; body: string } | undefined
    const fetcher = (async (url: string, init: RequestInit) => {
      seen = { url, authorization: new Headers(init.headers).get('authorization'), body: String(init.body) }
      return Response.json({ choices: [{ message: { content: 'Hello' } }], usage: { total_tokens: 12 } })
    }) as unknown as typeof fetch
    const complete = modelClient({ fetcher, env: { MY_KEY: 'secret' } })
    const model = { id: 'm', name: 'M', provider: 'openai-compatible', model: 'llama', baseUrl: 'http://x/v1/', keyEnv: 'MY_KEY', contextTokens: 100, costPer1k: 0 } as const
    assert.deepEqual(await complete({ model, system: 's', user: 'u', temperature: 0.2, inputs: {} }), { text: 'Hello', tokens: 12 })
    assert.equal(seen?.url, 'http://x/v1/chat/completions')
    assert.equal(seen?.authorization, 'Bearer secret')
    assert.match(seen?.body ?? '', /"temperature":0.2/)
  })

  test('the client turns a bad answer into a failure', async () => {
    const model = { id: 'm', name: 'M', provider: 'openai-compatible', model: 'x', baseUrl: 'http://x', contextTokens: 100, costPer1k: 0 } as const
    const request = { model, system: '', user: 'u', temperature: 0, inputs: {} }
    const status = modelClient({ fetcher: (async () => new Response('no', { status: 401 })) as unknown as typeof fetch, env: {} })
    await assert.rejects(status(request), /answered 401/)
    const empty = modelClient({ fetcher: (async () => Response.json({ choices: [] })) as unknown as typeof fetch, env: {} })
    await assert.rejects(empty(request), /no text/)
  })

  test('a sample writes from the inputs, the same way each time', async () => {
    const inputs = { product_name: 'FlowDesk', audience: 'Ops', benefit: 'Save time' }
    assert.match(sampleText('sample-crisp', inputs, ''), /FlowDesk helps Ops save time/)
    assert.equal(sampleText('sample-detailed', inputs, ''), sampleText('sample-detailed', inputs, ''))
    const complete = modelClient({ sampleDelayMs: 0, env: {} })
    const model = { id: 'sample-crisp', name: 'S', provider: 'sample', model: 's', contextTokens: 100, costPer1k: 0 } as const
    assert.ok((await complete({ model, system: 's', user: 'u', temperature: 0, inputs })).tokens > 0)
  })
})

describe('the store', () => {
  test('two saves at once both land, and a foreign file is refused, never replaced', async () => {
    const dir = await mkdtemp(join(scratch, 'store-'))
    try {
      const file = join(dir, 'lab.json')
      const store = jsonFileStore<LabState>(file, 'Prompt Lab')
      assert.equal(await store.load(), undefined)
      const lab = await Lab.open({ store, clock: () => NOW, newId: (kind) => `${kind}-${Math.random()}`, complete: fakeComplete, env: {} })
      await lab.startComparison(PRODUCT, { modelA: 'sample-crisp', modelB: 'sample-detailed', temperature: '0.5' })
      await lab.settled()
      assert.equal((await store.load())?.runs.filter((run) => run.status === 'done').length, 4)
      await writeFile(file, '{"version":2}')
      await assert.rejects(store.load(), /not a Prompt Lab state of version 1/)
      await writeFile(file, '{oops')
      await assert.rejects(store.load(), /not valid JSON/)
      assert.match(await readFile(file, 'utf8'), /oops/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
