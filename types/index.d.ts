export type Memo = { id: number; body: string; at: string; cwd?: string }
export type View = { rows: Memo[]; sel: number; kw: string }

declare module 'claude-code' {
  interface PluginState {
    aa: { view: Shaped<View> }
  }
}
