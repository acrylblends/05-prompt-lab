import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { createApp, readManifest } from '../src/app.ts'
import { pinnedInstance } from '../plugins/instance/index.ts'
import { envModel, fakeModel } from '../plugins/promptlab/index.ts'
import { noticeOf, projectRoot, withApp } from './support.ts'

const scratch = join(projectRoot, '.acrylblends', 'test')
mkdirSync(scratch, { recursive: true })

test('the first page redirects to the lab, which shows the seed and the comparison at once', () =>
  withApp(async (app) => {
    const root = await app.root.router.request('/')
    assert.equal(root.status, 302)
    assert.equal(root.headers.get('location'), '/prompts')
    const page = await app.page('/prompts')
    assert.equal(page.status, 200)
    assert.match(page.html, /Prompt library/)
    assert.match(page.html, /Product description/)
    assert.match(page.html, /Write a product description for <mark>{{product_name}}<\/mark>/)
    assert.match(page.html, /Make every handoff flow\./)
    assert.match(page.html, /Less chasing\. More momentum\./)
    assert.match(page.html, /QUICK EVALUATION/)
  }))

test('search and tag filters narrow the prompt list, and a prompt page shows its version tabs', () =>
  withApp(async (app) => {
    const search = await app.page('/prompts?q=sql')
    assert.match(search.html, /SQL explainer/)
    assert.doesNotMatch(search.html, /Product description/)
    const tagged = await app.page('/prompts?tag=marketing')
    assert.match(tagged.html, /Product description/)
    assert.doesNotMatch(tagged.html, /SQL explainer/)
    const prompt = app.root.lab.prompts().find((item) => item.name === 'Product description')
    assert.ok(prompt !== undefined)
    const history = await app.page(`/prompts/${prompt.id}?tab=history`)
    assert.match(history.html, /Version history/)
    assert.match(history.html, /v3/)
    const evaluations = await app.page(`/prompts/${prompt.id}?tab=evaluations`)
    assert.match(evaluations.html, /No evaluations yet/)
    const edit = await app.page(`/prompts/${prompt.id}?edit=1`)
    assert.match(edit.html, /SYSTEM INSTRUCTION/)
    assert.match(edit.html, /Save version/)
  }))

test('running a comparison with a fake model saves two runs and shows them', () =>
  withApp(async (app) => {
    const prompt = app.root.lab.prompts().find((item) => item.name === 'Product description')
    assert.ok(prompt !== undefined)
    const response = await app.post(`/prompts/${prompt.id}/run`, {
      'var-product_name': 'FlowDesk',
      'var-audience': 'Operations teams',
      'var-benefit': 'Automate handoffs',
      modelA: 'fake-model',
      modelB: 'fake-model',
      temperature: '0.4',
      back: `/prompts/${prompt.id}`,
    })
    assert.equal(response.status, 303)
    assert.equal(noticeOf(response).kind, 'ok')
    const runs = app.root.lab.runs(prompt.id)
    assert.ok(runs.length >= 4)
    const page = await app.page(`/prompts/${prompt.id}`)
    assert.match(page.html, /A concise answer\./)
  }))

test('a comparison with a missing variable is refused with a message', () =>
  withApp(async (app) => {
    const prompt = app.root.lab.prompts()[0]
    assert.ok(prompt !== undefined)
    const response = await app.post(`/prompts/${prompt.id}/run`, {
      'var-product_name': '',
      'var-audience': 'Ops',
      'var-benefit': 'Speed',
      modelA: 'fake-model',
      temperature: '0.4',
      back: `/prompts/${prompt.id}`,
    })
    assert.equal(noticeOf(response).kind, 'error')
    assert.match(noticeOf(response).text, /Fill in every variable/)
  }))

test('a model without a key says so on the lab page and refuses to run', () =>
  withApp(
    async (app) => {
      const prompt = app.root.lab.prompts()[0]
      assert.ok(prompt !== undefined)
      const page = await app.page(`/prompts/${prompt.id}`)
      assert.match(page.html, /Needs a key/)
      const response = await app.post(`/prompts/${prompt.id}/run`, {
        'var-product_name': 'Flow',
        'var-audience': 'Ops',
        'var-benefit': 'Speed',
        modelA: 'deepseek-chat',
        temperature: '0.4',
        back: `/prompts/${prompt.id}`,
      })
      assert.equal(noticeOf(response).kind, 'error')
      assert.match(noticeOf(response).text, /No model is configured/)
    },
    { overrides: { promptlab: { model: envModel({}) } } },
  ))

