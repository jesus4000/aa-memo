# aa — Add Anything

A memo pad inside Claude Code. Type `/aa` and a note is saved instantly, from any session, without opening another app. Saving and loading never call the model, so there is no waiting and no token cost for the command itself.

## Install

**From GitHub** — at the prompt of a Claude Code terminal session:

```
/plugin install aa --marketplace jesus4000/aa-memo
```

**From a local copy** — clone (or download) the repository, then from a shell:

```
git clone https://github.com/jesus4000/aa-memo
claude plugin install aa --marketplace ./aa-memo
```

At the prompt, answer `y` to add the marketplace, then pick the **user** scope; the shell command installs at the user scope by default. That makes `/aa` work in every session and project. With a local copy, Claude Code reads the mod straight from that folder, so keep the folder where it is; after editing it or pulling an update, run `/reload-plugins`.

Uninstall with `claude plugin uninstall aa`.

## Use

| Command | What it does |
| --- | --- |
| `/aa buy milk tomorrow` | Saves the memo |
| `/aa load` | Opens the memo list: ↑↓ to move (the full memo shows below), Enter puts the memo in the prompt, Esc closes |
| `/aa load milk` | One match shows the whole memo; several open the list filtered |
| `/aa 3` | Shows memo #3 |
| `/aa rm 3` | Deletes memo #3 |

## Where memos live

One JSON object per line in `~/.aa/memos.jsonl` (`%USERPROFILE%\.aa\memos.jsonl` on Windows), shared by every session and project. It is a plain text file: back it up, sync it or grep it as you like.

Memos are stored unencrypted. The `/aa ...` line you typed stays in the conversation like any other command, so the model can read it on your next message in that session, and it can remain in Claude Code's local history. Do not use aa for passwords or keys.

## Limits

- Two sessions saving within the same few milliseconds can lose one of the two memos.
- A memo that is only a number (`/aa 3`) is read as "show memo #3".
- Uses the early-access Claude Code plugin API, which may change between releases.

## License

MIT
