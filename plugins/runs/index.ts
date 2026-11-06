/**
 * Runs and evaluations: one run in full (its prompt, inputs, output, model, tokens, duration and the rating form) and the evaluation log.
 *
 * Routes (under the shell's prefix): GET /runs/:id, GET /evaluations, POST /runs/:id/rating.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Acryl } from '../acryl-router/src/index.ts'
import { LabError, outputView, ratingText, whenText } from '../promptlab/index.ts'

export const name = 'runs'
export const inject = ['lab', 'shell', 'router']

export function apply(ctx: Context): void {
  const { lab, shell } = ctx
  const e = shell.e
  const prefix = shell.prefix

  const runPage = (id: string, error?: string): string | undefined => {
    const run = lab.run(id)
    if (run === undefined) return undefined
    const prompt = lab.promptOf(run)
    const view = outputView(run.output)
    const evaluation = lab.evaluationOf(run.id, 'concreteness')
    const inputs = Object.entries(run.inputs).map(([name, value]) => `<tr><td>${e(name)}</td><td>${e(value)}</td></tr>`).join('')
    const main = `<div class="p-page"><header><div><small>PROMPT LAB / RUNS</small><h1>${e(run.model)}</h1><p>${prompt === undefined ? 'A run of a prompt that no longer exists.' : e(prompt.name)} · ${e(whenText(run.createdAt, new Date()))}</p></div><a href="${shell.href(prompt === undefined ? '/prompts' : `/prompts/${encodeURIComponent(prompt.id)}`)}" style="font-size:9px;color:#7153c8;text-decoration:none">Back to the prompt ↗</a></header>${error === undefined ? '' : `<p class="notice error" role="alert">${e(error)}</p>`}<section class="p-section"><header><b>Run</b><small><span class="p-badge ${run.status === 'done' ? 'done' : run.status === 'failed' ? 'failed' : ''}">${e(run.status)}</span></small></header><table><tbody><tr><td>Prompt</td><td>${prompt === undefined ? '—' : `<a href="${shell.href(`/prompts/${encodeURIComponent(prompt.id)}`)}">${e(prompt.name)}</a>`}</td></tr><tr><td>Model</td><td>${e(run.model)}</td></tr><tr><td>Tokens</td><td>${String(run.tokens)}</td></tr><tr><td>Duration</td><td>${(run.durationMs / 1000).toFixed(2)} s</td></tr><tr><td>Started</td><td>${e(run.createdAt)}</td></tr>${inputs}</tbody></table></section>${run.status === 'failed' ? `<p class="notice error" role="alert">${e(run.error ?? 'The run failed.')}</p>` : `<section class="p-section"><header><b>Output</b><small>${e(view.headline)}</small></header><div class="p-userprompt" style="margin:0 15px 15px;white-space:pre-wrap">${e(run.output)}</div></section>`}<section class="p-section"><header><b>Evaluation</b><small>${evaluation === undefined ? 'Not rated yet' : `Rated ${String(evaluation.rating)}/5`}</small></header><form class="p-form" method="post" action="${shell.href(`/runs/${encodeURIComponent(run.id)}/rating`)}"><div class="row"><label>CRITERION<input name="criterion" value="${e(evaluation?.criterion ?? 'concreteness')}" maxlength="60"></label><label>RATING<select name="rating">${[1, 2, 3, 4, 5].map((value) => `<option value="${String(value)}"${(evaluation?.rating ?? 0) === value ? ' selected' : ''}>${String(value)} · ${ratingText(value)}</option>`).join('')}</select></label></div><label>NOTE<input name="note" maxlength="300" value="${e(evaluation?.note ?? '')}" placeholder="What made this answer good or bad?"></label><div class="actions"><button class="primary">Save rating</button></div></form></section></div>`
    return shell.page({ active: 'evaluations', title: `Run · ${run.model}`, crumbs: ['Prompt Lab', 'Runs', run.model], main })
  }

  const evaluationsPage = (): string => {
    const rows = lab.evaluations().map((evaluation) => {
      const run = lab.run(evaluation.runId)
      const prompt = run === undefined ? undefined : lab.promptOf(run)
      return `<tr><td><a href="${shell.href(`/runs/${encodeURIComponent(evaluation.runId)}`)}">${e(run?.model ?? evaluation.runId)}</a></td><td>${prompt === undefined ? '—' : e(prompt.name)}</td><td>${e(evaluation.criterion)}</td><td>${String(evaluation.rating)}/5 · ${e(ratingText(evaluation.rating))}</td><td>${e(evaluation.note)}</td><td>${e(whenText(evaluation.at, new Date()))}</td></tr>`
    }).join('')
    const main = `<div class="p-page"><header><div><small>PROMPT LAB / EVALUATIONS</small><h1>Evaluations</h1><p>Every rating given to a run, newest first</p></div></header><section class="p-section"><header><b>Evaluation log</b><small>${String(lab.evaluations().length)} ratings</small></header><table><thead><tr><th>RUN</th><th>PROMPT</th><th>CRITERION</th><th>RATING</th><th>NOTE</th><th>WHEN</th></tr></thead><tbody>${rows === '' ? '<tr><td colspan="6">No evaluations yet. Rate a comparison on the lab page.</td></tr>' : rows}</tbody></table></section></div>`
    return shell.page({ active: 'evaluations', title: 'Evaluations', crumbs: ['Prompt Lab', 'Evaluations'], main })
  }

  const app = new Acryl()
    .get('/runs/:id', (c) => {
      const main = runPage(c.req.param('id'), c.req.query('error'))
      if (main === undefined) return c.redirect(shell.url('/prompts', { kind: 'error', text: 'That run no longer exists.' }), 303)
      return c.html(main)
    })
    .get('/evaluations', (c) => c.html(evaluationsPage()))
    .post('/runs/:id/rating', async (c) => {
      const form = await c.req.parseBody()
      try {
        await lab.rate(c.req.param('id'), String(form.criterion ?? ''), Number(form.rating), String(form.note ?? ''))
        return c.redirect(shell.url(`/runs/${encodeURIComponent(c.req.param('id'))}`, { kind: 'ok', text: 'Rating saved.' }), 303)
      } catch (error) {
        if (!(error instanceof LabError)) throw error
        return c.redirect(shell.url(`/runs/${encodeURIComponent(c.req.param('id'))}`, { kind: 'error', text: error.message }), 303)
      }
    })

  ctx.router.route(prefix === '' ? '/' : prefix, app)
  ctx.effect(() => shell.nav({ id: 'evaluations', label: 'Evaluations', icon: '◉', path: '/evaluations', order: 30, count: () => lab.evaluations().length }))
}
