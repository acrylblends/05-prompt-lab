import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { heldComplete, noticeOf, withApp } from './support.ts'

const PRODUCT = '/prompts/prompt-product'
const form = { systemText: 'Be brief.', userTemplate: 'Copy for {{product_name}}', 'var.product_name': 'FlowDesk', modelA: 'sample-crisp', modelB: 'sample-detailed', temperature: '0.6' }

describe('the library and the editor', () => {
  test('the first page is the lab with the seed', () =>
    withApp(async (app) => {
      const root = await app.root.router.request('/')
      assert.equal(root.status, 302)
      assert.equal(root.headers.get('location'), '/prompts')
      const { status, html } = await app.page('/prompts')
      assert.equal(status, 200)
      for (const text of ['Prompt library', 'Product description', 'Release notes', 'Input variables', 'Run comparison', 'Make every handoff flow.', 'Less chasing. More momentum.', 'A is better'])
        assert.ok(html.includes(text), text)
    }))

  test('search, tags and an empty search', () =>
    withApp(async (app) => {
      assert.match((await app.page('/prompts?q=sql')).html, /<h1>SQL explainer/)
      assert.match((await app.page('/prompts?tag=Developer')).html, /Developer<\/span><span>2/)
      const empty = (await app.page('/prompts?q=zzz')).html
      assert.match(empty, /No prompt matches/)
      assert.match(empty, /Nothing selected/)
    }))

  test('a prompt, its tabs and a prompt that is gone', () =>
    withApp(async (app) => {
      assert.match((await app.page(PRODUCT)).html, /name="var.audience" value="Operations teams"/)
      const versions = (await app.page(`${PRODUCT}?tab=versions`)).html
      assert.match(versions, /Fixed the output shape/)
      assert.match(versions, /Restore to editor/)
      assert.match((await app.page(`${PRODUCT}?tab=evaluations`)).html, /The headline lands/)
      assert.equal((await app.page('/prompts/nope')).status, 404)
    }))

  test('add a prompt, and a name is required', () =>
    withApp(async (app) => {
      assert.match((await app.page('/prompts?new=1')).html, /New prompt/)
      const added = await app.post('/prompts', { name: 'Launch email', tags: 'Marketing, Email' })
      assert.equal(added.status, 303)
      assert.equal(noticeOf(added).text, 'Launch email was added.')
      assert.equal(app.root.lab.prompts()[0]?.name, 'Launch email')
      assert.equal(noticeOf(await app.post('/prompts', { name: ' ' })).kind, 'error')
    }))

  test('a draft shows as unsaved, and save version clears it', () =>
    withApp(async (app) => {
      assert.match((await app.page(PRODUCT)).html, /id="dirty" class="notice warn" role="status" hidden/)
      assert.equal(noticeOf(await app.post(PRODUCT, form)).text, 'Draft saved.')
      assert.doesNotMatch((await app.page(PRODUCT)).html, /role="status" hidden/)
      assert.equal(noticeOf(await app.post(`${PRODUCT}/save-version`, form)).text, 'Saved as v4.')
      assert.equal(noticeOf(await app.post(`${PRODUCT}/save-version`, form)).kind, 'error')
      assert.equal(noticeOf(await app.post('/prompts/nope', form)).path, '/prompts')
    }))

  test('a version comes back to the editor', () =>
    withApp(async (app) => {
      assert.match(noticeOf(await app.post(`${PRODUCT}/versions/1/restore`, {})).text, /v1 is back/)
      assert.match((await app.page(PRODUCT)).html, /You are a copywriter\./)
      assert.equal(noticeOf(await app.post(`${PRODUCT}/versions/9/restore`, {})).kind, 'error')
    }))

  test('delete asks first, then the prompt is gone', () =>
    withApp(async (app) => {
      assert.match((await app.page(`${PRODUCT}?confirm=delete`)).html, /Delete Product description\?/)
      assert.match(noticeOf(await app.post(`${PRODUCT}/delete`, {})).text, /was deleted/)
      assert.equal((await app.page(PRODUCT)).status, 404)
      assert.equal(noticeOf(await app.post(`${PRODUCT}/delete`, {})).path, '/prompts')
    }))

  test('text from a person is escaped', () =>
    withApp(async (app) => {
      await app.post('/prompts', { name: '<img src=x onerror=alert(1)>' })
      const { html } = await app.page('/prompts')
      assert.doesNotMatch(html, /<img src=x/)
      assert.match(html, /&lt;img src=x/)
    }))

  test('a warning shows near the token limit', () =>
    withApp(async (app) => {
      await app.post(PRODUCT, { ...form, userTemplate: 'x'.repeat(26_000) })
      assert.match((await app.page(PRODUCT)).html, /close to the smallest model/)
    }))
})

