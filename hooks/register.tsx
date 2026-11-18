import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Memo, View } from '../types'

const PANE = 'aa'
const LIST_LIMIT = 30
const TOAST_MS = 1500
const view = atom({ plugin: 'aa', key: 'view' } as const, { rows: [], sel: 0, kw: '' } as View, {
  shape: 'view-2',
})

// ---- storage: one JSON memo per line in ~/.aa/memos.jsonl ------------------
// Saving adds a line and deleting drops that memo's line alone: a line that is no
// memo (edited by hand, damaged) is not shown, and stays in the file.
// ponytail: read, then write the whole file ($.fs has no append or rename); two
// tools writing in the same few ms can lose a memo. A lock if that ever bites.
const file = async ($: EngineInterface) => {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  if (!home) throw new Error('aa: no home directory (USERPROFILE/HOME unset)')
  return `${home.replace(/[\\/]$/, '')}/.aa/memos.jsonl`
}

const BOM = String.fromCharCode(0xfeff) // an editor's mark at the start of the file

const memoOf = (line: string): Memo | undefined => {
  try {
    const m = JSON.parse(line.startsWith(BOM) ? line.slice(1) : line) as Memo
    return typeof m.id === 'number' && typeof m.body === 'string' ? m : undefined
  } catch {
    return undefined
  }
}

export const parse = (text: string): Memo[] => text.split('\n').flatMap(line => memoOf(line) ?? [])

const raw = async ($: EngineInterface) => {
  const path = await file($)
  return (await $.fs.exists(path)) ? $.fs.read(path) : ''
}

const load = async ($: EngineInterface) => parse(await raw($))

const add = async ($: EngineInterface, memo: Memo) => {
  const text = await raw($)
  await $.fs.write(await file($), text + (text === '' || text.endsWith('\n') ? '' : '\n') + JSON.stringify(memo) + '\n')
}

// false when the memo is not in the file: then nothing is written, so a file
// read while another tool was halfway through writing it is never written back
const drop = async ($: EngineInterface, id: number) => {
  const lines = (await raw($)).split('\n')
  const kept = lines.filter(line => memoOf(line)?.id !== id)
  if (kept.length === lines.length) return false
  await $.fs.write(await file($), kept.join('\n'))
  return true
}

// ---- text ------------------------------------------------------------------
const two = (n: number) => String(n).padStart(2, '0')
const stamp = (d: Date) =>
  `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`

// terminal cells: Hangul, CJK, full-width forms, symbols and emoji take two.
// A range may count a narrow character as wide, never the other way.
const WIDE = [
  [0x1100, 0x115f],
  [0x2600, 0x27bf],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f000, 0x1faff],
  [0x20000, 0x3fffd],
] as const
const wide = (ch: string) => WIDE.some(([from, to]) => (ch.codePointAt(0) ?? 0) >= from && (ch.codePointAt(0) ?? 0) <= to)
const cells = (text: string) => [...text].reduce((n, ch) => n + (wide(ch) ? 2 : 1), 0)

// control characters are never drawn: a row is text, not something to act on
const clean = (text: string) =>
  [...text]
    .filter(ch => {
      const code = ch.codePointAt(0) ?? 0
      return code >= 32 && (code < 127 || code >= 160)
    })
    .join('')

const head = (body: string, n: number) => {
  const line = clean(body.split(/\s+/).join(' ')).trim()
  if (cells(line) <= n) return line
  let kept = ''
  for (const ch of line) {
    if (cells(kept + ch) > Math.max(1, n - 1)) break
    kept += ch
  }
  return kept + '…'
}

const show = (m: Memo) => `#${m.id}  ${m.at}${m.cwd ? `  (${m.cwd})` : ''}\n${'-'.repeat(40)}\n${m.body}`

const find = (memos: Memo[], kw: string) => {
  const needle = kw.toLowerCase()
  return memos.filter(m => m.body.toLowerCase().includes(needle)).sort((a, b) => b.id - a.id)
}

const listing = (rows: Memo[], kw: string) => {
  if (rows.length === 0) return kw ? `no memo matching '${kw}'` : 'no memos yet'
  const lines = rows.slice(0, LIST_LIMIT).map(m => `#${String(m.id).padEnd(4)} ${m.at}  ${head(m.body, 50)}`)
  if (rows.length > LIST_LIMIT) lines.push(`... ${rows.length - LIST_LIMIT} more`)
  lines.push('one memo whole: /aa ld <keyword>')
  return lines.join('\n')
}

