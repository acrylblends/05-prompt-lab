/**
 * The model settings page: which provider and models the lab runs on, whether a key is configured, and exactly which settings to add. It reads the
 * model port, so the page tells the truth about the server it runs on rather than a hard-coded example.
 *
 * Routes (under the shell's prefix): GET /settings/models.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Acryl } from '../acryl-router/src/index.ts'

export const name = 'models'
export const inject = ['lab', 'shell', 'router']

export function apply(ctx: Context): void {
  const { lab, shell } = ctx
  const e = shell.e
  const prefix = shell.prefix
  const model = lab.model
  const status = model.configured
    ? `<p class="notice ok" role="status">A key is configured: the lab runs live on ${e(model.provider)}.</p>`
    : `<p class="notice warn" role="alert">No key is configured. The lab shows its seeded comparison outputs; set <code>DEEPSEEK_API_KEY</code> and restart to run live.</p>`
  const rows = model.models.map((name) => `<tr><td><b>${e(name)}</b></td><td>${e(model.provider)}</td><td>${model.configured ? 'ready' : 'needs a key'}</td></tr>`).join('')
  const main = `<div class="p-page"><header><div><small>PROMPT LAB / SETTINGS</small><h1>Models</h1><p>The provider the comparison runs on</p></div></header>${status}<section class="p-section"><header><b>Configured models</b><small>${String(model.models.length)} models</small></header><table><thead><tr><th>MODEL</th><th>PROVIDER</th><th>STATE</th></tr></thead><tbody>${rows}</tbody></table></section><div class="p-form"><h2>How it is configured</h2><p class="hint">The app reads the environment once at start; a change needs a restart.</p><label>DEEPSEEK_API_KEY<input value="${model.configured ? 'set' : 'not set'}" readonly></label><label>PROMPT_LAB_BASE_URL<input value="https://api.deepseek.com/v1 (default)" readonly></label><label>PROMPT_LAB_MODELS<input value="${e(model.models.join(','))}" readonly></label><div class="actions"><a href="${shell.href('/prompts')}">Back to the lab</a></div></div><p class="p-note">Nothing is sent anywhere until you press Run comparison. The seeded outputs are stored with the app and need no key.</p></div>`
  const app = new Acryl()
    .get('/settings/models', (c) => c.html(shell.page({ active: 'models', title: 'Models', crumbs: ['Prompt Lab', 'Settings', 'Models'], main })))
    .get('/settings', (c) => c.redirect(shell.href('/settings/models'), 302))
  ctx.router.route(prefix === '' ? '/' : prefix, app)
  ctx.effect(() => shell.nav({ id: 'models', label: 'Models', icon: '⚙', path: '/settings/models', order: 40 }))
}
