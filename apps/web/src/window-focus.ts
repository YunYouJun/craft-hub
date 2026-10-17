/**
 * Mirrors whether the host window is key on the root element, so desktop chrome can mute its selection while another
 * window has focus. `document.hasFocus()` stays true while an embedded frame holds focus.
 */
export function trackWindowFocus(root: HTMLElement = document.documentElement, target: Window = window): () => void {
  const render = (): void => {
    root.toggleAttribute('data-window-inactive', !target.document.hasFocus())
  }
  target.addEventListener('focus', render)
  target.addEventListener('blur', render)
  render()
  return () => {
    target.removeEventListener('focus', render)
    target.removeEventListener('blur', render)
    root.removeAttribute('data-window-inactive')
  }
}
