import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { pinnedInstance, withPort } from '../plugins/instance/index.ts'
import { fakeModel } from '../plugins/promptlab/index.ts'
import { createApp } from '../src/app.ts'
import { FRAME_MOUNT_PREFIX } from '../src/routes.ts'
import { NOW, projectRoot, withApp } from './support.ts'

const scratch = join(fileURLToPath(new URL('..', import.meta.url)), '.acrylblends', 'test')
mkdirSync(scratch, { recursive: true })

test('answers health checks and 404 for unknown paths', () =>
  withApp(async (app) => {
    const health = await app.page('/health')
    assert.equal(health.status, 200)
    assert.deepEqual(JSON.parse(health.html) as unknown, { ok: true })
    assert.equal((await app.page('/nope')).status, 404)
  }))

test('the manifest decides what is mounted: an unknown parameter is refused', () =>
  withApp(async () => {
    const { readManifest } = await import('../src/app.ts')
    assert.equal(readManifest().plugins.length, 10)
    assert.throws(() => readManifest({ nothing: 1 }), /parameter-override-unknown/)
  }))

test('the frame mounts the same app under /app, and every link follows the prefix', () =>
  withApp(
    async (app) => {
      assert.equal(app.root.shell.prefix, FRAME_MOUNT_PREFIX)
      const page = await app.page('/prompts')
      assert.equal(page.status, 200)
      assert.match(page.html, /href="\/app\/prompts"/)
      const root = await app.root.router.request(FRAME_MOUNT_PREFIX)
      assert.equal(root.status, 302)
      assert.equal(root.headers.get('location'), '/app/prompts')
    },
    { prefix: FRAME_MOUNT_PREFIX },
  ))

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
    let ids = 0
    const app = await createApp(withPort(pinnedInstance(home, { root: projectRoot }), 0), {
      overrides: { promptlab: { clock: () => NOW, newId: (kind: string) => `${kind}-${++ids}`, model: fakeModel('Fine.') } },
    })
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
