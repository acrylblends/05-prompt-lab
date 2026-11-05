/**
 * The models a prompt can run on: two offline samples that work from the first start, and any OpenAI-compatible address a person adds. A key is never typed
 * here: a model names the environment variable that holds it.
 *
 * Routes (under the shell's prefix): GET /settings/models?edit=<id>&confirm=<id>, POST /settings/models, POST /settings/models/:id, POST /settings/models/:id/delete.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Acryl } from '../acryl-router/src/index.ts'
import type { Model } from '../lab/index.ts'

export const name = 'models'
export const inject = ['lab', 'shell', 'router']

export function apply(ctx: Context): void {
  const { lab, shell } = ctx
  const { isRefusal } = lab.kit
  const e = shell.e
  const prefix = shell.prefix
  const PAGE = '/settings/models'
  const link = (id: string, tail = ''): string => `${PAGE}/${encodeURIComponent(id)}${tail}`

  const row = (model: Model): string => {
    const problem = lab.problem(model)
    const status = problem === undefined ? '<span class="badge">Ready</span>' : `<span class="badge off">Needs setup</span><br><small>${e(problem)}</small>`
    const actions =
      model.provider === 'sample'
        ? '<small>Offline stand-in, not a real model</small>'
        : `<div class="actions"><a class="btn small" href="${shell.href(`${PAGE}?edit=${encodeURIComponent(model.id)}`)}">Edit</a><a class="btn small danger" href="${shell.href(`${PAGE}?confirm=${encodeURIComponent(model.id)}`)}">Remove</a></div>`
    return `<tr><td><b>${e(model.name)}</b></td><td>${model.provider === 'sample' ? 'Sample' : 'OpenAI-compatible'}</td><td>${model.contextTokens.toLocaleString('en-US')}</td><td>€${model.costPer1k}</td><td>${status}</td><td>${actions}</td></tr>`
  }

  const form = (model: Model | undefined): string => {
    const action = shell.href(model === undefined ? PAGE : link(model.id))
    const field = (label: string, field: string, value: string, extra = '') => `<label>${label}<input class="field" name="${field}" value="${e(value)}" ${extra}></label>`
    return `<section class="panel"><h2>${model === undefined ? 'Add a model' : `Edit ${e(model.name)}`}</h2><form method="post" action="${action}"><div class="row">${field('Name', 'name', model?.name ?? '', 'required maxlength="60" placeholder="Local Llama"')}${field('Model id', 'model', model?.model ?? '', 'required maxlength="120" placeholder="llama3.2"')}${field('Address', 'baseUrl', model?.baseUrl ?? '', 'maxlength="300" placeholder="http://127.0.0.1:11434/v1"')}${field('Key variable (optional)', 'keyEnv', model?.keyEnv ?? '', 'maxlength="80" placeholder="MY_MODEL_KEY"')}${field('Context size, tokens', 'contextTokens', String(model?.contextTokens ?? 8000), 'required inputmode="numeric"')}${field('Cost, € per 1,000 tokens', 'costPer1k', String(model?.costPer1k ?? 0), 'inputmode="decimal"')}</div><p class="actions" style="margin-bottom:0"><button class="btn primary">Save model</button>${model === undefined ? '' : `<a class="btn" href="${shell.href(PAGE)}">Cancel</a>`}</p></form></section>`
  }

  const back = (kind: 'ok' | 'error', text: string, query = ''): string => shell.url(`${PAGE}${query}`, { kind, text })

  const app = new Acryl()
    .get(PAGE, (c) => {
      const models = lab.models()
      const editing = models.find((model) => model.id === c.req.query('edit') && model.provider !== 'sample')
      const leaving = models.find((model) => model.id === c.req.query('confirm') && model.provider !== 'sample')
      const confirm =
        leaving === undefined
          ? ''
          : `<section class="panel" role="alert"><h2>Remove ${e(leaving.name)}?</h2><p>Past runs keep their results.</p><form class="actions" method="post" action="${shell.href(link(leaving.id, '/delete'))}"><button class="btn danger">Yes, remove</button><a class="btn" href="${shell.href(PAGE)}">Cancel</a></form></section>`
      const main = `<div class="title"><div><span class="kicker">Settings / Models</span><h1>Models</h1><p>The samples work offline. Add any OpenAI-compatible address to run on a real model; the key stays in your environment.</p></div></div>${shell.notice(c.req.url)}${confirm}<div class="scroll"><table><thead><tr><th>Name</th><th>Provider</th><th>Context</th><th>Per 1k</th><th>Status</th><th></th></tr></thead><tbody>${models.map(row).join('')}</tbody></table></div>${form(editing)}`
      return c.html(shell.page({ active: 'models', title: 'Models', main }))
    })
    .post(PAGE, async (c) => {
      const input = await c.req.parseBody()
      try {
        const model = await lab.saveModel(undefined, { name: input.name, model: input.model, baseUrl: input.baseUrl, keyEnv: input.keyEnv, contextTokens: input.contextTokens, costPer1k: input.costPer1k })
        return c.redirect(back('ok', `${model.name} was added.`), 303)
      } catch (error) {
        if (!isRefusal(error)) throw error
        return c.redirect(back('error', error.message), 303)
      }
    })
    .post(`${PAGE}/:id`, async (c) => {
      const input = await c.req.parseBody()
      const id = c.req.param('id')
      try {
        const model = await lab.saveModel(id, { name: input.name, model: input.model, baseUrl: input.baseUrl, keyEnv: input.keyEnv, contextTokens: input.contextTokens, costPer1k: input.costPer1k })
        return c.redirect(back('ok', `${model.name} was saved.`), 303)
      } catch (error) {
        if (!isRefusal(error)) throw error
        return c.redirect(back('error', error.message, `?edit=${encodeURIComponent(id)}`), 303)
      }
    })
    .post(`${PAGE}/:id/delete`, async (c) => {
      const id = c.req.param('id')
      try {
        const { name: modelName } = lab.model(id)
        await lab.removeModel(id)
        return c.redirect(back('ok', `${modelName} was removed.`), 303)
      } catch (error) {
        if (!isRefusal(error)) throw error
        return c.redirect(back('error', error.message), 303)
      }
    })

  ctx.router.route(prefix === '' ? '/' : prefix, app)
  ctx.effect(() => shell.nav({ id: 'models', label: 'Models', path: PAGE, order: 30 }))
}
