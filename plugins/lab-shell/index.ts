/**
 * The Prompt Lab's page shell (`ctx.shell`): the dark lab top bar with the workspace, the page links and the saved-history state, the page wrapper
 * and the notice of a redirect. A page plugin registers its entry with `ctx.shell.nav(...)` inside `ctx.effect`, so the entry leaves with it.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Acryl } from '../acryl-router/src/index.ts'
import { createShell, escapeHtml, type NavItem, type Shell } from './core.ts'
import { STYLES } from './styles.ts'

export * from './core.ts'

export const APP_TITLE = 'Prompt Lab'

export interface ShellConfig {
  /** Where the app is mounted: empty on its own server, `/app` in the ACRYL frame (src/app.ts passes it). */
  readonly prefix?: string
}

export const name = 'lab-shell'
export const inject = ['lab', 'router']

declare module '@deepseek-ai/cordis' {
  interface Context {
    shell: Shell
  }
}

function topbar(
  nav: readonly NavItem[],
  crumbs: readonly string[],
  href: (path: string) => string,
  meta: string,
  active: string | undefined,
): string {
  const links = nav
    .map((item) => {
      const count = item.count?.() ?? 0
      return `<a href="${href(item.path)}"${item.id === active ? ' class="on" aria-current="page"' : ''}>${item.icon} ${escapeHtml(item.label)}${count > 0 ? ` <i>${String(count)}</i>` : ''}</a>`
    })
    .join('')
  return `<div class="p-top"><div class="p-logo"><span>✳</span> promptlab</div><div class="p-project">Workspace <b>Product copy experiments⌄</b></div><nav class="p-nav-links" aria-label="Prompt Lab">${links}</nav><div class="p-runmeta"><span>● ${escapeHtml(meta)}</span><div class="avatar">AM</div></div></div>`
}

export function apply(ctx: Context, config: ShellConfig = {}): void {
  const prefix = config.prefix ?? ''
  const shell = createShell(prefix, {
    appTitle: APP_TITLE,
    css: STYLES,
    bodyClass: 'prompt',
    topbar,
  })
  ctx.provide('shell', shell)
  ctx.router.route(prefix === '' ? '/' : prefix, new Acryl().get('/health', (c) => c.json({ ok: true })))
}
