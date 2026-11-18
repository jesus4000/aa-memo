export type Memo = { id: number; body: string; at: string; cwd?: string }
// ask: the id of the memo whose deletion waits for a yes
export type View = { rows: Memo[]; sel: number; kw: string; ask?: number }

declare module 'claude-code' {
  interface PluginState {
    aa: { view: Shaped<View> }
  }
}
