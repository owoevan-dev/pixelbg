# Contributing

Thank you for helping. Bug reports, ideas and pull requests are all welcome; for a larger change,
open an issue first so we can agree on the approach.

## Layout

| Path | What it is |
| --- | --- |
| `.claude-plugin/` | The plugin manifest and the marketplace that lists it |
| `hooks/register.ts` | Wires the modules to Claude Code's events |
| `hooks/build.ts` | Picture to backdrop: the two quality modes |
| `hooks/show.ts`, `hooks/shared.ts` | Puts the backdrop up and applies every change of settings; the snapshot every session shares (`current.json`) |
| `hooks/panel.ts`, `hooks/slider.ts` | The side panel, and its slider (a client module) |
| `hooks/commands.ts` | `/pixelbg <verb>` |
| `hooks/text.ts`, `hooks/strings/` | Choosing the language; every sentence, one file per language (`en.ts` is the reference) |
| `hooks/media.ts` | Reading pictures through FFmpeg |
| `hooks/quantize.ts`, `clean.ts`, `resize.ts` | Palette, smoothing and despeckling, shrinking |
| `hooks/runs.ts`, `dash.ts`, `encode.ts` | Pixels to SVG documents |
| `hooks/tint.ts` | App colours from the picture |
| `hooks/settings.ts`, `state.ts`, `library.ts`, `paths.ts`, `host.ts` | Reading settings and backdrops back safely, runtime state, the library (a file per entry), path lookup and keeping folders out of answers, the system the session runs on |
| `tests/` | Tests, run by `claude plugin test` |
| `scripts/check.mjs` | The release checks |
| `scripts/make-brand.mjs` | Draws the mark, the logo, the icon and the pipeline picture |
| `scripts/make-art.mjs` | Draws the README's example scene and pixelbg's versions of it |
| `scripts/png.mjs` | The PNG writer both use |
| `docs/design.md` | How a picture is drawn, and the measurements behind it |

## Trying a change

1. Install FFmpeg, and Node.js 24 or newer for the scripts.
2. Load your copy in Claude Code with `claude --plugin-dir <path to your copy>`, or add the path to
   `CLAUDE_CODE_PLUGIN_DIRS` for the desktop app.

## Before a pull request

Run all three; CI runs them too.

```bash
node scripts/check.mjs
claude plugin validate .
claude plugin test .
```

- Add or update a test for what you change. The encoder tests paint documents back into pixels and
  compare them exactly; keep them exact.
- Every sentence goes in `hooks/strings/en.ts` and in each of the other fifteen files there (the
  type checker and the tests refuse a missing one). If you cannot translate it, ask in the pull
  request; a native speaker's correction of any language is welcome too.
- The mod must not use the network, and starts no programs but FFmpeg and the language lookup.
- Keep personal data out: no real paths, names or pictures in code, tests or docs. The tests use a
  pretend drive (the letter T) and pictures drawn by code. `scripts/check.mjs` scans every line,
  every file name, every commit (names, addresses, messages) and every file version in the history
  (a file deleted later is still published) for paths, addresses, keys and
  your computer's own names, and new commits must use your GitHub no-reply address. To also scan
  for words of your own (your name, a nickname), list them one per line in a file named
  `.private-terms` at the top of the repository; git ignores it, and the check refuses it if not.
- Pictures are drawn by `scripts/make-brand.mjs` and `scripts/make-art.mjs`, not added by hand;
  change the script and run it again.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
