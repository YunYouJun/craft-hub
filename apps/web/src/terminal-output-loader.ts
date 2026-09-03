import type { Component } from 'vue'

/** Load the terminal renderer without adding xterm to the initial application chunk. */
export async function loadTerminalOutputComponent(): Promise<Component> {
  return (await import('./TerminalOutput.vue')).default
}
