import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  filterPrompts,
  fillTemplate,
  Lab,
  LabError,
  missingVariables,
  outputView,
  tagsOf,
  validatePrompt,
  variablesOf,
  whenText,
} from '../plugins/promptlab/index.ts'
import { envModel, fakeModel, modelNotConfigured } from '../plugins/promptlab/model.ts'
import { seed } from '../plugins/promptlab/seed.ts'
import { memoryStore } from '../plugins/promptlab/store.ts'
import { NOW, withApp } from './support.ts'

const newId = (kind: string): string => `${kind}-${Math.random().toString(36).slice(2, 8)}`

test('variables are read once each, trimmed, in order', () => {
  assert.deepEqual(variablesOf('{{product_name}} for {{ audience }} and {{product_name}}'), ['product_name', 'audience'])
  assert.deepEqual(variablesOf('nothing'), [])
})

test('every variable must have a value before the prompt is filled', () => {
  const template = 'Write for {{name}} about {{topic}}.'
  assert.deepEqual(missingVariables(template, { name: 'Ada' }), ['topic'])
  assert.deepEqual(missingVariables(template, { name: 'Ada', topic: 'tests' }), [])
  assert.equal(fillTemplate(template, { name: 'Ada', topic: 'tests' }), 'Write for Ada about tests.')
  assert.equal(fillTemplate(template, { name: 'Ada' }), 'Write for Ada about {{topic}}.')
})

test('tags are trimmed, lower-cased and unique', () => {
  assert.deepEqual(tagsOf(' Marketing, copy, marketing '), ['marketing', 'copy'])
  assert.deepEqual(tagsOf(['A', 'a']), ['a'])
})

test('a prompt form refuses an empty name and reads its variables', () => {
  const clean = validatePrompt({
    name: '  Product description ',
    description: 'Copy',
    systemText: 'You are a writer.',
    userTemplate: 'Write for {{product}}.',
    tags: 'copy',
  })
  assert.equal(clean.name, 'Product description')
  assert.deepEqual(clean.variables, ['product'])
  assert.throws(() => validatePrompt({ name: ' ', description: 'x', systemText: 'x', userTemplate: 'x', tags: '' }), (error: unknown) => error instanceof LabError && /Name is required/.test(error.message))
  assert.throws(() => validatePrompt({ name: 'x', description: '', systemText: 'x', userTemplate: 'x', tags: '' }), /Description is required/)
})

test('an output is read as a headline, paragraphs and bullets', () => {
  const view = outputView('Make it flow.\n\nA short paragraph.\n\n- First.\n- Second.')
  assert.equal(view.headline, 'Make it flow.')
  assert.deepEqual(view.paragraphs, ['A short paragraph.'])
  assert.deepEqual(view.bullets, ['First.', 'Second.'])
})

test('the seed has five prompts, their versions and two comparison runs', () => {
  const state = seed(NOW, newId)
  assert.equal(state.prompts.length, 5)
  assert.equal(state.prompts[0]?.name, 'Product description')
  assert.deepEqual(state.prompts[0]?.variables, ['product_name', 'audience', 'benefit'])
  assert.equal(state.runs.length, 2)
  assert.equal(state.evaluations.length, 0)
  assert.ok(state.versions.some((version) => version.promptId === state.prompts[0]?.id))
  assert.deepEqual(filterPrompts(state, { q: 'sql' }).map((prompt) => prompt.name), ['SQL explainer'])
  assert.equal(filterPrompts(state, { tag: 'marketing' }).length, 1)
})

test('whenText reads hours, yesterday and a date', () => {
  assert.equal(whenText('2026-11-06T08:41', NOW), '1h ago')
  assert.equal(whenText('2026-11-05T09:41', NOW), 'Yesterday')
  assert.equal(whenText('2026-10-30T09:41', NOW), '30 Oct')
})

