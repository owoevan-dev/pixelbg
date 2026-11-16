# Contributing

Thank you for helping. Bug reports, ideas and corrections to a language are welcome as
[issues](https://github.com/owoevan-dev/pixelbg/issues): say what happened, what you expected, and
which versions of pixelbg, Claude Code and your system you use. A security problem goes through
[SECURITY.md](SECURITY.md) instead.

pixelbg does not take pull requests for now. You are welcome to fork it under the
[MIT License](LICENSE); the rest of this page is for working on a copy of your own.

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

## Checking a change

Run all three; CI runs them too.

```bash
node scripts/check.mjs
claude plugin validate .
claude plugin test .
```

- Add or update a test for what you change. The encoder tests paint documents back into pixels and
  compare them exactly; keep them exact.
- Every sentence goes in `hooks/strings/en.ts` and in each of the other fifteen files there (the
  type checker and the tests refuse a missing one). A native speaker's correction of any language
  is welcome as an issue.
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

pixelbg is under the [MIT License](LICENSE), except the two Anthropic files described in
[THIRD_PARTY.md](THIRD_PARTY.md).
