/**
 * The prompt library and editor, the app's default work surface: search and tags on the left, the system and user text with their variables in the middle,
 * version history and evaluations as tabs. The results column and the run controls come from the `runs` plugin through the shell's slots.
 *
 * Routes (under the shell's prefix): GET /, GET /prompts, GET /prompts/:id?tab=versions|evaluations&confirm=delete, POST /prompts, POST /prompts/:id,
 * POST /prompts/:id/save-version, POST /prompts/:id/versions/:revision/restore, POST /prompts/:id/delete.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Acryl } from '../acryl-router/src/index.ts'
import type { Prompt } from '../lab/index.ts'

export const name = 'prompts'
export const inject = ['lab', 'shell', 'router']

/** Marks the editor unsaved as soon as a person types, keeps the token count live, and warns before their text is lost. */
const EDITOR_SCRIPT = `<script>
(function(){
  var form=document.getElementById('editor');if(!form)return;
  var dirty=document.getElementById('dirty'),count=document.getElementById('tokens');
  var fill=function(text){return text.replace(/\\{\\{\\s*([A-Za-z_]\\w*)\\s*\\}\\}/g,function(whole,name){var field=form.elements['var.'+name];return field&&field.value.trim()?field.value.trim():whole})};
  form.addEventListener('input',function(){
    window.labDirty=true;if(dirty)dirty.hidden=false;
    if(count)count.textContent=Math.ceil((fill(form.elements.systemText.value)+fill(form.elements.userTemplate.value)).length/4).toLocaleString('en-US')+' tokens';
  });
  form.addEventListener('submit',function(){window.labDirty=false});
  window.addEventListener('beforeunload',function(event){if(window.labDirty)event.preventDefault()});
})();
</script>`

