import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'aa',
  component: 'Pane',
  requestId: 'aa',
  props: {
    title: 'aa',
    isFocused: true,
    bodyColumns: 60,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

test('save, list and delete a memo, with no model in the way', async ($, on) => {
  // Each hook here stands for the engine: one in-memory file is the disk.
  let disk: string | undefined
  on('env.get', () => ({ value: '/home/me' }))
  on('session.root', () => ({ value: '/work' }))
  on('fs.exists', () => ({ value: disk !== undefined }))
  on('fs.read', () => ({ value: disk ?? '' }))
  on('fs.write', (_, e) => {
    disk = e.text
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'test' } }))

  const run = async (args: string) =>
    (
      await $.command.run({
        command: 'aa',
        args,
        origin: { kind: 'composer' },
        presentation: { isFullscreen: false, columns: 80 },
      })
    ).text ?? ''

  expect(await run('ld')).toBe('no memos yet')
  expect(await run('내일 이거 할것')).toMatch(/^saved #1 /)
  expect(await run('abcd-afaf-vdssdfef')).toMatch(/^saved #2 /)
  expect(await run('ld 이거')).toMatch(/^#1 [\s\S]*내일 이거 할것$/) // single hit: whole memo
  const list = await run('ld')
  expect(list.indexOf('#2')).toBeLessThan(list.indexOf('#1')) // newest first
  expect(await run('ld zzz')).toBe("no memo matching 'zzz'")
  expect(await run('3')).toMatch(/^saved #3 {2}3$/) // a number is a memo, never a lookup
  expect(await run('rm 2')).toBe('deleted #2')
  expect(await run('rm 2')).toBe('no memo #2')
  expect(await run('rm 하기 싫은 일')).toMatch(/^saved #4 /) // rm + words is a memo
  expect(await run('load')).toMatch(/^saved #5 /) // ld and rm are the only commands
  expect((disk ?? '').trim().split('\n').length).toBe(4)
})

test('a line that is no memo stays in the file through saves and deletes', async ($, on) => {
  const odd = '{"id":"2","body":"an id that is no number"}'
  let disk: string | undefined = [
    String.fromCharCode(0xfeff) + JSON.stringify({ id: 1, body: 'kept by hand', at: '2026-01-01 09:00' }),
    odd,
    'not json at all',
    JSON.stringify({ id: 3, body: 'third', at: '2026-01-01 09:00' }),
  ].join('\n')
  on('env.get', () => ({ value: '/home/me' }))
  on('session.root', () => ({ value: '/work' }))
  on('fs.exists', () => ({ value: disk !== undefined }))
  on('fs.read', () => ({ value: disk ?? '' }))
  on('fs.write', (_, e) => {
    disk = e.text
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'test' } }))

  const run = async (args: string) =>
    (
      await $.command.run({
        command: 'aa',
        args,
        origin: { kind: 'composer' },
        presentation: { isFullscreen: false, columns: 80 },
      })
    ).text ?? ''

  expect(await run('ld')).toMatch(/#1 /) // the mark an editor left does not hide the first memo
  expect(await run('new one')).toMatch(/^saved #4 /)
  expect(await run('rm 3')).toBe('deleted #3')
  expect(disk).toContain(odd)
  expect(disk).toContain('not json at all')
  expect(disk).toMatch(/kept by hand/)
  expect(disk).toMatch(/new one/)
  expect(disk).not.toMatch(/third/)
})

test('Enter on a memo copies it, says so and closes the list', async ($, on) => {
  let disk: string | undefined
  const copied: string[] = []
  const toasts: string[] = []
  const closed: string[] = []
  on('env.get', () => ({ value: '/home/me' }))
  on('session.root', () => ({ value: '/work' }))
  on('fs.exists', () => ({ value: disk !== undefined }))
  on('fs.read', () => ({ value: disk ?? '' }))
  on('fs.write', (_, e) => {
    disk = e.text
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.copy', (_, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })

  const run = (args: string) =>
    $.command.run({
      command: 'aa',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })

  await run('buy milk')
  await run('line one\nline two')
  expect((await run('ld')).text).toBeUndefined() // the pane answers, not a text row

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })

    // the memo under the cursor shows whole below the list
    expect(await ui.find({ type: 'Text', text: /line one\nline two/ })).toBeDefined()
    await ui.press({ key: 'm2' })
    await ui.unmount()
  }

  expect(copied).toEqual(['line one\nline two', 'line one\nline two'])
  expect(toasts).toEqual(['Content Copied', 'Content Copied'])
  expect(closed).toEqual(['aa', 'aa'])
})

test('d on a memo asks first, and only y deletes it', async ($, on) => {
  let disk: string | undefined
  const toasts: string[] = []
  on('env.get', () => ({ value: '/home/me' }))
  on('session.root', () => ({ value: '/work' }))
  on('fs.exists', () => ({ value: disk !== undefined }))
  on('fs.read', () => ({ value: disk ?? '' }))
  on('fs.write', (_, e) => {
    disk = e.text
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  const run = (args: string) =>
    $.command.run({
      command: 'aa',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 80 },
    })

  await run('buy milk')
  await run('call mom')
  await run('ld')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  // the cursor starts on the newest memo
  await ui.press({ key: 'del' })
  expect(await ui.find({ type: 'Text', text: /Delete #2\?/ })).toBeDefined()
  await ui.press({ key: 'no' })
  expect(disk).toMatch(/call mom/)

  await ui.press({ key: 'del' })
  await ui.press({ key: 'yes' })
  expect(disk).not.toMatch(/call mom/)
  expect(disk).toMatch(/buy milk/)
  expect(toasts).toEqual(['Deleted #2'])
  expect(await ui.find({ type: 'Button', key: 'm1' })).toBeDefined() // the list stays, without it
  await ui.unmount()
})
