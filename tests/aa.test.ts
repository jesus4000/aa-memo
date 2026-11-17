import { expect, test } from 'claude-code/testing'

test('save, find, show and delete a memo, with no model in the way', async ($, on) => {
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

  expect(await run('load')).toBe('no memos yet')
  expect(await run('내일 이거 할것')).toMatch(/^saved #1 /)
  expect(await run('abcd-afaf-vdssdfef')).toMatch(/^saved #2 /)
  expect(await run('load 이거')).toMatch(/^#1 [\s\S]*내일 이거 할것$/) // single hit: whole memo
  const list = await run('load')
  expect(list.indexOf('#2')).toBeLessThan(list.indexOf('#1')) // newest first
  expect(await run('load zzz')).toBe("no memo matching 'zzz'")
  expect(await run('#2')).toMatch(/abcd-afaf-vdssdfef$/)
  expect(await run('rm 2')).toBe('deleted #2')
  expect(await run('2')).toBe('no memo #2')
  expect(await run('rm 하기 싫은 일')).toMatch(/^saved #2 /) // rm + words is a memo
  expect((disk ?? '').trim().split('\n').length).toBe(2)
})