export function apply(ctx: Context): void {
  const { lab, shell } = ctx
  const { isRefusal, labelOf, tokenState, whenText } = lab.kit
  const e = shell.e
  const prefix = shell.prefix
  const link = (id: string, tail = ''): string => `/prompts/${encodeURIComponent(id)}${tail}`

  const library = (selected: string | undefined, q: string, tag: string): string => {
    const prompts = lab.prompts({ q, tag })
    const rows = prompts
      .map(
        (prompt) =>
          `<article><a href="${shell.href(link(prompt.id))}"${prompt.id === selected ? ' class="on" aria-current="true"' : ''}><b>${e(prompt.name)}</b><small>${e(prompt.tags[0] ?? 'No tag')} · ${e(whenText(prompt.updatedAt, lab.today))}</small></a></article>`,
      )
      .join('')
    const tags = lab
      .tags()
      .map(({ tag: item, count }) => `<a href="${shell.href(`/prompts?tag=${encodeURIComponent(item)}`)}"${item === tag ? ' class="on"' : ''}><span>${e(item)}</span><span>${count}</span></a>`)
      .join('')
    return `<aside class="library" aria-label="Prompt library"><div class="lib-head"><span>Prompt library</span><a href="${shell.href('/prompts?new=1')}" aria-label="New prompt">+</a></div><form class="search" method="get" action="${shell.href('/prompts')}" role="search">${tag === '' ? '' : `<input type="hidden" name="tag" value="${e(tag)}">`}<input name="q" value="${e(q)}" placeholder="Find a prompt…" aria-label="Find a prompt" maxlength="80"></form><div class="filter kicker"><span>${tag === '' ? 'All prompts' : e(tag)}</span><span>${prompts.length}</span></div>${rows === '' ? `<p class="empty">No prompt matches. <a href="${shell.href('/prompts')}">Show all</a></p>` : rows}<div class="tags"><span class="kicker">Collections</span>${tags}</div></aside>`
  }

  const tabs = (prompt: Prompt, tab: string): string => {
    const item = (id: string, label: string, query: string) =>
      `<a href="${shell.href(link(prompt.id, query))}"${tab === id ? ' class="on" aria-current="page"' : ''}>${label}</a>`
    return `<nav class="tabs" aria-label="Prompt views">${item('editor', 'Prompt editor', '')}${item('versions', 'Version history', '?tab=versions')}${shell.has('prompt-evaluations') ? item('evaluations', 'Evaluations', '?tab=evaluations') : ''}</nav>`
  }

  const editor = (prompt: Prompt): string => {
    const variables = lab.variables(prompt)
    const missing = new Set(lab.missing(prompt))
    const tokens = lab.tokens(prompt)
    const limit = Math.min(...lab.models().map((model) => model.contextTokens))
    const state = tokenState(tokens, limit)
    const fields = variables
      .map(
        (variable) =>
          `<label class="kicker">${e(labelOf(variable))}<input class="field" name="var.${e(variable)}" value="${e(prompt.inputs[variable] ?? '')}" maxlength="20000"${missing.has(variable) ? ' aria-invalid="true"' : ''}></label>`,
      )
      .join('')
    const chips = variables.map((variable) => `<code>{{${e(variable)}}}</code>`).join('')
    return `<form id="editor" method="post" action="${shell.href(link(prompt.id))}">
<div class="field-head"><div><b>System instruction</b><small>Set the model's role and boundaries</small></div></div>
<textarea class="paper" name="systemText" rows="2" maxlength="20000" aria-label="System instruction">${e(prompt.systemText)}</textarea>
<div class="field-head"><div><b>User prompt</b><small>Use {{variables}} to make this prompt reusable</small></div><span id="tokens" class="token ${state}">${tokens.toLocaleString('en-US')} tokens</span></div>
<textarea class="paper" name="userTemplate" rows="7" maxlength="100000" required aria-label="User prompt">${e(prompt.userTemplate)}</textarea>
${chips === '' ? '' : `<div class="chips">${chips}</div>`}
${state === 'ok' ? '' : `<p class="notice ${state === 'over' ? 'error' : 'warn'}" role="alert">This prompt is close to the smallest model's limit of ${limit.toLocaleString('en-US')} tokens.</p>`}
${fields === '' ? '' : `<div class="vars"><span class="kicker">Input variables</span><div>${fields}</div></div>`}
<details class="more"><summary>Name, description and tags</summary><div class="row" style="margin-top:8px"><label>Name<input class="field" name="name" value="${e(prompt.name)}" required maxlength="80"></label><label>Description<input class="field" name="description" value="${e(prompt.description)}" maxlength="200"></label><label>Tags, comma separated<input class="field" name="tags" value="${e(prompt.tags.join(', '))}" maxlength="200"></label></div></details>
${shell.fill('prompt-controls', { prompt })}
</form>
<p class="foot"><a class="btn danger small" href="${shell.href(link(prompt.id, '?confirm=delete'))}">Delete prompt</a></p>`
  }

  const history = (prompt: Prompt): string => {
    const rows = lab
      .versions(prompt.id)
      .map(
        (version) =>
          `<li><div><b>v${version.revision}</b>${version.revision === prompt.version ? ' <span class="badge">Latest</span>' : ''}<small>${e(version.note === '' ? 'No note' : version.note)} · ${e(whenText(version.createdAt, lab.today))}</small></div><form method="post" action="${shell.href(link(prompt.id, `/versions/${version.revision}/restore`))}"><button class="btn small">Restore to editor</button></form></li>`,
      )
      .join('')
    return rows === '' ? '<p class="empty">No saved version yet. Save one from the editor.</p>' : `<ul class="history">${rows}</ul>`
  }

  const title = (prompt: Prompt, actions: string): string =>
    `<div class="title"><div><span class="kicker">${e(prompt.tags[0] ?? 'Prompt')} / v${prompt.version}</span><h1>${e(prompt.name)}</h1><p>${e(prompt.description)}</p></div><div class="actions">${actions}</div></div>`

  const newPanel = `<section class="panel"><h2>New prompt</h2><form method="post" action="${shell.href('/prompts')}"><div class="row"><label>Name<input class="field" name="name" required maxlength="80" placeholder="Launch email"></label><label>Description<input class="field" name="description" maxlength="200"></label><label>Tags, comma separated<input class="field" name="tags" maxlength="200" placeholder="Marketing"></label></div><p class="actions" style="margin-bottom:0"><button class="btn primary">Add prompt</button><a class="btn" href="${shell.href('/prompts')}">Cancel</a></p></form></section>`

  const render = (url: string, prompt: Prompt | undefined, options: { q: string; tag: string; tab: string; confirm: boolean; adding: boolean }): string => {
    const left = library(prompt?.id, options.q, options.tag)
    const pageTitle = prompt?.name ?? 'Prompts'
    if (prompt === undefined) {
      const main = `${shell.notice(url)}${options.adding ? newPanel : `<section class="panel"><h1>Nothing selected</h1><p>Pick a prompt from the library, or <a href="${shell.href('/prompts?new=1')}">add a new one</a>.</p></section>`}`
      return shell.page({ active: 'prompts', title: pageTitle, left, main })
    }
    const dirty = lab.isDirty(prompt)
    const save = `<button class="btn" type="submit" form="editor">Save draft</button><button class="btn" type="submit" form="editor" formaction="${shell.href(link(prompt.id, '/save-version'))}">↗ Save version</button>`
    const body = options.tab === 'versions' ? history(prompt) : options.tab === 'evaluations' ? shell.fill('prompt-evaluations', { prompt }) : editor(prompt)
    const confirm = options.confirm
      ? `<section class="panel" role="alert"><h2>Delete ${e(prompt.name)}?</h2><p>Its versions, runs and ratings go with it. This cannot be undone.</p><form class="actions" method="post" action="${shell.href(link(prompt.id, '/delete'))}"><button class="btn danger">Yes, delete</button><a class="btn" href="${shell.href(link(prompt.id))}">Cancel</a></form></section>`
      : ''
    const main = `${title(prompt, options.tab === 'editor' ? save : '')}${options.adding ? newPanel : ''}${shell.notice(url)}${confirm}<p id="dirty" class="notice warn" role="status"${dirty ? '' : ' hidden'}>Unsaved changes: this differs from v${prompt.version}.</p>${tabs(prompt, options.tab)}${body}`
    return shell.page({ active: 'prompts', title: pageTitle, left, main, right: shell.fill('prompt-results', { prompt }), scripts: EDITOR_SCRIPT })
  }

  const inputsOf = (form: Record<string, unknown>): Record<string, string> =>
    Object.fromEntries(Object.entries(form).flatMap(([key, value]) => (key.startsWith('var.') && typeof value === 'string' ? [[key.slice(4), value]] : [])))

  const draftOf = (form: Record<string, unknown>) => ({
    systemText: form.systemText,
    userTemplate: form.userTemplate,
    inputs: inputsOf(form),
    name: form.name,
    description: form.description,
    tags: form.tags,
  })

  /** Run a change; a refusal comes back to the prompt as a notice, and a prompt that is gone sends a person to the library. */
  const refusal = (error: unknown, id: string) => {
    if (!isRefusal(error)) throw error
    return shell.url(error.code === 'not-found' ? '/prompts' : link(id), { kind: 'error', text: error.message })
  }

  const app = new Acryl()
    .get('/', (c) => c.redirect(shell.href('/prompts'), 302))
    .get('/prompts', (c) => {
      const q = c.req.query('q') ?? ''
      const tag = c.req.query('tag') ?? ''
      return c.html(render(c.req.url, lab.prompts({ q, tag })[0], { q, tag, tab: 'editor', confirm: false, adding: c.req.query('new') === '1' }))
    })
    .post('/prompts', async (c) => {
      const form = await c.req.parseBody()
      try {
        const prompt = await lab.createPrompt({ name: form.name, description: form.description, tags: form.tags })
        return c.redirect(shell.url(link(prompt.id), { kind: 'ok', text: `${prompt.name} was added.` }), 303)
      } catch (error) {
        if (!isRefusal(error)) throw error
        return c.redirect(shell.url('/prompts?new=1', { kind: 'error', text: error.message }), 303)
      }
    })
    .get('/prompts/:id', (c) => {
      const prompt = lab.find(c.req.param('id'))
      if (prompt === undefined) {
        const main = `<section class="panel"><h1>Prompt not found</h1><p>It may have been deleted. <a href="${shell.href('/prompts')}">Back to the library</a></p></section>`
        return c.html(shell.page({ active: 'prompts', title: 'Prompt not found', main }), 404)
      }
      const tab = c.req.query('tab') ?? 'editor'
      return c.html(render(c.req.url, prompt, { q: '', tag: '', tab, confirm: c.req.query('confirm') === 'delete', adding: false }))
    })
    .post('/prompts/:id', async (c) => {
      const id = c.req.param('id')
      try {
        await lab.saveDraft(id, draftOf(await c.req.parseBody()))
        return c.redirect(shell.url(link(id), { kind: 'ok', text: 'Draft saved.' }), 303)
      } catch (error) {
        return c.redirect(refusal(error, id), 303)
      }
    })
    .post('/prompts/:id/save-version', async (c) => {
      const id = c.req.param('id')
      try {
        await lab.saveDraft(id, draftOf(await c.req.parseBody()))
        const version = await lab.saveVersion(id)
        return c.redirect(shell.url(link(id), { kind: 'ok', text: `Saved as v${version.revision}.` }), 303)
      } catch (error) {
        return c.redirect(refusal(error, id), 303)
      }
    })
    .post('/prompts/:id/versions/:revision/restore', async (c) => {
      const id = c.req.param('id')
      const revision = Number(c.req.param('revision'))
      try {
        await lab.restore(id, revision)
        return c.redirect(shell.url(link(id), { kind: 'ok', text: `v${revision} is back in the editor. Save it to keep it.` }), 303)
      } catch (error) {
        return c.redirect(refusal(error, id), 303)
      }
    })
    .post('/prompts/:id/delete', async (c) => {
      const id = c.req.param('id')
      try {
        const { name: promptName } = lab.prompt(id)
        await lab.removePrompt(id)
        return c.redirect(shell.url('/prompts', { kind: 'ok', text: `${promptName} was deleted.` }), 303)
      } catch (error) {
        return c.redirect(refusal(error, id), 303)
      }
    })

  ctx.router.route(prefix === '' ? '/' : prefix, app)
  ctx.effect(() => shell.nav({ id: 'prompts', label: 'Prompts', path: '/prompts', order: 10 }))
}
