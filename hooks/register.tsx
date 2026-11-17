import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Memo, View } from '../types'

const PANE = 'aa'
const LIST_LIMIT = 30
const view = atom({ plugin: 'aa', key: 'view' } as const, { rows: [], sel: 0, kw: '' } as View, {
  shape: 'view-1',
})

// ---- storage: one JSON memo per line in ~/.aa/memos.jsonl ------------------
// ponytail: read-modify-write of the whole file; two sessions saving in the same
// few ms can lose one memo. Move to per-memo files or a lock if that ever bites.
const file = async ($: EngineInterface) => {
  const home = (await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME'))
  if (!home) throw new Error('aa: no home directory (USERPROFILE/HOME unset)')
  return `${home.replace(/[\\/]$/, '')}/.aa/memos.jsonl`
}

export const parse = (text: string): Memo[] =>
  text
    .split('\n')
    .filter(line => line.trim() !== '')
    .flatMap(line => {
      try {
        const m = JSON.parse(line) as Memo
        return typeof m.id === 'number' && typeof m.body === 'string' ? [m] : []
      } catch {
        return [] // a damaged line never hides the rest
      }
    })

const load = async ($: EngineInterface): Promise<Memo[]> => {
  const path = await file($)
  return (await $.fs.exists(path)) ? parse(await $.fs.read(path)) : []
}

const save = async ($: EngineInterface, memos: Memo[]) =>
  $.fs.write(await file($), memos.map(m => JSON.stringify(m)).join('\n') + (memos.length ? '\n' : ''))

// ---- text ------------------------------------------------------------------
const two = (n: number) => String(n).padStart(2, '0')
const stamp = (d: Date) =>
  `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`

const head = (body: string, n: number) => {
  const line = body.split(/\s+/).join(' ').trim()
  return line.length <= n ? line : line.slice(0, Math.max(1, n - 1)) + '…'
}

const show = (m: Memo) => `#${m.id}  ${m.at}${m.cwd ? `  (${m.cwd})` : ''}\n${'-'.repeat(40)}\n${m.body}`

const find = (memos: Memo[], kw: string) => {
  const needle = kw.toLowerCase()
  return memos.filter(m => m.body.toLowerCase().includes(needle)).sort((a, b) => b.id - a.id)
}

const listing = (rows: Memo[], kw: string) => {
  if (rows.length === 0) return kw ? `no memo matching '${kw}'` : 'no memos yet'
  const lines = rows.slice(0, LIST_LIMIT).map(m => `#${String(m.id).padEnd(4)} ${m.at}  ${head(m.body, 50)}`)
  if (rows.length > LIST_LIMIT) lines.push(`... ${rows.length - LIST_LIMIT} more, narrow with: /aa load <keyword>`)
  lines.push('view: /aa <id>')
  return lines.join('\n')
}

const asId = (word: string | undefined) => (word && /^#?\d+$/.test(word) ? Number(word.replace('#', '')) : undefined)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'aa',
      description: "Add Anything: /aa <memo> | load [keyword] | <id> | rm <id>",
    })

    return next(e)
  })

  on('command.run', { command: 'aa' }, async ($, e) => {
    // every answer is for the person alone: a memo never goes to the model
    const say = (text: string) => ({ text, isTextDisplayOnly: true as const })
    const args = e.args.trim()
    const [cmd = '', ...rest] = args.split(/\s+/)
    const memos = await load($)

    if (cmd === '' || cmd === 'load' || cmd === 'ls') {
      const kw = rest.join(' ')
      const rows = find(memos, kw)
      if (kw && rows[0] && rows.length === 1) return say(show(rows[0]))
      if (rows.length > 1) {
        await update($, view, () => ({ rows: rows.slice(0, 200), sel: 0, kw }))
        const opened = await $.ui.open({
          id: PANE,
          title: kw ? `aa: ${kw}` : 'aa',
          focus: true,
          closeOnEscape: true,
        })
        if (opened.isPlaced) return {}
      }
      return say(listing(rows, kw))
    }

    const id = asId(cmd)
    if (id !== undefined && rest.length === 0) {
      const memo = memos.find(m => m.id === id)
      return say(memo ? show(memo) : `no memo #${id}`)
    }

    const gone = cmd === 'rm' && rest.length === 1 ? asId(rest[0]) : undefined
    if (gone !== undefined) {
      if (!memos.some(m => m.id === gone)) return say(`no memo #${gone}`)
      await save($, memos.filter(m => m.id !== gone))
      return say(`deleted #${gone}`)
    }

    const memo: Memo = {
      id: memos.reduce((max, m) => Math.max(max, m.id), 0) + 1,
      body: args,
      at: stamp(new Date()),
      cwd: await $.session.root().catch(() => undefined),
    }
    await save($, [...memos, memo])
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

    return (
      <Box flexDirection="column">
        <Text dimColor>↑↓ move · Enter: put memo in prompt · Esc: close</Text>
        {v.rows.slice(top, top + room).map((memo, i) => (
          <Button
            key={`m${memo.id}`}
            plain
            autoFocus={top + i === v.sel ? true : undefined}
            onPress={async () => {
              await $.prompt.fill({ text: memo.body, mode: 'insert' })
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
