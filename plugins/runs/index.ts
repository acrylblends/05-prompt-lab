/**
 * Running a prompt and reading what came back: the model bar in the editor, the comparison column beside it, and one run in full. A run works on the editor's
 * text as it stands: it is kept as the draft first, so a refusal (a missing variable, a model not configured) loses nothing.
 *
 * Routes (under the shell's prefix): POST /prompts/:id/run, GET /runs/:id, POST /runs/:id/save-version.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Acryl } from '../acryl-router/src/index.ts'
import type { Prompt, Run } from '../lab/index.ts'

export const name = 'runs'
export const inject = ['lab', 'shell', 'router']

/** Copies an output, and looks again every second while a run is pending, unless a person is typing. */
const RESULTS_SCRIPT = `<script>
(function(){
  document.querySelectorAll('[data-copy]').forEach(function(button){
    button.addEventListener('click',function(){
      var text=document.getElementById(button.dataset.copy).textContent;
      var done=function(){var label=button.textContent;button.textContent='Copied';setTimeout(function(){button.textContent=label},1400)};
      if(navigator.clipboard)navigator.clipboard.writeText(text).then(done);
    });
  });
  if(document.querySelector('[data-pending]'))setTimeout(function(){if(!window.labDirty)location.reload()},1000);
})();
</script>`