describe('runs', () => {
  test('a run keeps the draft, shows as pending, then compares two models', () => {
    const { complete, release } = heldComplete()
    return withApp(
      async (app) => {
        const response = await app.post(`${PRODUCT}/run`, form)
        assert.equal(response.status, 303)
        assert.match((await app.page(PRODUCT)).html, /Running…/)
        release()
        await app.root.lab.settled()
        const { html } = await app.page(PRODUCT)
        assert.doesNotMatch(html, /Running…/)
        assert.match(html, /From Sample Crisp/)
        assert.match(html, /From Sample Detailed/)
        assert.equal(app.root.lab.prompt('prompt-product').systemText, 'Be brief.')
      },
      { complete },
    )
  })

  test('a missing variable comes back as a notice, and the draft is kept', () =>
    withApp(async (app) => {
      const notice = noticeOf(await app.post(`${PRODUCT}/run`, { ...form, 'var.product_name': '' }))
      assert.equal(notice.kind, 'error')
      assert.match(notice.text, /Fill in Product name/)
      assert.equal(app.root.lab.prompt('prompt-product').systemText, 'Be brief.')
      assert.match((await app.page(PRODUCT)).html, /aria-invalid="true"/)
    }))

  test('a model that needs setup, and an unknown prompt', () =>
    withApp(async (app) => {
      assert.match(noticeOf(await app.post(`${PRODUCT}/run`, { ...form, modelA: 'model-local' })).text, /no address/)
      assert.equal(noticeOf(await app.post('/prompts/nope/run', form)).path, '/prompts')
    }))

  test('a failed run says why', () =>
    withApp(
      async (app) => {
        await app.post(`${PRODUCT}/run`, form)
        await app.root.lab.settled()
        assert.match((await app.page(PRODUCT)).html, /This run failed: It answered 500\./)
      },
      {
        complete: async () => {
          throw new Error('It answered 500.')
        },
      },
    ))

  test('one run in full, a run that is gone, and saving a run as a version', () =>
    withApp(async (app) => {
      const { status, html } = await app.page('/runs/run-seed-a')
      assert.equal(status, 200)
      for (const text of ['Sample Crisp', 'Prompt as sent', 'Write a product description for FlowDesk.', 'Rate this run', '>v3<']) assert.ok(html.includes(text), text)
      assert.equal((await app.page('/runs/nope')).status, 404)
      assert.equal(noticeOf(await app.post('/runs/run-seed-a/save-version', {})).kind, 'error')
      await app.post(PRODUCT, form)
      await app.post(`${PRODUCT}/run`, form)
      await app.root.lab.settled()
      const run = app.root.lab.latestComparison('prompt-product')[0]
      assert.equal((await app.page(`/runs/${run?.id}`)).html.includes('Unsaved draft'), true)
      assert.equal(noticeOf(await app.post(`/runs/${run?.id}/save-version`, {})).text, 'Saved as v4.')
      assert.equal(noticeOf(await app.post('/runs/nope/save-version', {})).path, '/prompts')
    }))
})

