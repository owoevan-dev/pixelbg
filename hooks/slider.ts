/**
 * A slider the panel draws as a Client: one row, a track and a value, dragged with the pointer
 * or stepped with the arrow keys (Home and End to the ends, Page Up and Down by ten steps).
 *
 * It moves over `labels.length` fixed positions and shows the label of the one it is on, so the
 * hooks module decides the values (percentages, widths, colour counts). It posts
 * `{ kind: 'slider', id, index, final }`: while dragging with `final: false`, and once more with
 * `final: true` when the button comes up or a key is pressed, for work that should wait for it.
 */
import type { ClientModule, ClientSurface, JsonValue, RenderElement } from 'claude-code'

type Props = { id: string; index: number; labels: string[] }
/**
 * `box` holds this instance's latest props for its listeners. Every slider of the panel runs
 * this one module, so nothing per-slider may live at module level.
 */
type State = { dragging: boolean; index: number; pending: number; pendingAt: number; box: { p: Props } }

function readProps(raw: JsonValue): Props {
  const p = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as { [key: string]: JsonValue }) : {}
  const labels = Array.isArray(p.labels) ? p.labels.map(String) : ['']

  return {
    id: typeof p.id === 'string' ? p.id : '',
    index: typeof p.index === 'number' ? Math.max(0, Math.min(labels.length - 1, Math.round(p.index))) : 0,
    labels: labels.length > 0 ? labels : [''],
  }
}

const now = (): number => (typeof Date === 'function' ? Date.now() : 0)

function geometry(s: ClientSurface<State>, p: Props): { track: number; labelWidth: number } {
  const labelWidth = Math.max(...p.labels.map(l => l.length)) + 1

  return { track: Math.max(4, s.columns - labelWidth - 1), labelWidth }
}

function indexAt(s: ClientSurface<State>, p: Props, x: number): number {
  const { track } = geometry(s, p)

  return Math.max(0, Math.min(p.labels.length - 1, Math.round((x / Math.max(1, track - 1)) * (p.labels.length - 1))))
}

function send(s: ClientSurface<State>, p: Props, index: number, final: boolean): void {
  s.post({ kind: 'slider', id: p.id, index, final })
}

const Slider: ClientModule<JsonValue, State> = (raw, s) => {
  const p = readProps(raw)
  const { Text } = s.elements

  if (s.state === undefined) {
    s.setState({ dragging: false, index: p.index, pending: -1, pendingAt: 0, box: { p } })
    s.onPointer(e => {
      const st = s.state

      if (st === undefined) {
        return
      }
      const props = st.box.p

      if (e.type === 'down' && e.button === 'left') {
        const index = indexAt(s, props, e.x)
        s.setState({ ...st, dragging: true, index })
        send(s, props, index, false)
      } else if (e.type === 'move' && st.dragging && e.button !== undefined) {
        const index = indexAt(s, props, e.x)

        if (index !== st.index) {
          s.setState({ ...st, index })
          send(s, props, index, false)
        }
      } else if (e.type === 'up' && st.dragging) {
        s.setState({ ...st, dragging: false, pending: st.index, pendingAt: now() })
        send(s, props, st.index, true)
      }
    })
    s.onKey(e => {
      const st = s.state

      if (st === undefined) {
        return
      }
      const props = st.box.p
      const last = props.labels.length - 1
      const from = st.pending >= 0 ? st.pending : props.index
      const moves: Record<string, number> = { left: from - 1, down: from - 1, right: from + 1, up: from + 1, pageup: from + 10, pagedown: from - 10, home: 0, end: last }
      const to = moves[e.key]

      if (to !== undefined) {
        const index = Math.max(0, Math.min(last, to))
        s.setState({ ...st, pending: index, pendingAt: now() })
        send(s, props, index, true)
      }
    })
    // A value posted but never confirmed by new props falls back after two seconds.
    s.every(500, () => {
      const st = s.state

      if (st !== undefined && st.pending >= 0 && !st.dragging && now() - st.pendingAt > 2000) {
        s.setState({ ...st, pending: -1 })
      }
    })
  }
  const st = s.state ?? { dragging: false, index: p.index, pending: -1, pendingAt: 0, box: { p } }

  // The listeners read this instance's newest props from here.
  st.box.p = p
  if (st.pending >= 0 && st.pending === p.index && !st.dragging) {
    // New props confirm the posted value: stop holding it.
    s.setState({ ...st, pending: -1 })
  }
  const index = st.dragging ? st.index : st.pending >= 0 ? st.pending : p.index
  const { track, labelWidth } = geometry(s, p)
  const at = Math.round((index / Math.max(1, p.labels.length - 1)) * (track - 1))
  const label = (p.labels[index] ?? '').padStart(labelWidth)
  const runs: RenderElement[] = []

  if (at > 0) {
    runs.push(Text({ color: 'suggestion', children: '━'.repeat(at) }))
  }
  runs.push(Text({ color: 'text', weight: 'bold', children: '●' }))
  if (track - at - 1 > 0) {
    runs.push(Text({ color: 'inactive', children: '─'.repeat(track - at - 1) }))
  }
  runs.push(Text({ color: 'text', children: label }))

  return Text({ mono: true, wrap: 'truncate', children: runs })
}

export default Slider