export function apply(ctx: Context): void {
  const { lab, shell } = ctx
  const { isRefusal, whenText } = lab.kit
  const e = shell.e
  const prefix = shell.prefix
  const promptLink = (id: string): string => `/prompts/${encodeURIComponent(id)}`
  const runLink = (id: string): string => `/runs/${encodeURIComponent(id)}`
  const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)}s`

  /** An output as the page reads it: the first line as a headline, `- ` lines as bullets, the rest as paragraphs. */
  const output = (text: string): string => {
    const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter((block) => block !== '')
    return blocks
      .map((block, index) => {
        const lines = block.split('\n')
        if (lines.every((line) => /^[-*] /.test(line))) return `<ul>${lines.map((line) => `<li>${e(line.slice(2))}</li>`).join('')}</ul>`
        return index === 0 && lines.length === 1 && block.length <= 80 ? `<h3>${e(block)}</h3>` : `<p>${e(block)}</p>`
      })
      .join('')
  }

  const card = (run: Run, won: boolean): string => {
    const body =
      run.status === 'pending'
        ? `<p class="pending" data-pending role="status">Running…</p>`
        : run.status === 'failed'
          ? `<p class="failed" role="alert">This run failed: ${e(run.error ?? 'no reason given')}</p>`
          : `<div class="output">${output(run.output)}</div><pre id="text-${e(run.id)}" hidden>${e(run.output)}</pre>`
    const copy = run.status === 'done' ? `<button class="btn small" type="button" data-copy="text-${e(run.id)}">Copy output</button>` : ''
    return `<article class="card${won ? ' won' : ''}"><header><b>${run.slot}</b><span>${e(run.modelName)}</span><i>${run.status === 'done' ? seconds(run.durationMs) : run.status}</i></header>${body}<footer><a href="${shell.href(runLink(run.id))}">${run.tokens.toLocaleString('en-US')} tokens</a>${copy}</footer></article>`
  }

  const results = (prompt: Prompt): string => {
    const runs = lab.latestComparison(prompt.id)
    const first = runs[0]
    if (first === undefined)
      return `<aside class="results" aria-label="Run comparison"><div class="results-head">Run comparison</div><p class="empty">No runs yet. Fill in the variables, pick your models and run.</p></aside>`
    const winner = lab.winner(first.comparisonId)
    const cards = runs.map((run) => card(run, run.id === winner?.id)).join('')
    return `<aside class="results" aria-label="Run comparison"><div class="results-head">Run comparison<span>Last run · ${e(whenText(first.createdAt, lab.today))}</span></div>${cards}${shell.fill('comparison-footer', { prompt, runs })}</aside>`
  }

  const controls = (prompt: Prompt): string => {
    const last = lab.latestComparison(prompt.id)
    const select = (field: string, label: string, chosen: string | undefined, none: boolean) => {
      const options = lab
        .models()
        .map((model) => `<option value="${e(model.id)}"${model.id === chosen ? ' selected' : ''}>${e(model.name)}${lab.problem(model) === undefined ? '' : ' (needs setup)'}</option>`)
        .join('')
      return `<label>${label}<select class="field" name="${field}">${none ? '<option value="">None</option>' : ''}${options}</select></label>`
    }
    const models = lab.models()
    const manage = shell.navItems().some((item) => item.id === 'models') ? `<a class="btn small" href="${shell.href('/settings/models')}">Manage models</a>` : ''
    return `<div class="modelbar"><span class="kicker">Model configuration</span>${select('modelA', 'Model A', last[0]?.modelId ?? models[0]?.id, false)}${select('modelB', 'Model B', last[1]?.modelId ?? models[1]?.id, true)}<label class="narrow">Temperature<input class="field" name="temperature" value="${last[0]?.temperature ?? 0.6}" inputmode="decimal" required></label>${manage}<button class="btn primary go" type="submit" formaction="${shell.href(`${promptLink(prompt.id)}/run`)}">▶ Run comparison</button></div>`
  }

  const app = new Acryl()
    .post('/prompts/:id/run', async (c) => {
      const id = c.req.param('id')
      const form = await c.req.parseBody()
      const inputs = Object.fromEntries(Object.entries(form).flatMap(([key, value]) => (key.startsWith('var.') && typeof value === 'string' ? [[key.slice(4), value]] : [])))
      try {
        await lab.saveDraft(id, { systemText: form.systemText, userTemplate: form.userTemplate, inputs, name: form.name, description: form.description, tags: form.tags })
        await lab.startComparison(id, { modelA: form.modelA, modelB: form.modelB, temperature: form.temperature })
        return c.redirect(shell.href(promptLink(id)), 303)
      } catch (error) {
        if (!isRefusal(error)) throw error
        return c.redirect(shell.url(error.code === 'not-found' && lab.find(id) === undefined ? '/prompts' : promptLink(id), { kind: 'error', text: error.message }), 303)
      }
    })
    .get('/runs/:id', (c) => {
      const run = lab.run(c.req.param('id'))
      if (run === undefined) {
        const main = `<section class="panel"><h1>Run not found</h1><p>It may have gone with its prompt. <a href="${shell.href('/prompts')}">Back to the library</a></p></section>`
        return c.html(shell.page({ active: 'prompts', title: 'Run not found', main }), 404)
      }
      const prompt = lab.prompt(run.promptId)
      const version = lab.versions(prompt.id).find((item) => item.id === run.promptVersionId)
      const stat = (label: string, value: string) => `<div><span class="kicker">${label}</span><strong>${e(value)}</strong></div>`
      const inputs = Object.entries(run.inputs).map(([key, value]) => `<tr><th scope="row">${e(lab.kit.labelOf(key))}</th><td>${e(value)}</td></tr>`).join('')
      const result =
        run.status === 'done'
          ? `<section class="panel"><h2>Output</h2><div class="output">${output(run.output)}</div></section>`
          : run.status === 'failed'
            ? `<section class="panel"><h2>Output</h2><p class="failed" role="alert">This run failed: ${e(run.error ?? 'no reason given')}</p></section>`
            : `<section class="panel"><p class="pending" data-pending role="status">Running…</p></section>`
      const save = run.status === 'done' ? `<form method="post" action="${shell.href(`${runLink(run.id)}/save-version`)}"><button class="btn">↗ Save as a version</button></form>` : ''
      const main = `<div class="title"><div><span class="kicker">${e(prompt.name)} / Run ${run.slot}</span><h1>${e(run.modelName)}</h1><p>${e(whenText(run.createdAt, lab.today))}</p></div><div class="actions"><a class="btn" href="${shell.href(promptLink(prompt.id))}">Back to the prompt</a>${save}</div></div>${shell.notice(c.req.url)}<div class="stats">${stat('Status', run.status)}${stat('Tokens', run.tokens.toLocaleString('en-US'))}${stat('Duration', seconds(run.durationMs))}${stat('Cost', `€${run.cost.toFixed(4)}`)}${stat('Temperature', String(run.temperature))}${stat('Prompt', version === undefined ? 'Unsaved draft' : `v${version.revision}`)}</div>${result}${shell.fill('run-footer', { prompt, run })}${inputs === '' ? '' : `<section class="panel"><h2>Inputs</h2><div class="scroll"><table>${inputs}</table></div></section>`}<section class="panel"><h2>System instruction</h2><pre>${e(run.systemText)}</pre></section><section class="panel"><h2>Prompt as sent</h2><pre>${e(run.userText)}</pre></section>`
      return c.html(shell.page({ active: 'prompts', title: `${prompt.name}: ${run.modelName}`, main, scripts: RESULTS_SCRIPT }))
    })
    .post('/runs/:id/save-version', async (c) => {
      const id = c.req.param('id')
      try {
        const version = await lab.saveRunAsVersion(id)
        return c.redirect(shell.url(promptLink(version.promptId), { kind: 'ok', text: `Saved as v${version.revision}.` }), 303)
      } catch (error) {
        if (!isRefusal(error)) throw error
        return c.redirect(shell.url(lab.run(id) === undefined ? '/prompts' : runLink(id), { kind: 'error', text: error.message }), 303)
      }
    })

  ctx.router.route(prefix === '' ? '/' : prefix, app)
  ctx.effect(() => shell.slot('prompt-controls', ({ prompt }) => (prompt === undefined ? '' : controls(prompt))))
  ctx.effect(() => shell.slot('prompt-results', ({ prompt }) => (prompt === undefined ? '' : `${results(prompt)}${RESULTS_SCRIPT}`)))
}
