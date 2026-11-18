#!/usr/bin/env node
// aa (Add Anything) as a plain command: the memo pad for Codex CLI, Kiro CLI and
// any shell. It reads and writes the same file as the Claude Code mod, one JSON
// memo per line in ~/.aa/memos.jsonl, so every tool shares one list.
//
//   aa <memo>          save
//   aa ld [keyword]    load: pick one; Enter copies it, Del deletes it, Esc closes
//   aa rm <id>         delete without the list (what an agent runs: it has no keys)
//   aa -               the same, with the text piped in instead of typed as arguments
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const LIST_LIMIT = 30

// ---- storage ---------------------------------------------------------------
// Saving only ever adds a line and deleting drops that memo's line alone: a line
// that is no memo (edited by hand, damaged) is not shown, and stays in the file.
const BOM = String.fromCharCode(0xfeff) // an editor's mark at the start of the file

const memoOf = line => {
  try {
    const m = JSON.parse(line.startsWith(BOM) ? line.slice(1) : line)
    return typeof m.id === 'number' && typeof m.body === 'string' ? m : undefined
  } catch {
    return undefined
  }
}

export const parse = text => text.split('\n').flatMap(line => memoOf(line) ?? [])

const read = file => (existsSync(file) ? readFileSync(file, 'utf8') : '')

const load = file => parse(read(file))

const add = (file, memo) => {
  mkdirSync(dirname(file), { recursive: true })
  const text = read(file)
  appendFileSync(file, (text === '' || text.endsWith('\n') ? '' : '\n') + JSON.stringify(memo) + '\n')
}

