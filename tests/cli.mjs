// The plain command (bin/aa.mjs): node --test tests/cli.mjs
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { cells, frame, keysOf, run, step } from '../bin/aa.mjs'

// One temp file is the disk; `keys` are what the person types in the picker.
const world = ({ isTTY = false, keys = [] } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'aa-'))
  const copied = []
  const io = {
    file: join(dir, '.aa', 'memos.jsonl'),
    isTTY,
    cwd: '/work',
    copy: text => {
      copied.push(text)
      return true
    },
    pick: (rows, kw, remove) => {
      let state = { rows, sel: 0, ask: false }
      for (const key of keys) {
        const { end, gone, ...next } = step(state, key)
        state = next
        if (gone !== undefined) remove(gone)
        if (end) return end === 'copy' ? state.rows[state.sel] : undefined
      }
      throw new Error('the picker was left open')
    },
  }
  return { io, copied, disk: () => readFileSync(io.file, 'utf8'), done: () => rmSync(dir, { recursive: true }) }
}

const UP = '\x1b[A'
const DOWN = '\x1b[B'
const DEL = '\x1b[3~'
const ESC = '\x1b'

test('save, list and delete without a terminal', async () => {
  const { io, copied, disk, done } = world()
  assert.equal(await run('ld', io), 'no memos yet')
  assert.match(await run('내일 이거 할것', io), /^saved #1 /)
  assert.match(await run('abcd-afaf-vdssdfef', io), /^saved #2 /)
  const list = await run('ld', io)
  assert.ok(list.indexOf('#2') < list.indexOf('#1')) // newest first
  assert.deepEqual(copied, []) // a list copies nothing
  assert.match(await run('ld 이거', io), /^#1 [\s\S]*내일 이거 할것\n-+\nContent Copied {2}#1$/) // single hit: whole, copied
  assert.deepEqual(copied, ['내일 이거 할것'])
  assert.equal(await run('ld zzz', io), "no memo matching 'zzz'")
  assert.match(await run('3', io), /^saved #3 {2}3$/) // a number is a memo, never a lookup
  assert.equal(await run('rm 2', io), 'deleted #2')
  assert.equal(await run('rm 2', io), 'no memo #2')
  assert.match(await run('rm 하기 싫은 일', io), /^saved #4 /) // rm + words is a memo
  assert.match(await run('load', io), /^saved #5 /) // ld and rm are the only commands
  assert.equal(disk().trim().split('\n').length, 4)
  done()
})

test('in a terminal Enter copies the memo under the cursor, Esc copies nothing', async () => {
  const picking = world({ isTTY: true, keys: [DOWN, '\r'] })
  await run('buy milk', picking.io)
  await run('line one\nline two', picking.io)
  assert.equal(await run('ld', picking.io), 'Content Copied  #1')
  assert.deepEqual(picking.copied, ['buy milk'])
  picking.done()

  const leaving = world({ isTTY: true, keys: [ESC] })
  await run('buy milk', leaving.io)
  assert.equal(await run('ld', leaving.io), '')
  assert.deepEqual(leaving.copied, [])
  leaving.done()
})

test('Del asks first, and only y deletes', async () => {
  const { io, copied, disk, done } = world({ isTTY: true, keys: [DEL, 'n', DEL, 'y', ESC] })
  await run('buy milk', io)
  await run('call mom', io)
  assert.equal(await run('ld', io), 'deleted #2') // the cursor starts on the newest
  assert.doesNotMatch(disk(), /call mom/)
  assert.match(disk(), /buy milk/)
  assert.deepEqual(copied, [])
  done()

  // the last memo deleted closes the list
  const last = world({ isTTY: true, keys: [DEL, 'y'] })
  await run('only one', last.io)
  assert.equal(await run('ld', last.io), 'deleted #1')
  assert.equal(last.disk(), '')
  last.done()
})

test('the picker moves within the list and draws within the screen', () => {
  const rows = [3, 2, 1].map(id => ({ id, at: '2026-01-01 09:00', body: `memo ${id}\nsecond line 한글 메모` }))
  let state = { rows, sel: 0, ask: false }
  state = step(state, UP)
  assert.equal(state.sel, 0)
  state = step(step(step(state, DOWN), DOWN), DOWN)
  assert.equal(state.sel, 2)
  assert.equal(step(state, '\r').end, 'copy')
  assert.equal(step(state, ESC).end, 'close')

  const lines = frame(state, 'memo', 40, 12)
  assert.ok(lines.length <= 11)
  assert.ok(lines.some(line => line.on && line.text.includes('memo 1')))
  assert.ok(lines.some(line => line.text === 'second line 한글 메모')) // the picked memo whole
  assert.match(frame({ ...state, ask: true }, '', 40, 12)[0].text, /^Delete #1\?/)
  assert.ok(frame(state, '', 12, 5).every(line => cells(line.text) <= 11))

  // wide characters, tabs and control characters never push a line past the screen
  const TAB = String.fromCharCode(9)
  const ESCAPE = String.fromCharCode(27)
  const odd = [{ id: 1, at: '2026-01-01 09:00', body: `${TAB}${TAB}탭이 들어간 아주 긴 한글 메모 한 줄입니다 ${ESCAPE}[31m🙂🙂🙂🙂🙂🙂🙂🙂` }]
  const drawn = frame({ rows: odd, sel: 0, ask: false }, '', 30, 12)
  assert.ok(drawn.every(line => cells(line.text) <= 29))
  assert.ok(drawn.every(line => !line.text.includes(TAB) && !line.text.includes(ESCAPE)))
})

test('one read of the keyboard is one key, or a held arrow, never a paste', () => {
  assert.deepEqual(keysOf(DOWN), [DOWN])
  assert.deepEqual(keysOf(DOWN + DOWN + UP), [DOWN, DOWN, UP])
  assert.deepEqual(keysOf('d'), ['d'])
  assert.deepEqual(keysOf('dy'), ['dy']) // pasted text is no key: nothing is deleted
  assert.equal(step({ rows: [{ id: 1 }], sel: 0, ask: false }, 'dy').ask, false)
})

test('a line that is no memo stays in the file through saves and deletes', async () => {
  const { io, disk, done } = world()
  const BOM = String.fromCharCode(0xfeff)
  const first = BOM + JSON.stringify({ id: 1, body: 'kept by hand', at: '2026-01-01 09:00' })
  const odd = '{"id":"2","body":"an id that is no number"}'
  mkdirSync(join(io.file, '..'), { recursive: true })
  writeFileSync(io.file, [first, odd, 'not json at all', JSON.stringify({ id: 3, body: 'third', at: '2026-01-01 09:00' })].join('\r\n'))

  const list = await run('ld', io)
  assert.match(list, /#1 /) // the mark an editor left does not hide the first memo
  assert.match(list, /#3 /)
  assert.match(await run('new one', io), /^saved #4 /)
  assert.equal(await run('rm 3', io), 'deleted #3')
  assert.ok(disk().includes(odd))
  assert.ok(disk().includes('not json at all'))
  assert.match(disk(), /kept by hand/)
  assert.match(disk(), /new one/)
  assert.doesNotMatch(disk(), /third/)
  done()
})

test('the command itself: arguments and piped text', () => {
  const home = mkdtempSync(join(tmpdir(), 'aa-home-'))
  const script = fileURLToPath(new URL('../bin/aa.mjs', import.meta.url))
  const aa = (args, input) => {
    const done = spawnSync(process.execPath, [script, ...args], {
      input,
      encoding: 'utf8',
      env: { ...process.env, HOME: home, USERPROFILE: home },
    })
    return done.stdout.trim()
  }
  assert.match(aa(['buy', 'milk']), /^saved #1 {2}buy milk$/)
  // piped: quotes and several lines arrive as written, whatever the shell
  assert.match(aa(['-'], `say "hi" & don't $HOME\nline two\n`), /^saved #2 /)
  const saved = readFileSync(join(home, '.aa', 'memos.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line))
  assert.equal(saved[1].body, `say "hi" & don't $HOME\nline two`)
  assert.match(aa(['ld']), /^#2 [\s\S]*#1 [\s\S]*copy one: aa ld <keyword>$/)
  assert.equal(aa(['rm', '1']), 'deleted #1')
  // Windows line ends from a PowerShell pipe do not reach the memo
  assert.match(aa(['-'], 'one\r\ntwo\r\n'), /^saved #3 /)
  const file = join(home, '.aa', 'memos.jsonl')
  assert.equal(JSON.parse(readFileSync(file, 'utf8').trim().split('\n').at(-1)).body, 'one\ntwo')
  rmSync(home, { recursive: true })
})

test('nothing to delete or to save leaves the file as it was', async () => {
  const home = mkdtempSync(join(tmpdir(), 'aa-home-'))
  const script = fileURLToPath(new URL('../bin/aa.mjs', import.meta.url))
  const env = { ...process.env, HOME: home, USERPROFILE: home }
  const file = join(home, '.aa', 'memos.jsonl')
  mkdirSync(join(home, '.aa'))
  const before = JSON.stringify({ id: 1, body: 'kept', at: '2026-01-01 09:00' }) + '\nnot a memo'
  writeFileSync(file, before)
  const aa = (args, input) => spawnSync(process.execPath, [script, ...args], { input, encoding: 'utf8', env })

  assert.equal(aa(['rm', '9']).stdout.trim(), 'no memo #9')
  for (const input of ['', '  \n']) {
    const done = aa(['-'], input)
    assert.equal(done.status, 1)
    assert.match(done.stderr, /nothing to save/)
  }
  // a pipe that stays open and silent is not waited on forever
  const silent = spawn(process.execPath, [script, '-'], { env, stdio: ['pipe', 'ignore', 'pipe'] })
  let said = ''
  silent.stderr.on('data', chunk => (said += chunk))
  const code = await new Promise(resolve => silent.on('exit', resolve))
  assert.equal(code, 1)
  assert.match(said, /nothing was piped in/)
  assert.equal(readFileSync(file, 'utf8'), before)
  rmSync(home, { recursive: true })
})