test('the new-prompt form creates a prompt, and an invalid one keeps what was typed', () =>
  withApp(async (app) => {
    const form = await app.page('/prompts/new')
    assert.equal(form.status, 200)
    assert.match(form.html, /New prompt/)
    const invalid = await app.post('/prompts', { name: '', description: 'x', systemText: 'x', userTemplate: 'x', tags: '' })
    assert.equal(invalid.status, 200)
    assert.match(await invalid.text(), /Name is required/)
    const created = await app.post('/prompts', {
      name: 'My prompt',
      description: 'A test prompt',
      systemText: 'Be brief.',
      userTemplate: 'Say {{thing}}.',
      tags: 'test',
    })
    assert.equal(created.status, 303)
    const prompt = app.root.lab.prompts().find((item) => item.name === 'My prompt')
    assert.ok(prompt !== undefined)
    assert.equal(prompt.version, 1)
    assert.match((await app.page(`/prompts/${prompt.id}`)).html, /My prompt/)
  }))

test('saving a version from the edit form updates the prompt and records the revision', () =>
  withApp(async (app) => {
    const prompt = app.root.lab.prompts()[0]
    assert.ok(prompt !== undefined)
    const response = await app.post(`/prompts/${prompt.id}/version`, {
      name: prompt.name,
      description: prompt.description,
      systemText: 'A new system instruction.',
      userTemplate: 'Say {{word}}.',
      tags: 'copy',
      back: `/prompts/${prompt.id}`,
    })
    assert.equal(response.status, 303)
    assert.equal(noticeOf(response).kind, 'ok')
    const changed = app.root.lab.prompt(prompt.id)
    assert.equal(changed?.systemText, 'A new system instruction.')
    assert.deepEqual(changed?.variables, ['word'])
    assert.equal(changed?.version, 4)
  }))

test('a run page shows the run and its rating form, and the rating is saved', () =>
  withApp(async (app) => {
    const run = app.root.lab.runs(app.root.lab.prompts()[0]?.id ?? '')[0]
    assert.ok(run !== undefined)
    const page = await app.page(`/runs/${run.id}`)
    assert.equal(page.status, 200)
    assert.match(page.html, /GPT-4.1 mini/)
    assert.match(page.html, /Make every handoff flow\./)
    assert.match(page.html, /Save rating/)
    const rated = await app.post(`/runs/${run.id}/rating`, { criterion: 'concreteness', rating: '4', note: 'Solid' })
    assert.equal(rated.status, 303)
    assert.equal(app.root.lab.evaluationOf(run.id, 'concreteness')?.rating, 4)
    assert.match((await app.page(`/runs/${run.id}`)).html, /Rated 4\/5/)
  }))

test('the evaluations page starts empty and lists every rating after it', () =>
  withApp(async (app) => {
    const page = await app.page('/evaluations')
    assert.equal(page.status, 200)
    assert.match(page.html, /Evaluation log/)
    assert.match(page.html, /No evaluations yet/)
    const run = app.root.lab.runs(app.root.lab.prompts()[0]?.id ?? '')[0]
    assert.ok(run !== undefined)
    await app.post(`/runs/${run.id}/rating`, { criterion: 'concreteness', rating: '5', note: 'Excellent' })
    const after = await app.page('/evaluations')
    assert.match(after.html, /5\/5 · Excellent/)
    assert.match(after.html, /concreteness/)
  }))

test('the models page tells the truth about the configured model', () =>
  withApp(async (app) => {
    const page = await app.page('/settings/models')
    assert.equal(page.status, 200)
    assert.match(page.html, /Fake model/)
    assert.match(page.html, /A key is configured/)
  }))

test('health answers, an unknown path is a 404, and every feature is a row of the manifest', () =>
  withApp(async (app) => {
    assert.equal((await app.page('/health')).status, 200)
    assert.equal((await app.page('/nope')).status, 404)
    assert.deepEqual(readManifest().plugins.map((row) => row.id), [
      'router',
      'home',
      'promptlab',
      'lab-shell',
      'library',
      'runs',
      'models',
      'extensions',
      'server',
      'acryl-door',
    ])
  }))

test('switching the runs plugin off leaves the app running without it', async () => {
  const manifest = readManifest()
  const without = {
    ...manifest,
    plugins: manifest.plugins.map((row) => (row.id === 'runs' ? { ...row, disabled: true } : row)),
  }
  const home = await mkdtemp(join(scratch, 'app-test-off-'))
  let ids = 0
  const app = await createApp(pinnedInstance(home, { root: projectRoot }), {
    listen: false,
    manifest: without,
    overrides: { promptlab: { clock: () => new Date(2026, 10, 6, 9, 41), newId: (kind: string) => `${kind}-${++ids}`, model: fakeModel('Fine.') } },
  })
  try {
    const lab = await app.root.router.request('/prompts', { headers: { accept: 'text/html' } })
    assert.equal(lab.status, 200)
    const html = await lab.text()
    assert.match(html, /Prompt library/)
    assert.doesNotMatch(html, /href="\/evaluations"/)
    assert.equal((await app.root.router.request('/evaluations')).status, 404)
  } finally {
    await app.stop()
    await rm(home, { recursive: true, force: true })
  }
})