// false when the memo is not in the file: then nothing is written, so a file
// read while another tool was halfway through writing it is never written back
const drop = (file, id) => {
  const lines = read(file).split('\n')
  const kept = lines.filter(line => memoOf(line)?.id !== id)
  if (kept.length === lines.length) return false
  // whole or not at all: no other reader ever meets half a file
  const real = realpathSync(file) // a link to a synced file stays a link
  const tmp = `${real}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, kept.join('\n'))
    renameSync(tmp, real)
  } catch {
    // ponytail: a file another program holds open cannot be replaced on Windows; write it in place
    writeFileSync(real, kept.join('\n'))
  } finally {
    rmSync(tmp, { force: true })
  }
  return true
}

// ---- text ------------------------------------------------------------------
const two = n => String(n).padStart(2, '0')
const stamp = d =>
  `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`

// terminal cells: Hangul, CJK, full-width forms, symbols and emoji take two.
// A range may count a narrow character as wide, never the other way: a line
// thought too long is cut early, one thought too short would wrap.
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
]
const wide = ch => WIDE.some(([from, to]) => ch.codePointAt(0) >= from && ch.codePointAt(0) <= to)
export const cells = text => [...text].reduce((n, ch) => n + (wide(ch) ? 2 : 1), 0)

// what a terminal would act on instead of drawing: a tab becomes two spaces,
// every other control character goes
const clean = text =>
  [...text]
    .map(ch => {
      const code = ch.codePointAt(0)
      return code === 9 ? '  ' : code < 32 || (code >= 127 && code < 160) ? '' : ch
    })
    .join('')

const cut = (line, n) => {
  if (cells(line) <= n) return line
  let kept = ''
  for (const ch of line) {
    if (cells(kept + ch) > Math.max(1, n - 1)) break
    kept += ch
  }
  return kept + '…'
}

const head = (body, n) => cut(clean(body.split(/\s+/).join(' ')).trim(), n)

const show = m => `#${m.id}  ${m.at}${m.cwd ? `  (${m.cwd})` : ''}\n${'-'.repeat(40)}\n${m.body}`

const find = (memos, kw) => {
  const needle = kw.toLowerCase()
  return memos.filter(m => m.body.toLowerCase().includes(needle)).sort((a, b) => b.id - a.id)
}

const listing = (rows, kw) => {
  if (rows.length === 0) return kw ? `no memo matching '${kw}'` : 'no memos yet'
  const lines = rows.slice(0, LIST_LIMIT).map(m => `#${String(m.id).padEnd(4)} ${m.at}  ${head(m.body, 50)}`)
  if (rows.length > LIST_LIMIT) lines.push(`... ${rows.length - LIST_LIMIT} more`)
  lines.push('copy one: aa ld <keyword>')
  return lines.join('\n')
}

const asId = word => (word && /^#?\d+$/.test(word) ? Number(word.replace('#', '')) : undefined)

// ---- the picker: the list, and the memo under the cursor whole below it -----
// state: { rows, sel, ask }; `ask` while a deletion waits for its yes.
// Each line is { text, dim?, on? }: `on` is the row under the cursor.
export const frame = ({ rows, sel, ask }, kw, cols, height) => {
  const room = Math.max(3, Math.floor((height - 6) / 2))
  const top = Math.max(0, Math.min(sel - Math.floor(room / 2), rows.length - room))
  const picked = rows[sel]
  const lines = [
    ask && picked
      ? { text: `Delete #${picked.id}?  y: yes · any other key: no`, on: true }
      : { text: `${kw ? `aa: ${kw}  ` : ''}↑↓ move · Enter: copy · Del: delete · Esc: close`, dim: true },
  ]
  rows.slice(top, top + room).forEach((memo, i) => {
    const on = top + i === sel
    lines.push({ text: `${on ? '› ' : '  '}${memo.at} ${head(memo.body, Math.max(10, cols - 22))}`, on: on && !ask })
  })
  if (rows.length > room) lines.push({ text: `${sel + 1}/${rows.length}`, dim: true })
  if (picked) {
    lines.push({ text: '─'.repeat(Math.max(4, Math.min(cols, 40))), dim: true })
    lines.push({ text: `#${picked.id} ${picked.at}` })
    for (const line of picked.body.split('\n')) lines.push({ text: line })
  }
  // a line never wraps and the frame never scrolls: what does not fit is cut
  const fit = lines.slice(0, Math.max(1, height - 1))
  if (fit.length < lines.length) fit[fit.length - 1] = { text: '…', dim: true }
  return fit.map(line => ({ ...line, text: cut(clean(line.text), cols - 1) }))
}

// One key of the picker: the next state, with `end` ('copy' | 'close') once the
// list is over and `gone` (a memo's id) when that memo is to be deleted.
export const step = (state, key) => {
  const { rows, sel } = state
  if (state.ask) {
    if (key !== 'y' && key !== 'Y') return { rows, sel, ask: false }
    const left = rows.filter((_, i) => i !== sel)
    const next = { rows: left, sel: Math.max(0, Math.min(sel, left.length - 1)), ask: false, gone: rows[sel].id }
    return left.length > 0 ? next : { ...next, end: 'close' }
  }
  if (key === '\r' || key === '\n') return { rows, sel, ask: false, end: 'copy' }
  if (key === '\x1b' || key === 'q' || key === '\x03') return { rows, sel, ask: false, end: 'close' }
  if (key === '\x1b[3~' || key === 'd') return { rows, sel, ask: true }
  if (key === '\x1b[A' || key === '\x1bOA' || key === 'k') return { rows, sel: Math.max(0, sel - 1), ask: false }
  if (key === '\x1b[B' || key === '\x1bOB' || key === 'j') return { rows, sel: Math.min(rows.length - 1, sel + 1), ask: false }
  return state
}

// What one read of the keyboard holds: a key, or several when an arrow is held.
// Anything else that arrives together (pasted text) stays one unknown key, so a
// paste never acts as the letters in it.
const SEQUENCE = /\x1b(\[[0-9;]*[A-Za-z~]|O[A-Z])/g
export const keysOf = text => {
  const run = text.match(SEQUENCE)
  return run && run.join('') === text ? run : [text]
}

const pick = (rows, kw, remove) =>
  new Promise((resolve, reject) => {
    const { stdin, stdout } = process
    let state = { rows, sel: 0, ask: false }
    const draw = () => {
      const lines = frame(state, kw, stdout.columns ?? 80, stdout.rows ?? 24)
      const paint = line => (line.on ? `\x1b[7m${line.text}\x1b[0m` : line.dim ? `\x1b[2m${line.text}\x1b[0m` : line.text)
      stdout.write('\x1b[H\x1b[J' + lines.map(paint).join('\r\n'))
    }
    // the cursor and the screen as they were, however the list ends
    const restore = () => {
      stdin.setRawMode(false)
      stdin.pause()
      stdout.write('\x1b[?25h\x1b[?1049l')
    }
    const killed = () => process.exit(1)
    const close = () => {
      stdin.off('data', onKey)
      stdout.off('resize', draw)
      process.off('exit', restore)
      process.off('SIGTERM', killed)
      process.off('SIGHUP', killed)
      restore()
    }
    const onKey = data => {
      for (const key of keysOf(String(data))) {
        const { end, gone, ...next } = step(state, key)
        state = next
        try {
          if (gone !== undefined) remove(gone)
        } catch (error) {
          close()
          return reject(error)
        }
        if (end) {
          close()
          return resolve(end === 'copy' ? state.rows[state.sel] : undefined)
        }
      }
      draw()
    }
    process.on('exit', restore)
    process.on('SIGTERM', killed)
    process.on('SIGHUP', killed)
    stdout.write('\x1b[?1049h\x1b[?25l') // its own screen: closing leaves no trace
    stdin.setRawMode(true)
    stdin.resume()
    stdin.on('data', onKey)
    stdout.on('resize', draw)
    draw()
  })

// ---- clipboard -------------------------------------------------------------
// true: copied; false: no way to copy; 'asked': sent to the terminal, which never says
const copy = text => {
  const pipe = (cmd, args, input, env) =>
    spawnSync(cmd, args, { input, env, timeout: 5000, stdio: ['pipe', 'ignore', 'ignore'] }).status === 0
  if (process.platform === 'win32' || process.env.WSL_DISTRO_NAME) {
    // base64 on the way in: the console's code page never touches the text
    const ps = 'Set-Clipboard -Value ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd())))'
    if (pipe('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], Buffer.from(text).toString('base64'))) return true
    // ponytail: clip.exe guesses the encoding of what it is fed; UTF-16 without a mark is its best guess
    return pipe('clip.exe', [], Buffer.from(text, 'utf16le'))
  }
  // pbcopy reads its input in the locale's encoding
  if (process.platform === 'darwin') return pipe('pbcopy', [], text, { ...process.env, LC_CTYPE: 'UTF-8' })
  if (pipe('wl-copy', [], text) || pipe('xclip', ['-selection', 'clipboard'], text) || pipe('xsel', ['-ib'], text)) return true
  if (!process.stdout.isTTY) return false
  // no clipboard tool: ask the terminal itself (OSC 52)
  process.stdout.write(`\x1b]52;c;${Buffer.from(text).toString('base64')}\x07`)
  return 'asked'
}

// ---- the command -----------------------------------------------------------
// io: { file, isTTY, cwd, copy(text) => true | false | 'asked', pick(rows, kw, remove(id)) => memo | undefined }
export const run = async (args, io) => {
  const text = args.trim()
  const [cmd = '', ...rest] = text.split(/\s+/)
  const memos = load(io.file)
  const copied = memo => {
    const done = io.copy(memo.body)
    if (done === 'asked') return `Copy sent to the terminal  #${memo.id}`
    return done ? `Content Copied  #${memo.id}` : 'not copied: no clipboard tool found'
  }

  if (cmd === '' || cmd === 'ld') {
    const kw = rest.join(' ')
    const rows = find(memos, kw)
    if (rows.length === 0) return listing(rows, kw)
    if (io.isTTY) {
      const said = []
      const memo = await io.pick(rows, kw, id => {
        said.push(drop(io.file, id) ? `deleted #${id}` : `no memo #${id}`)
      })
      if (memo) said.push(copied(memo))
      return said.join('\n')
    }
    // no terminal to pick in (an agent ran it): a single hit is shown whole and copied
    return kw && rows.length === 1 ? `${show(rows[0])}\n${'-'.repeat(40)}\n${copied(rows[0])}` : listing(rows, kw)
  }

  const gone = cmd === 'rm' && rest.length === 1 ? asId(rest[0]) : undefined
  if (gone !== undefined) {
    return drop(io.file, gone) ? `deleted #${gone}` : `no memo #${gone}`
  }

  const memo = {
    id: memos.reduce((max, m) => Math.max(max, m.id), 0) + 1,
    body: text,
    at: stamp(new Date()),
    cwd: io.cwd,
  }
  add(io.file, memo)
  return `saved #${memo.id}  ${head(memo.body, 50)}`
}

// The text piped in for `aa -`. A pipe that carries nothing is not waited on forever.
const pipedText = () =>
  new Promise((resolve, reject) => {
    let text = ''
    const late = setTimeout(() => reject(new Error('nothing was piped in')), 3000)
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => {
      clearTimeout(late)
      text += chunk
    })
    process.stdin.on('end', () => {
      clearTimeout(late)
      resolve(text)
    })
  })

const fail = text => {
  console.error(`aa: ${text}`)
  process.exit(1)
}

// plain: never the keyboard list, whatever the terminal (an agent may run this
// inside one, with nobody there to press a key)
export const main = async ({ plain = false } = {}) => {
  const file = join(homedir(), '.aa', 'memos.jsonl')
  const words = process.argv.slice(2).join(' ')
  // `aa -`: the text comes piped in, untouched by the shell's quoting
  if (words === '-' && process.stdin.isTTY) fail("`aa -` reads the memo from a pipe: echo 'the text' | aa -")
  const piped = words === '-'
  let typed = words
  if (piped) {
    const text = await pipedText().catch(error => fail(error.message))
    // as written, less what the pipe added: an encoding mark, Windows line ends, the last line break
    typed = (text.startsWith(BOM) ? text.slice(1) : text).replace(/\r\n/g, '\n').replace(/\n$/, '')
    if (typed.trim() === '') fail('nothing to save: the piped text is empty')
  }
  try {
    const said = await run(typed, {
      file,
      isTTY: !plain && !piped && Boolean(process.stdin.isTTY && process.stdout.isTTY),
      cwd: process.cwd(),
      copy,
      pick,
    })
    if (said) console.log(said)
  } catch (error) {
    if (!['EPERM', 'EACCES', 'EROFS'].includes(error?.code)) throw error
    // an agent's sandbox keeps writes inside its workspace
    console.error(`aa: cannot write ${file} (${error.code}); in a sandboxed agent, allow writes to ${dirname(file)}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) await main()
