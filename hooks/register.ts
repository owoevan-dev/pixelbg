/**
 * pixelbg: your own pictures as a pixel-art backdrop behind the Claude desktop app's Code tab.
 *
 * The pieces: build.ts turns a picture into SVG documents; show.ts puts them up as the backdrop
 * and applies every change of settings; panel.ts is the side panel, commands.ts the slash
 * command; text.ts picks the language, and strings/ holds every sentence in sixteen. This module wires
 * them to the engine's events.
 */
import type { EngineInterface, Register } from 'claude-code'

import { CONVERTING_VERBS, run } from './commands'
import { act, loadLibrary, moveSlider, panel, PANE, setNote, widget } from './panel'
import { fileName, withoutFolders, withoutHome } from './paths'
import { change, follow, load, needsBuild, SCENE, show, shown } from './show'
import { S } from './state'
import { answerText, chooseLanguage, commandSpec, errorText, t } from './text'

/**
 * How long a command waits for its work before answering and letting the work go on: the
 * engine gives a command ten seconds, and a large picture can take longer.
 */
const COMMAND_PATIENCE_MS = 7000

/**
 * A command's answer as it enters the conversation, which the model reads and the transcript
 * keeps: the home folder written `~`, and any path cut to its file name.
 */
async function forConversation($: EngineInterface, text: string): Promise<string> {
  // Control characters (a file name can hold them) out too: right-to-left overrides and the like
  // would make the answer read differently from what it says.
  return withoutFolders(await withoutHome($, text)).replace(/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)

    // The command first: if anything below fails, /pixelbg is still there to say why.
    await $.command.register(commandSpec())
    try {
      // The settings and backdrop every session shares.
      await load($)
      await chooseLanguage($, S.settings.language, () => S.settings.language === 'auto')
      await $.command.register(commandSpec())
      await loadLibrary($).catch(() => undefined)
      if (needsBuild(S.settings)) {
        // The stored backdrop is missing (or older than this version can read): build it again.
        act($, () => change($, {}))
      } else {
        await show($)
      }
    } finally {
      // Keep up with other sessions' changes, and retry a theme update the host refused, even when
      // something above failed.
      follow($)
    }

    return result
  })

  // A command answers within the engine's time; a longer conversion goes on after the answer,
  // shows in the panel, and says when it is done.
  on('command.run', { command: 'pixelbg' }, async ($, e) => {
    const verb = e.args.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    const converts = CONVERTING_VERBS.has(verb)

    if (converts && S.busy !== '') {
      return { text: t('cmd.busy') }
    }
    if (converts) {
      S.busy = 'convert'
      $.ui.invalidate('ui.render')
    }
    // An error's answer is built from what pixelbg knows is safe (answerText); its full text goes to
    // the panel, which only the user sees.
    const work = run($, e.args)
      .then(
        text => {
          // A conversion that worked supersedes an earlier error; other commands leave the panel's alone.
          if (converts) {
            S.lastError = ''
          }

          return { text, ok: true }
        },
        (error: unknown) => {
          S.lastError = errorText(error)
          $.ui.invalidate('ui.render')

          return { text: t('cmd.prefix', { text: answerText(error) }), ok: false }
        },
      )
      .finally(() => {
        if (converts) {
          S.busy = ''
          $.ui.invalidate('ui.render')
        }
      })
    const answer = await Promise.race([work, $.clock.sleep(COMMAND_PATIENCE_MS).then(() => undefined)])

    if (answer !== undefined) {
      return { text: await forConversation($, answer.text) }
    }
    void work.then(async done => {
      const text = await forConversation($, done.text)

      if (done.ok) {
        setNote(text.split('\n')[0] ?? '')
        S.lastError = ''
      }
      $.ui.toast(done.ok ? t('cmd.prefix', { text: S.lastNote }) : text)
      $.ui.invalidate('ui.render')
    })

    return { text: t('cmd.later') }
  }).catch(async ($, _e, next) => {
    // The hook itself failed: the message goes to the panel, the answer names the error code only.
    S.lastError = next.error.message ?? next.error.kind

    return { text: await forConversation($, t('cmd.prefix', { text: answerText(new Error(S.lastError)) })) }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, ($, e) => {
    if (e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)

      return Text({ children: t('panel.desktopOnly') })
    }

    return e.props.placement === 'widget' ? widget($, $.ui.resolve(e)) : panel($, $.ui.resolve(e))
  })

  // A slider moved: `index` is its position among its steps.
  on('ui.message', ($, e, next) => {
    const data = typeof e.data === 'object' && e.data !== null ? (e.data as Record<string, unknown>) : {}

    if (data.kind === 'slider' && typeof data.id === 'string' && typeof data.index === 'number') {
      moveSlider($, data.id, data.index, data.final === true)
    }

    return next(e)
  })

  on('ui.render', { component: 'Backdrop' }, ($, e, next) => {
    const art = S.art

    // The desktop app only: the backdrop is meant for the Code tab, and other surfaces get none.
    if (e.props.plugin !== $.plugin.name || e.props.scene !== SCENE || art === undefined || e.surface !== 'desktop') {
      return next(e)
    }
    const { Box, Svg } = $.ui.resolve(e)
    const name = fileName(art.source)
    const layers = art.svgs.map((source, i) => Svg({ source, alt: t('backdrop.alt', { name, i: i + 1 }) }))
    const dim = Math.round(shown().dim * 100) / 100
    // The dimming is a layer of its own, so it changes without converting the picture again.
    const veil =
      dim > 0
        ? [
            Svg({
              source: `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1' preserveAspectRatio='none'><rect width='1' height='1' fill='#000000' fill-opacity='${dim}'/></svg>`,
              alt: t('backdrop.veil'),
            }),
          ]
        : []

    // The Svgs stay direct children of the one Box: the desktop stretches each over the window.
    return Box({ children: [...layers, ...veil] })
  })
}