describe('evaluations', () => {
  test('the evaluation set, narrowed to a prompt, and empty', () =>
    withApp(async (app) => {
      const all = (await app.page('/evaluations')).html
      assert.match(all, /Evaluation set/)
      assert.match(all, /Sample Detailed/)
      assert.match(all, /4\.0 \/ 5/)
      assert.match((await app.page('/evaluations?prompt=prompt-sql')).html, /Nothing rated yet/)
    }))

  test('choosing a winner offers to save it, and a winner needs both runs', () =>
    withApp(async (app) => {
      const notice = noticeOf(await app.post('/comparisons/comparison-seed/winner', { slot: 'B' }))
      assert.equal(notice.text, 'B is the winner.')
      const { html } = await app.page(PRODUCT)
      assert.match(html, /B is the winner: Sample Detailed/)
      assert.match(html, /Save the winner as a version/)
      assert.equal(noticeOf(await app.post('/comparisons/nope/winner', { slot: 'A' })).path, '/prompts')
      await app.post(`${PRODUCT}/run`, { ...form, modelB: '' })
      await app.root.lab.settled()
      const comparison = app.root.lab.latestComparison('prompt-product')[0]?.comparisonId
      assert.equal(noticeOf(await app.post(`/comparisons/${comparison}/winner`, { slot: 'A' })).kind, 'error')
    }))

  test('a rating is saved and shown, and a bad one is refused', () =>
    withApp(async (app) => {
      assert.equal(noticeOf(await app.post('/runs/run-seed-a/rate', { criterion: 'Tone', rating: '4', note: 'Warm' })).text, 'Rating saved.')
      assert.match((await app.page('/runs/run-seed-a')).html, /Warm/)
      assert.equal(noticeOf(await app.post('/runs/run-seed-a/rate', { criterion: 'Tone', rating: '9' })).kind, 'error')
      assert.equal(noticeOf(await app.post('/runs/nope/rate', { criterion: 'Tone', rating: '3' })).path, '/prompts')
    }))
})

describe('models', () => {
  const input = { name: 'Local', model: 'llama', baseUrl: 'http://127.0.0.1:11434/v1', keyEnv: '', contextTokens: '4096', costPer1k: '0' }

  test('the list shows who is ready and who needs setup', () =>
    withApp(async (app) => {
      const { html } = await app.page('/settings/models')
      assert.match(html, /Sample Crisp/)
      assert.match(html, /Needs setup/)
      assert.match((await app.page('/settings/models?edit=model-local')).html, /Edit My model/)
      assert.match((await app.page('/settings/models?confirm=model-local')).html, /Remove My model\?/)
    }))

  test('add, change and remove a model, with bad input refused', () =>
    withApp(async (app) => {
      assert.equal(noticeOf(await app.post('/settings/models', input)).text, 'Local was added.')
      assert.equal(noticeOf(await app.post('/settings/models', { ...input, baseUrl: 'nope' })).kind, 'error')
      assert.equal(noticeOf(await app.post('/settings/models/model-local', input)).text, 'Local was saved.')
      assert.equal(app.root.lab.problem(app.root.lab.model('model-local')), undefined)
      assert.equal(noticeOf(await app.post('/settings/models/sample-crisp', input)).kind, 'error')
      assert.equal(noticeOf(await app.post('/settings/models/model-local/delete', {})).text, 'Local was removed.')
      assert.equal(noticeOf(await app.post('/settings/models/sample-crisp/delete', {})).kind, 'error')
      assert.equal(noticeOf(await app.post('/settings/models/nope/delete', {})).kind, 'error')
    }))
})

describe('forms from another site', () => {
  test('are refused on every page', () =>
    withApp(async (app) => {
      const foreign = { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }
      assert.equal((await app.post('/settings/models', { name: 'x' }, foreign)).status, 403)
      assert.equal((await app.post(`${PRODUCT}/delete`, {}, foreign)).status, 403)
      assert.ok(app.root.lab.find('prompt-product'))
    }))
})