async function open(model = fakeModel('Fine answer.')): Promise<Lab> {
  let ids = 0
  return Lab.open({
    store: memoryStore(),
    clock: () => NOW,
    newId: (kind) => `${kind}-${++ids}`,
    model,
  })
}

test('a new prompt starts at revision 1 and saving a version adds the next revision', async () => {
  const lab = await open()
  const prompt = await lab.createPrompt({
    name: 'My prompt',
    description: 'Does one thing',
    systemText: 'Be brief.',
    userTemplate: 'Say {{thing}}.',
    tags: 'test',
  })
  assert.equal(prompt.version, 1)
  assert.deepEqual(prompt.variables, ['thing'])
  await lab.updatePrompt(prompt.id, { ...prompt, userTemplate: 'Say {{thing}} twice.' })
  const version = await lab.saveVersion(prompt.id)
  assert.equal(version.revision, 2)
  assert.equal(lab.prompt(prompt.id)?.version, 2)
  assert.equal(lab.versions(prompt.id).length, 2)
})

test('a comparison runs once per model, and the latest two are the ones the page shows', async () => {
  const lab = await open()
  const prompt = lab.prompts()[0]
  assert.ok(prompt !== undefined)
  const runs = await lab.startRun(prompt.id, { product_name: 'Flow', audience: 'Ops', benefit: 'Speed' }, ['a', 'b'], 0.5)
  assert.equal(runs.length, 2)
  assert.ok(runs.every((run) => run.status === 'done' && run.output === 'Fine answer.'))
  const latest = lab.latestRuns(prompt.id)
  assert.equal(latest.length, 2)
  assert.ok(latest[0]?.createdAt <= latest[1]?.createdAt)
})

test('a run refuses a missing variable, a bad temperature and a model without a key', async () => {
  const lab = await open()
  const prompt = lab.prompts()[0]
  assert.ok(prompt !== undefined)
  await assert.rejects(lab.startRun(prompt.id, { product_name: 'Flow' }, ['a'], 0.5), /Fill in every variable/)
  await assert.rejects(lab.startRun(prompt.id, { product_name: 'Flow', audience: 'Ops', benefit: 'Speed' }, ['a'], 3), /Temperature/)
  const offline = await open(envModel({}))
  await assert.rejects(
    offline.startRun(prompt.id, { product_name: 'Flow', audience: 'Ops', benefit: 'Speed' }, ['a'], 0.5),
    (error: unknown) => error instanceof LabError && error.code === 'model' && error.message === modelNotConfigured().message,
  )
})

test('a failing model leaves a failed run with its reason', async () => {
  const lab = await open({
    configured: true,
    provider: 'Broken',
    models: ['broken'],
    complete: async () => {
      throw new Error('the provider is down')
    },
  })
  const prompt = lab.prompts()[0]
  assert.ok(prompt !== undefined)
  const runs = await lab.startRun(prompt.id, { product_name: 'Flow', audience: 'Ops', benefit: 'Speed' }, ['broken'], 0.5)
  assert.equal(runs[0]?.status, 'failed')
  assert.match(runs[0]?.error ?? '', /provider is down/)
})

test('rating one run on one criterion replaces the earlier rating', async () => {
  const lab = await open()
  const run = lab.prompts()[0] === undefined ? undefined : lab.latestRuns(lab.prompts()[0]!.id)[0]
  assert.ok(run !== undefined)
  const first = await lab.rate(run.id, 'Concreteness', 4, 'Good')
  assert.equal(first.rating, 4)
  assert.equal(first.criterion, 'concreteness')
  const again = await lab.rate(run.id, 'concreteness', 5, 'Better')
  assert.equal(again.id, first.id)
  assert.equal(lab.evaluations(run.id).length, 1)
  await assert.rejects(lab.rate(run.id, 'concreteness', 9, ''), /1 to 5/)
})

test('the seeded lab is what the pages boot', () =>
  withApp(async (app) => {
    assert.equal(app.root.lab.prompts().length, 5)
    assert.equal(app.root.lab.evaluations().length, 0)
  }))
