import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { test } from 'node:test'
import { pinnedInstance, withPort } from '../plugins/instance/index.ts'
import { createApp } from '../src/app.ts'
import { FRAME_MOUNT_PREFIX } from '../src/routes.ts'
import { projectRoot, withApp } from './support.ts'

const scratch = join(projectRoot, '.acrylblends', 'test')
mkdirSync(scratch, { recursive: true })

test('answers health checks on its own server and under the frame prefix, and 404 for unknown paths', async () => {
  await withApp(async (app) => {
    const health = await app.root.router.request('/health')
    assert.equal(health.status, 200)
    assert.deepEqual(await health.json(), { ok: true })
    const missing = await app.root.router.request('/nope')
    assert.equal(missing.status, 404)
    await missing.body?.cancel()
  })
  const frame = await import('../src/frame.ts')
  assert.deepEqual([...frame.inject], ['routerHttp'])
  await withApp(
    async (app) => {
      assert.equal(app.root.shell.prefix, FRAME_MOUNT_PREFIX)
      const health = await app.root.router.request(`${FRAME_MOUNT_PREFIX}/health`)
      assert.equal(health.status, 200)
      await health.body?.cancel()
    },
    { prefix: FRAME_MOUNT_PREFIX },
  )
})

test('every page registers its entry in the top bar, and the entry leaves with its plugin', () =>
  withApp(async (app) => {
    assert.deepEqual(app.root.shell.navItems().map((item) => item.id), ['prompts', 'evaluations', 'models'])
    const extra = app.root.plugin({
      name: 'nav-test',
      inject: ['shell'],
      apply(ctx: typeof app.root) {
        ctx.effect(() => ctx.shell.nav({ id: 'extra', label: 'Extra', path: '/extra', order: 99 }))
      },
    })
    await extra.await()
    assert.match(app.root.shell.page({ title: 't', main: '' }), /Extra/)
    await extra.dispose()
    assert.doesNotMatch(app.root.shell.page({ title: 't', main: '' }), /Extra/)
  }))

const canListen = await new Promise<boolean>((done) => {
  const probe = createServer()
  probe.once('error', (error: NodeJS.ErrnoException) => done(!(error.code === 'EPERM' || error.code === 'EACCES')))
  probe.listen(0, '127.0.0.1', () => probe.close(() => done(true)))
})

test('serves the seeded lab on a real port and stops listening when stopped', { skip: canListen ? false : 'this environment does not allow listening on a port' }, async () => {
  const door = process.env.ACRYL_DOOR
  process.env.ACRYL_DOOR = 'off'
  const home = await mkdtemp(join(scratch, 'app-test-'))
  try {
    const app = await createApp(withPort(pinnedInstance(home, { root: projectRoot }), 0))
    const page = await fetch(`${app.url}/prompts`)
    assert.equal(page.status, 200)
    assert.match(await page.text(), /Product description/)
    await app.stop()
    await assert.rejects(fetch(`${app.url}/health`))
  } finally {
    if (door === undefined) delete process.env.ACRYL_DOOR
    else process.env.ACRYL_DOOR = door
    await rm(home, { recursive: true, force: true })
  }
})

test('the manifest decides what is mounted: every feature is its own row, an unknown parameter is refused', async () => {
  const { readManifest } = await import('../src/app.ts')
  const manifest = readManifest()
  assert.deepEqual(
    manifest.plugins.map((row) => row.id),
    ['router', 'home', 'lab', 'lab-shell', 'prompts', 'runs', 'evaluations', 'models', 'extensions', 'server', 'acryl-door'],
  )
  assert.throws(() => readManifest({ nothing: 1 }), /parameter-override-unknown/)
})
