/**
 * The lab's page shell (`ctx.shell`): the top bar with the pages that registered an entry, the three-column lab layout, links under the mount prefix, and
 * the slots a plugin uses to put its part on a page another plugin owns.
 *
 * A page plugin registers its entry with `ctx.shell.nav(...)` and its slot parts with `ctx.shell.slot(...)` inside `ctx.effect`, so both leave with the plugin
 * (switched off in Settings > Plugins). It mounts its routes at `ctx.shell.prefix` and writes every link with `ctx.shell.href(path)`.
 */
import type { Context } from '@deepseek-ai/cordis'
import { Acryl } from '../acryl-router/src/index.ts'
import { csrf } from '../acryl-router/src/middleware/index.ts'
import type { Prompt, Run } from '../lab/index.ts'
import { STYLES } from './styles.ts'

export const APP_TITLE = 'Prompt Lab'

export interface NavItem {
  readonly id: string
  readonly label: string
  readonly path: string
  /** Where it sits: lower first. */
  readonly order: number
}

export interface PageInput {
  /** The nav item to highlight. */
  readonly active?: string
  /** The browser tab's title (the app name is added). */
  readonly title: string
  readonly main: string
  /** The library column. */
  readonly left?: string
  /** The results column. */
  readonly right?: string
  /** Extra HTML at the end of the body: a page's own `<script>`. */
  readonly scripts?: string
}

export interface Notice {
  readonly kind: 'ok' | 'error' | 'warn'
  readonly text: string
}

/** What a slot part is handed: the prompt on the page, and the runs of a comparison where there are any. */
export interface SlotContext {
  readonly prompt?: Prompt
  readonly runs?: readonly Run[]
  readonly run?: Run
}

export type SlotPart = (context: SlotContext) => string

/**
 * - `prompt-controls`: inside the editor form, under the variables.
 * - `prompt-results`: the page's right column.
 * - `prompt-evaluations`: the prompt's Evaluations tab.
 * - `comparison-footer`: under a comparison's cards.
 * - `run-footer`: under a run's output.
 */
export type SlotName = 'prompt-controls' | 'prompt-results' | 'prompt-evaluations' | 'comparison-footer' | 'run-footer'

export interface Shell {
  readonly prefix: string
  /** Escape user text for HTML. */
  e(text: string): string
  href(path: string): string
  /** The URL of a path of the app with a notice for the page it lands on. */
  url(path: string, notice?: Notice): string
  /** The notice of a request's `?ok=` / `?error=` / `?warn=` query, as HTML. */
  notice(url: string): string
  nav(item: NavItem): () => void
  navItems(): readonly NavItem[]
  slot(name: SlotName, part: SlotPart): () => void
  /** The HTML of every part in a slot; empty when no plugin fills it. */
  fill(name: SlotName, context: SlotContext): string
  has(name: SlotName): boolean
  page(input: PageInput): string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    shell: Shell
  }
}

export interface ShellConfig {
  /** Where the app is mounted: empty on its own server, `/app` in the ACRYL frame (src/app.ts passes it). */
  readonly prefix?: string
}

export const escapeHtml = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')

export const name = 'lab-shell'
export const inject = ['lab', 'router']

export function apply(ctx: Context, config: ShellConfig = {}): void {
  const prefix = config.prefix ?? ''
  const items = new Map<string, NavItem>()
  const slots = new Map<SlotName, Set<SlotPart>>()
  const href = (path: string): string => `${prefix}${path.startsWith('/') ? path : `/${path}`}`
  const navItems = () => [...items.values()].sort((a, b) => a.order - b.order)

  const shell: Shell = {
    prefix,
    e: escapeHtml,
    href,
    url(path, notice) {
      const [base, query] = path.split('?') as [string, string | undefined]
      const noticeText = notice === undefined ? '' : `${notice.kind}=${encodeURIComponent(notice.text)}`
      const joined = [query, noticeText].filter((part) => part !== undefined && part !== '').join('&')
      return `${href(base)}${joined === '' ? '' : `?${joined}`}`
    },
    notice(url) {
      const query = new URL(url, 'http://local').searchParams
      for (const kind of ['error', 'warn', 'ok'] as const) {
        const text = query.get(kind)
        if (text !== null && text !== '') return `<p class="notice ${kind}" role="${kind === 'ok' ? 'status' : 'alert'}">${escapeHtml(text)}</p>`
      }
      return ''
    },
    nav(item) {
      if (items.has(item.id)) throw new Error(`the top bar already has "${item.id}"`)
      items.set(item.id, item)
      return () => {
        if (items.get(item.id) === item) items.delete(item.id)
      }
    },
    navItems,
    slot(slotName, part) {
      const parts = slots.get(slotName) ?? new Set<SlotPart>()
      slots.set(slotName, parts.add(part))
      return () => {
        parts.delete(part)
      }
    },
    fill: (slotName, context) => [...(slots.get(slotName) ?? [])].map((part) => part(context)).join(''),
    has: (slotName) => (slots.get(slotName)?.size ?? 0) > 0,
    page({ active, title, main, left, right, scripts }) {
      const links = navItems()
        .map((item) => `<a href="${href(item.path)}"${item.id === active ? ' class="on" aria-current="page"' : ''}>${escapeHtml(item.label)}</a>`)
        .join('')
      return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · ${APP_TITLE}</title>
<style>${STYLES}</style>
</head>
<body>
<header class="top"><a class="logo" href="${href('/')}"><span aria-hidden="true">✳</span>promptlab</a><div class="project">Workspace <b>Product copy experiments</b></div><nav aria-label="Pages">${links}</nav><div class="meta"><span>● LOCAL HISTORY SAVED</span><div class="avatar" title="Alex Morgan">AM</div></div></header>
<div class="layout${left === undefined && right === undefined ? ' single' : ''}">${left ?? ''}<main class="work">${main}</main>${right ?? ''}</div>
${scripts ?? ''}
</body>
</html>`
    },
  }

  ctx.provide('shell', shell)
  // This row comes before the pages, so the check covers every form: a page on another site cannot post to a server on this machine.
  ctx.router.route(prefix === '' ? '/' : prefix, new Acryl().use(csrf()).get('/health', (c) => c.json({ ok: true })))
}
