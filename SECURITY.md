# Security

## Supported versions

pixelbg is in its first test release. Only the latest version gets fixes.

| Version | Supported |
| --- | --- |
| 0.1.x | yes |

## Reporting a vulnerability

Please report it privately, through GitHub's
[private vulnerability reporting](https://github.com/owoevan-dev/pixelbg/security/advisories/new)
for this repository. Do not open a public issue for a security problem.

Say what happens, how to reproduce it, and which versions of pixelbg, Claude Code and your operating
system you use. You should hear back within a week.

## What pixelbg does that matters for security

- It starts outside programs: FFmpeg and ffprobe on pictures you choose, and `reg` (Windows) or
  `defaults` (macOS) to read your system language. Each starts directly with a list of arguments,
  never through a shell. See [PRIVACY.md](PRIVACY.md).
- It makes no network connections, and FFmpeg may open local files only: every input is
  `file:<path>` with `-protocol_whitelist file` and
  `-format_whitelist image2,gif,mov,mp4,m4a,3gp,3g2,mj2` (so a playlist or concat list renamed to a
  picture's extension cannot reach other files), and a path with a URL scheme is refused first. So
  is a network share (`\\server\…`, `//server/…`), before anything looks at it, so the system is
  never made to contact another machine.
- Its folders are taken from the environment only when they are absolute on the system the
  session runs on (told by the session's working folder), so it never writes into your project.
- Its command answers, which enter the conversation, are built from its own sentences, which name
  files only: a system error by its code, FFmpeg's error line only when it names no folder, the
  full message in the panel; any path left over is cut to its file name.
- A custom FFmpeg (`/pixelbg ffmpeg <path>`) is kept as an absolute path, refused on a network
  share, and must have ffprobe beside it. It is the user's own program, run as it is.
- It reads pictures only through FFmpeg, and its own files directly. It writes only its own folder
  (`current.json` with the settings and the backdrop, one file per library entry, one thumbnail per
  entry, one removal marker per removed entry) and one temporary file per session, which it empties
  after each conversion; if it cannot, the conversion fails and says where the file is. A file of
  its own that it cannot read is never written over.
- What it draws is SVG made by its own code from palette numbers: no text from a picture, file name
  or setting goes into a document. SVG read back from its own files (the backdrop, the thumbnails) is drawn only if
  every tag is one of the elements pixelbg writes, every attribute one it writes, and every value of
  the exact form it writes (a `href` is only `#z<number>`, a colour only `#rrggbb`), with no text,
  comments or other markup (`isOwnSvg` in `hooks/settings.ts`). An edited file cannot add scripts,
  links or other content.
- The backdrop is drawn in the desktop app only.
