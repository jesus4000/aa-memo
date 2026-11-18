#!/usr/bin/env node
// aa as an agent runs it: the same command, never the keyboard list. An agent's
// shell can look like a terminal, and a list there would wait for a key forever.
import { main } from './aa.mjs'

await main({ plain: true })
