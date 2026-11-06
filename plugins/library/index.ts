/**
 * The lab's main page: the prompt library on the left, the prompt editor in the middle and the run comparison on the right. It is the app's first
 * screen. The same plugin owns the new-prompt form, saving a version, running a comparison and the quick evaluation.
 *
 * Routes (under the shell's prefix): GET /, GET /prompts?q&tag&tab, GET /prompts/new, GET /prompts/:id?tab&edit,
 * POST /prompts, POST /prompts/:id/version, POST /prompts/:id/run, POST /prompts/:id/evaluate.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Acryl } from '../acryl-router/src/index.ts'
import { LabError, outputView, type Prompt, type Run, timeOf, whenText } from '../promptlab/index.ts'

export const name = 'library'
export const inject = ['lab', 'shell', 'router']

const escape = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/** The user template with its `{{variables}}` marked, as the mockup shows them. */
const marked = (text: string): string => escape(text).replace(/\{\{\s*[^{}]+?\s*\}\}/gu, (match) => `<mark>${match}</mark>`)

function query(parts: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(parts)) if (value !== undefined && value !== '') search.set(key, value)
  const text = search.toString()
  return text === '' ? '' : `?${text}`
}

export function apply(ctx: Context): void {
  const { lab, shell } = ctx
  const e = shell.e
  const prefix = shell.prefix

  const resultCard = (run: Run, letter: string): string => {
    const view = outputView(run.output)
    if (run.status === 'failed')
      return `<div class="p-result-card alt"><header><b>${letter}</b><span>${e(run.model)}</span><i>failed</i></header><p class="notice error" role="alert">${e(run.error ?? 'The run failed.')}</p><footer><span>${e(timeOf(run.createdAt))}</span><button data-toast="Run details opened">Details</button></footer></div>`
    const body = `<h3>${e(view.headline)}</h3>${view.paragraphs.map((paragraph) => `<p>${e(paragraph)}</p>`).join('')}${view.bullets.length === 0 ? '' : `<ul>${view.bullets.map((bullet) => `<li>${e(bullet)}</li>`).join('')}</ul>`}`
    return `<div class="p-result-card${letter === 'B' ? ' alt' : ''}"><header><b>${letter}</b><span>${e(run.model)}</span><i>${(run.durationMs / 1000).toFixed(1)}s</i></header>${body}<footer><span>${String(run.tokens)} tokens</span><button data-copy="run-${e(run.id)}">Copy output</button></footer><pre id="run-${e(run.id)}" hidden>${e(run.output)}</pre></div>`
  }

  const quickEvaluation = (prompt: Prompt, runs: readonly Run[], back: string): string => {
    const [first, second] = runs
    if (first === undefined) return ''
    const rated = lab.evaluationOf(first.id, 'concreteness') ?? (second === undefined ? undefined : lab.evaluationOf(second.id, 'concreteness'))
    if (rated !== undefined)
      return `<div class="p-eval"><b>QUICK EVALUATION</b><p>Rated ${String(rated.rating)}/5 on ${e(rated.criterion)}: ${e(rated.note)}</p>${shell.has('evaluations') ? `<a href="${shell.href('/evaluations')}" style="font-size:7px;color:#665d84">All evaluations ↗</a>` : ''}</div>`
    const button = (run: Run, letter: string): string =>
      `<form method="post" action="${shell.href(`/prompts/${encodeURIComponent(prompt.id)}/evaluate`)}" style="display:inline"><input type="hidden" name="winner" value="${e(run.id)}"><input type="hidden" name="other" value="${e(letter === 'A' ? second?.id ?? '' : first.id)}"><input type="hidden" name="back" value="${e(back)}"><button>${letter} is better</button></form>`
    return `<div class="p-eval"><b>QUICK EVALUATION</b><p>Which answer is more concrete?</p>${button(first, 'A')}${second === undefined ? '' : button(second, 'B')}</div>`
  }

  const labPage = (
    read: (name: string) => string | undefined,
    requested: string | undefined,
    url: string,
  ): string => {
    const q = (read('q') ?? '').slice(0, 120)
    const tag = (read('tag') ?? '').slice(0, 40) || undefined
    const tab = read('tab') === 'history' ? 'history' : read('tab') === 'evaluations' ? 'evaluations' : 'editor'
    const prompts = lab.prompts({ q, ...(tag === undefined ? {} : { tag }) })
    const prompt = (requested === undefined ? undefined : lab.prompt(requested)) ?? prompts[0]
    const promptsHtml = prompts.length === 0
      ? '<p class="p-empty">No prompts match that search.</p>'
      : prompts.map((item) => `<a href="${shell.href(`/prompts/${encodeURIComponent(item.id)}${query({ q, tag })}`)}" style="text-decoration:none;color:inherit"><article${item.id === prompt?.id ? ' class="selected"' : ''} data-row${item.id === prompt?.id ? '' : ''}><b>${e(item.name)}</b><small>${e(item.tags[0] ?? 'prompt')} · ${e(whenText(item.updatedAt, new Date()))}</small>${item.id === prompt?.id ? '<i>✦</i>' : ''}</article></a>`).join('')
    const allTags = new Map<string, number>()
    for (const item of lab.prompts()) for (const tagName of item.tags) allTags.set(tagName, (allTags.get(tagName) ?? 0) + 1)
    const tagsHtml = [...allTags.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => `<p><a href="${shell.href(`/prompts?tag=${encodeURIComponent(name)}`)}" style="color:inherit;text-decoration:none">◫ ${e(name)} <span style="float:right;color:#a5a0b8">${String(count)}</span></a></p>`)
      .join('')
    const library = `<aside class="p-library"><div class="p-lib-head"><b>Prompt library</b><a href="${shell.href('/prompts/new')}" style="text-decoration:none;background:white;border:1px solid #e2dfed;border-radius:5px;color:#7254d2;padding:3px 7px">＋</a></div><form class="p-search" method="get" action="${shell.href('/prompts')}"><input name="q" value="${e(q)}" placeholder="Find a prompt…" aria-label="Find a prompt" data-search="#promptrows"></form><div class="p-filter">ALL PROMPTS <span>${String(lab.prompts().length)}</span></div><div id="promptrows">${promptsHtml}</div><div class="p-lib-foot"><b>TAGS</b>${tagsHtml === '' ? '<p>No tags yet.</p>' : tagsHtml}</div></aside>`

    if (prompt === undefined)
      return shell.page({
        active: 'library',
        title: 'Prompt Lab',
        crumbs: ['Prompt Lab'],
        main: `<div class="p-layout">${library}<main class="p-work"><div class="p-title"><div><small>PROMPT LAB</small><h1>No prompts yet</h1><p>Make the first prompt in the library.</p></div></div><p class="p-empty">The library is empty. <a href="${shell.href('/prompts/new')}">New prompt</a></p></main><aside class="p-results"><div class="p-results-head"><b>Run comparison</b><span>No runs yet</span></div></aside></div>`,
      })

    const versions = lab.versions(prompt.id)
    const runs = lab.latestRuns(prompt.id)
    const inputs = runs[0]?.inputs ?? {}
    const edit = read('edit') === '1'
    const back = `/prompts/${encodeURIComponent(prompt.id)}${query({ q, tag, tab, edit: edit ? '1' : undefined })}`
    const tabs = `<div class="p-tabs" data-tabs><a href="${shell.href(`/prompts/${encodeURIComponent(prompt.id)}${query({ q, tag })}`)}"${tab === 'editor' ? ' class="active"' : ''}>Prompt editor</a><a href="${shell.href(`/prompts/${encodeURIComponent(prompt.id)}?tab=history`)}"${tab === 'history' ? ' class="active"' : ''}>Version history (${String(versions.length)})</a><a href="${shell.href(`/prompts/${encodeURIComponent(prompt.id)}?tab=evaluations`)}"${tab === 'evaluations' ? ' class="active"' : ''}>Evaluations (${String(lab.evaluations().length)})</a></div>`

    let work: string
    if (tab === 'history') {
      work = `<section class="p-section"><header><b>Version history</b><small>${String(versions.length)} revisions</small></header><table><thead><tr><th>REVISION</th><th>SAVED</th><th>TEXT</th></tr></thead><tbody>${versions.length === 0 ? '<tr><td colspan="3">No versions yet.</td></tr>' : versions.map((version) => `<tr><td><b>v${String(version.revision)}</b></td><td>${e(whenText(version.createdAt, new Date()))}</td><td><code>${e(version.content.slice(0, 140))}${version.content.length > 140 ? '…' : ''}</code></td></tr>`).join('')}</tbody></table></section>`
    } else if (tab === 'evaluations') {
      const promptRuns = new Set(lab.runs(prompt.id).map((run) => run.id))
      const evaluations = lab.evaluations().filter((evaluation) => promptRuns.has(evaluation.runId))
      work = `<section class="p-section"><header><b>Evaluations</b><small>${String(evaluations.length)} ratings</small></header><table><thead><tr><th>RUN</th><th>CRITERION</th><th>RATING</th><th>NOTE</th></tr></thead><tbody>${evaluations.length === 0 ? '<tr><td colspan="4">No evaluations yet. Rate a comparison below.</td></tr>' : evaluations.map((evaluation) => {
        const run = lab.run(evaluation.runId)
        return `<tr><td><a href="${shell.href(`/runs/${encodeURIComponent(evaluation.runId)}`)}">${e(run?.model ?? evaluation.runId)}</a></td><td>${e(evaluation.criterion)}</td><td>${String(evaluation.rating)}/5</td><td>${e(evaluation.note)}</td></tr>`
      }).join('')}</tbody></table></section>`
    } else if (edit) {
      work = `<form method="post" action="${shell.href(`/prompts/${encodeURIComponent(prompt.id)}/version`)}"><div class="p-editor-head"><span><b>Prompt details</b><small>Name, description and tags appear in the library</small></span></div><div class="p-form"><div class="row"><label>NAME<input name="name" required maxlength="120" value="${e(prompt.name)}"></label><label>TAGS<input name="tags" maxlength="240" value="${e(prompt.tags.join(', '))}" placeholder="marketing, copy"></label></div><label>DESCRIPTION<input name="description" required maxlength="300" value="${e(prompt.description)}"></label><label>SYSTEM INSTRUCTION<textarea name="systemText" required>${e(prompt.systemText)}</textarea></label><label>USER PROMPT<textarea name="userTemplate" required>${e(prompt.userTemplate)}</textarea></label><div class="actions"><button class="primary">Save version</button><a href="${shell.href(back.replace('&edit=1', ''))}">Cancel</a></div></div><input type="hidden" name="back" value="${e(back)}"></form>`
    } else {
      const variableInputs = prompt.variables.map((name) => `<label>${e(name.toUpperCase())}<input name="var-${e(name)}" value="${e(inputs[name] ?? '')}" placeholder="value"></label>`).join('')
      const models = lab.model.models
      const modelOptions = models.map((name) => `<option value="${e(name)}">${e(name)}</option>`).join('')
      const modelNote = lab.model.configured
        ? `${e(lab.model.provider)} · ${String(models.length)} models`
        : 'Needs a key: set DEEPSEEK_API_KEY and restart to run live. The results on the right are seeded examples.'
      work = `<div class="p-editor-head"><span><b>System instruction</b><small>Set the model's role and boundaries</small></span><a href="${shell.href(`/prompts/${encodeURIComponent(prompt.id)}?edit=1`)}" style="font-size:8px;color:#8c83a8;text-decoration:none">Edit ↗</a></div><div class="p-system">${e(prompt.systemText)}</div><div class="p-editor-head"><span><b>User prompt</b><small>Use {{variables}} to make this prompt reusable</small></span><span class="p-token">${String(prompt.userTemplate.length)} chars</span></div><div class="p-userprompt">${marked(prompt.userTemplate).replaceAll('\n', '<br/>')}</div><form method="post" action="${shell.href(`/prompts/${encodeURIComponent(prompt.id)}/run`)}"><div class="p-vars"><b>INPUT VARIABLES</b><div>${variableInputs === '' ? '<p class="p-note">This prompt has no variables.</p>' : variableInputs}</div></div><div class="p-modelbar"><span>MODEL CONFIGURATION · ${e(modelNote)}</span><label>Model A <select name="modelA" style="display:block;margin-top:4px;border:1px solid #e5e2ed;border-radius:4px;padding:5px;font-size:8px;background:white">${modelOptions}</select></label><label>Model B <select name="modelB" style="display:block;margin-top:4px;border:1px solid #e5e2ed;border-radius:4px;padding:5px;font-size:8px;background:white"><option value="">None</option>${modelOptions}</select></label><label>Temperature <input name="temperature" value="0.6" inputmode="decimal" style="display:block;width:60px;margin-top:4px;border:1px solid #e5e2ed;border-radius:4px;padding:5px;font-size:8px"></label><button>▶ Run comparison</button></div><input type="hidden" name="back" value="${e(back)}"></form>`
    }

    const lastRun = [...lab.runs(prompt.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    const cards = runs.length === 0
      ? `<p class="p-empty">No runs yet. Fill the variables and run a comparison.</p>`
      : runs.map((run, index) => resultCard(run, index === 0 ? 'A' : 'B')).join('')
    const results = `<aside class="p-results"><div class="p-results-head"><b>Run comparison</b><span>${lastRun === undefined ? 'No run yet' : `Last run · ${e(timeOf(lastRun.createdAt))}`}</span></div>${cards}${quickEvaluation(prompt, runs, back)}</aside>`
    const main = `<div class="p-layout">${library}<main class="p-work">${shell.notice(url)}<div class="p-title"><div><small>${e(prompt.tags[0] ?? 'PROMPT').toUpperCase()} / ${e(prompt.name).toUpperCase()}</small><h1>${e(prompt.name)}</h1><p>${e(prompt.description)}</p></div><a href="${shell.href(`/prompts/${encodeURIComponent(prompt.id)}?edit=1`)}" style="text-decoration:none;background:white;border:1px solid #e3e0eb;padding:8px;border-radius:5px;font-size:8px;color:#6e62a2">↗ ${edit ? 'Editing' : 'Edit & save version'}</a></div>${tabs}${work}</main>${results}</div>`
    return shell.page({ active: 'library', title: prompt.name, crumbs: ['Prompt Lab', prompt.name], main })
  }

  const newPage = (values: { name?: string; description?: string; systemText?: string; userTemplate?: string; tags?: string }, error?: string): string =>
    `<div class="p-page"><header><div><small>PROMPT LAB / NEW PROMPT</small><h1>New prompt</h1><p>A reusable prompt with its variables read from the user text.</p></div></header>${error === undefined ? '' : `<p class="notice error" role="alert">${e(error)}</p>`}<form method="post" action="${shell.href('/prompts')}"><div class="p-form"><div class="row"><label>NAME<input name="name" required maxlength="120" value="${e(values.name ?? '')}" placeholder="Product description"></label><label>TAGS<input name="tags" maxlength="240" value="${e(values.tags ?? '')}" placeholder="marketing, copy"></label></div><label>DESCRIPTION<input name="description" required maxlength="300" value="${e(values.description ?? '')}" placeholder="What the prompt is for"></label><label>SYSTEM INSTRUCTION<textarea name="systemText" required placeholder="You are a…">${e(values.systemText ?? '')}</textarea></label><label>USER PROMPT<textarea name="userTemplate" required placeholder="Write a description for {{product_name}}…">${e(values.userTemplate ?? '')}</textarea></label><div class="actions"><button class="primary">Create prompt</button><a href="${shell.href('/prompts')}">Cancel</a></div></div></form></div>`

  const app = new Acryl()
    .get('/', (c) => c.redirect(shell.href('/prompts'), 302))
    .get('/prompts', (c) => c.html(labPage((name) => c.req.query(name), undefined, c.req.url)))
    .get('/prompts/new', (c) => c.html(newPage({})))
    .get('/prompts/:id', (c) => {
      const prompt = lab.prompt(c.req.param('id'))
      if (prompt === undefined) return c.redirect(shell.url('/prompts', { kind: 'error', text: 'That prompt no longer exists.' }), 303)
      return c.html(labPage((name) => c.req.query(name), prompt.id, c.req.url))
    })
    .post('/prompts', async (c) => {
      const form = await c.req.parseBody()
      try {
        const prompt = await lab.createPrompt({
          name: String(form.name ?? ''),
          description: String(form.description ?? ''),
          systemText: String(form.systemText ?? ''),
          userTemplate: String(form.userTemplate ?? ''),
          tags: String(form.tags ?? ''),
        })
        return c.redirect(shell.url(`/prompts/${encodeURIComponent(prompt.id)}`, { kind: 'ok', text: `“${prompt.name}” was created.` }), 303)
      } catch (error) {
        if (!(error instanceof LabError)) throw error
        return c.html(newPage({ name: String(form.name ?? ''), description: String(form.description ?? ''), systemText: String(form.systemText ?? ''), userTemplate: String(form.userTemplate ?? ''), tags: String(form.tags ?? '') }, error.message))
      }
    })
    .post('/prompts/:id/version', async (c) => {
      const form = await c.req.parseBody()
      const back = shell.back(form.back, `/prompts/${encodeURIComponent(c.req.param('id'))}`)
      try {
        const prompt = await lab.updatePrompt(c.req.param('id'), {
          name: String(form.name ?? ''),
          description: String(form.description ?? ''),
          systemText: String(form.systemText ?? ''),
          userTemplate: String(form.userTemplate ?? ''),
          tags: String(form.tags ?? ''),
        })
        const version = await lab.saveVersion(prompt.id)
        return c.redirect(shell.url(back, { kind: 'ok', text: `Version ${String(version.revision)} saved.` }), 303)
      } catch (error) {
        if (!(error instanceof LabError)) throw error
        return c.redirect(shell.url(back, { kind: 'error', text: error.message }), 303)
      }
    })
    .post('/prompts/:id/run', async (c) => {
      const form = await c.req.parseBody()
      const back = shell.back(form.back, `/prompts/${encodeURIComponent(c.req.param('id'))}`)
      const prompt = lab.prompt(c.req.param('id'))
      if (prompt === undefined) return c.redirect(shell.url('/prompts', { kind: 'error', text: 'That prompt no longer exists.' }), 303)
      const inputs: Record<string, string> = {}
      for (const name of prompt.variables) inputs[name] = String(form[`var-${name}`] ?? '')
      const models = [String(form.modelA ?? ''), String(form.modelB ?? '')].filter((model) => model !== '')
      try {
        const runs = await lab.startRun(prompt.id, inputs, models, Number(form.temperature ?? 0.6))
        const failed = runs.filter((run) => run.status === 'failed')
        return c.redirect(shell.url(back, failed.length === 0
          ? { kind: 'ok', text: `Compared ${String(runs.length)} run${runs.length === 1 ? '' : 's'}.` }
          : { kind: 'error', text: `${String(failed.length)} run${failed.length === 1 ? '' : 's'} failed: ${failed[0]?.error ?? ''}` }), 303)
      } catch (error) {
        if (!(error instanceof LabError)) throw error
        return c.redirect(shell.url(back, { kind: 'error', text: error.message }), 303)
      }
    })
    .post('/prompts/:id/evaluate', async (c) => {
      const form = await c.req.parseBody()
      const back = shell.back(form.back, `/prompts/${encodeURIComponent(c.req.param('id'))}`)
      try {
        await lab.rate(String(form.winner ?? ''), 'concreteness', 5, 'Quick comparison: more concrete.')
        if (String(form.other ?? '') !== '') await lab.rate(String(form.other), 'concreteness', 3, 'Quick comparison: less concrete.')
        return c.redirect(shell.url(back, { kind: 'ok', text: 'The comparison was rated.' }), 303)
      } catch (error) {
        if (!(error instanceof LabError)) throw error
        return c.redirect(shell.url(back, { kind: 'error', text: error.message }), 303)
      }
    })

  ctx.router.route(prefix === '' ? '/' : prefix, app)
  ctx.effect(() => shell.nav({ id: 'library', label: 'Lab', icon: '✳', path: '/prompts', order: 10, count: () => lab.prompts().length }))
}

