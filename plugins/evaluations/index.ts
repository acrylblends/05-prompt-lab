/**
 * Judging runs: the quick "which is better" under a comparison, ratings on one run, and the evaluation set with how each model did.
 *
 * Routes (under the shell's prefix): GET /evaluations?prompt=<id>, POST /comparisons/:id/winner, POST /runs/:id/rate.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Acryl } from '../acryl-router/src/index.ts'
import type { Run } from '../lab/index.ts'

export const name = 'evaluations'
export const inject = ['lab', 'shell', 'router']

export function apply(ctx: Context): void {
  const { lab, shell } = ctx
  const { CRITERIA, isRefusal, PREFERRED, whenText } = lab.kit
  const e = shell.e
  const prefix = shell.prefix
  const promptLink = (id: string): string => `/prompts/${encodeURIComponent(id)}`

  const table = (promptId?: string): string => {
    const scores = lab
      .scores(promptId)
      .map((row) => `<tr><td>${e(row.model)}</td><td>${row.runs}</td><td>${row.rated}</td><td>${row.average === undefined ? '–' : `${row.average.toFixed(1)} / 5`}</td><td>${row.wins}</td></tr>`)
      .join('')
    const ratings = lab
      .evaluations(promptId)
      .map(({ evaluation, run, prompt }) => {
        const rating = evaluation.criterion === PREFERRED ? 'Winner' : `${evaluation.rating} / 5`
        return `<tr><td>${e(whenText(evaluation.createdAt, lab.today))}</td><td><a href="${shell.href(promptLink(prompt.id))}">${e(prompt.name)}</a></td><td><a href="${shell.href(`/runs/${encodeURIComponent(run.id)}`)}">${e(run.modelName)}</a></td><td>${e(evaluation.criterion)}</td><td>${rating}</td><td>${e(evaluation.note)}</td></tr>`
      })
      .join('')
    if (ratings === '') return '<p class="empty">Nothing rated yet. Run a comparison and choose the better answer.</p>'
    return `<div class="scroll"><table><thead><tr><th>Model</th><th>Runs</th><th>Ratings</th><th>Average</th><th>Wins</th></tr></thead><tbody>${scores}</tbody></table></div><div class="scroll"><table><thead><tr><th>When</th><th>Prompt</th><th>Model</th><th>Criterion</th><th>Rating</th><th>Note</th></tr></thead><tbody>${ratings}</tbody></table></div>`
  }

  const quick = (runs: readonly Run[]): string => {
    const first = runs[0]
    if (first === undefined || runs.length < 2 || runs.some((run) => run.status !== 'done')) return ''
    const winner = lab.winner(first.comparisonId)
    const action = shell.href(`/comparisons/${encodeURIComponent(first.comparisonId)}/winner`)
    const pick = (slot: string) => `<button class="btn small" name="slot" value="${slot}"${winner?.slot === slot ? ' aria-pressed="true"' : ''}>${slot} is better</button>`
    const save =
      winner === undefined ? '' : `<form method="post" action="${shell.href(`/runs/${encodeURIComponent(winner.id)}/save-version`)}" style="margin-top:8px"><button class="btn small">↗ Save the winner as a version</button></form>`
    return `<section class="quick"><span class="kicker">Quick evaluation</span><p>${winner === undefined ? 'Which answer is more concrete?' : `${winner.slot} is the winner: ${e(winner.modelName)}.`}</p><form class="actions" method="post" action="${action}">${pick('A')}${pick('B')}</form>${save}</section>`
  }

  const rateForm = (run: Run): string => {
    if (run.status !== 'done') return ''
    const given = lab
      .evaluationsOf(run.id)
      .map((item) => `<tr><td>${e(item.criterion)}</td><td>${item.criterion === PREFERRED ? 'Winner' : `${item.rating} / 5`}</td><td>${e(item.note)}</td></tr>`)
      .join('')
    const criteria = CRITERIA.map((item) => `<option>${item}</option>`).join('')
    const ratings = [5, 4, 3, 2, 1].map((item) => `<option>${item}</option>`).join('')
    return `<section class="panel"><h2>Rate this run</h2>${given === '' ? '' : `<div class="scroll"><table>${given}</table></div>`}<form method="post" action="${shell.href(`/runs/${encodeURIComponent(run.id)}/rate`)}"><div class="row" style="margin-top:10px"><label>Criterion<select class="field" name="criterion">${criteria}</select></label><label>Rating<select class="field" name="rating">${ratings}</select></label><label>Note<input class="field" name="note" maxlength="300"></label><button class="btn primary">Save rating</button></div></form></section>`
  }

  const app = new Acryl()
    .get('/evaluations', (c) => {
      const promptId = c.req.query('prompt')
      const chosen = promptId === undefined || promptId === '' ? undefined : lab.find(promptId)
      const options = lab.prompts().map((prompt) => `<option value="${e(prompt.id)}"${prompt.id === chosen?.id ? ' selected' : ''}>${e(prompt.name)}</option>`).join('')
      const main = `<div class="title"><div><span class="kicker">Lab / Evaluations</span><h1>Evaluation set</h1><p>What you rated, and how each model is doing.</p></div><form class="actions" method="get" action="${shell.href('/evaluations')}"><select class="field" name="prompt" aria-label="Prompt" onchange="this.form.submit()"><option value="">All prompts</option>${options}</select><noscript><button class="btn">Show</button></noscript></form></div>${shell.notice(c.req.url)}${table(chosen?.id)}`
      return c.html(shell.page({ active: 'evaluations', title: 'Evaluations', main }))
    })
    .post('/comparisons/:id/winner', async (c) => {
      const form = await c.req.parseBody()
      const id = c.req.param('id')
      const promptId = lab.comparison(id)[0]?.promptId
      if (promptId === undefined) return c.redirect(shell.url('/prompts', { kind: 'error', text: 'That comparison no longer exists.' }), 303)
      try {
        const run = await lab.pickWinner(id, form.slot === 'B' ? 'B' : 'A')
        return c.redirect(shell.url(promptLink(promptId), { kind: 'ok', text: `${run.slot} is the winner.` }), 303)
      } catch (error) {
        if (!isRefusal(error)) throw error
        return c.redirect(shell.url(promptLink(promptId), { kind: 'error', text: error.message }), 303)
      }
    })
    .post('/runs/:id/rate', async (c) => {
      const form = await c.req.parseBody()
      const id = c.req.param('id')
      const back = `/runs/${encodeURIComponent(id)}`
      try {
        await lab.rate(id, { criterion: form.criterion, rating: form.rating, note: form.note })
        return c.redirect(shell.url(back, { kind: 'ok', text: 'Rating saved.' }), 303)
      } catch (error) {
        if (!isRefusal(error)) throw error
        return c.redirect(shell.url(error.code === 'not-found' ? '/prompts' : back, { kind: 'error', text: error.message }), 303)
      }
    })

  ctx.router.route(prefix === '' ? '/' : prefix, app)
  ctx.effect(() => shell.nav({ id: 'evaluations', label: 'Evaluations', path: '/evaluations', order: 20 }))
  ctx.effect(() => shell.slot('comparison-footer', ({ runs }) => quick(runs ?? [])))
  ctx.effect(() => shell.slot('run-footer', ({ run }) => (run === undefined ? '' : rateForm(run))))
  ctx.effect(() => shell.slot('prompt-evaluations', ({ prompt }) => (prompt === undefined ? '' : table(prompt.id))))
}