const asId = (word: string | undefined) => (word && /^#?\d+$/.test(word) ? Number(word.replace('#', '')) : undefined)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'aa',
      description: 'Add Anything: /aa <memo> | ld [keyword] | rm <id>',
    })

    return next(e)
  })

  on('command.run', { command: 'aa' }, async ($, e) => {
    // every answer is for the person alone: a memo never goes to the model
    const say = (text: string) => ({ text, isTextDisplayOnly: true as const })
    const args = e.args.trim()
    const [cmd = '', ...rest] = args.split(/\s+/)
    const memos = await load($)

    if (cmd === '' || cmd === 'ld') {
      const kw = rest.join(' ')
      const rows = find(memos, kw)
      if (rows.length > 0) {
        await update($, view, () => ({ rows, sel: 0, kw }))
        const opened = await $.ui.open({
          id: PANE,
          title: kw ? `aa: ${kw}` : 'aa',
          focus: true,
          closeOnEscape: true,
        })
        if (opened.isPlaced) return {}
      }
      // no pane on this surface: the list as text, a single hit whole
      return say(rows.length === 1 && rows[0] ? show(rows[0]) : listing(rows, kw))
    }

    const gone = cmd === 'rm' && rest.length === 1 ? asId(rest[0]) : undefined
    if (gone !== undefined) {
      return say((await drop($, gone)) ? `deleted #${gone}` : `no memo #${gone}`)
    }

    const memo: Memo = {
      id: memos.reduce((max, m) => Math.max(max, m.id), 0) + 1,
      body: args,
      at: stamp(new Date()),
      cwd: await $.session.root().catch(() => undefined),
    }
    await add($, memo)
    return say(`saved #${memo.id}  ${head(memo.body, 50)}`)
  })

  on('ui.focus', async ($, e, next) => {
    if (e.requestId === PANE && e.element?.startsWith('m')) {
      const id = Number(e.element.slice(1))
      await update($, view, v => {
        const sel = v.rows.findIndex(row => row.id === id)
        return sel < 0 || sel === v.sel ? v : { ...v, sel }
      })
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const v = await read($, view)
    const cols = e.props.bodyColumns ?? 60
    const room = Math.max(3, Math.floor(((e.viewport?.rows ?? 24) - 6) / 2))
    const top = Math.max(0, Math.min(v.sel - Math.floor(room / 2), v.rows.length - room))
    const picked = v.rows[v.sel]
    const asked = v.rows.find(memo => memo.id === v.ask)
    // autoFocus places the ring only as the pane opens: a view swapped in later asks for it.
    // Best effort: a ring that cannot move never undoes the press that asked.
    const ring = (key: string) => $.ui.focus({ requestId: PANE, key }).catch(() => undefined)

    // d was pressed on a memo: nothing is deleted until y
    if (asked) {
      return (
        <Box flexDirection="column">
          <Text>Delete #{asked.id}?</Text>
          <Text dimColor>{head(asked.body, Math.max(10, cols - 2))}</Text>
          <Box>
            <Button
              key="no"
              hotkey="n"
              plain
              onPress={async () => {
                await update($, view, now => ({ ...now, ask: undefined }))
                await ring(`m${asked.id}`)
              }}
            >
              No
            </Button>
            <Text>{'   '}</Text>
            <Button
              key="yes"
              hotkey="y"
              plain
              onPress={async () => {
                const isGone = await drop($, asked.id)
                const rows = v.rows.filter(memo => memo.id !== asked.id)
                $.ui.toast(isGone ? `Deleted #${asked.id}` : `no memo #${asked.id}`, { timeoutMs: TOAST_MS })
                const sel = Math.min(v.sel, rows.length - 1)
                const under = rows[sel]
                if (!under) return $.ui.close({ id: PANE })
                await update($, view, now => ({ ...now, rows, sel, ask: undefined }))
                await ring(`m${under.id}`)
              }}
            >
              Yes
            </Button>
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Box>
          <Text dimColor>↑↓ move · Enter: copy · Esc: close · </Text>
          {picked && (
            <Button
              key="del"
              hotkey="d"
              plain
              dimColor
              onPress={async () => {
                await update($, view, now => ({ ...now, ask: picked.id }))
                await ring('no') // Enter is the safe answer
              }}
            >
              delete
            </Button>
          )}
        </Box>
        {v.rows.slice(top, top + room).map((memo, i) => (
          <Button
            key={`m${memo.id}`}
            plain
            autoFocus={top + i === v.sel ? true : undefined}
            onPress={async press => {
              const done = await $.ui.copy({ text: memo.body, surface: press.surface })
              $.ui.toast(done.isCopied ? 'Content Copied' : `not copied (${done.reason})`, { timeoutMs: TOAST_MS })
              await $.ui.close({ id: PANE })
            }}
          >
            {top + i === v.sel ? '› ' : '  '}
            <Text dimColor>{memo.at} </Text>
            {head(memo.body, Math.max(10, cols - 22))}
          </Button>
        ))}
        {v.rows.length > room && (
          <Text dimColor>
            {v.sel + 1}/{v.rows.length}
          </Text>
        )}
        {picked && <Text dimColor>{'─'.repeat(Math.max(4, Math.min(cols, 40)))}</Text>}
        {picked && (
          <Text>
            #{picked.id} {picked.at}
          </Text>
        )}
        {picked && <Text>{picked.body}</Text>}
      </Box>
    )
  })
}
