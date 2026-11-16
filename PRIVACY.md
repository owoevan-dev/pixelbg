# Privacy

pixelbg runs entirely on your computer. It has no server, sends nothing anywhere, and makes no
network connections: no analytics, no update checks, no downloads. FFmpeg, which it runs on your
pictures, is allowed to open local files only (see below).

## What it reads

- **The pictures you choose**, through FFmpeg, to convert them.
- **The names of picture files** in your Downloads, Pictures and Desktop folders, only when you ask
  for recent files (`/pixelbg recent`, or "Add from recent files" in the panel), or when you give a
  bare file name to `/pixelbg set`. It lists those folders; it does not open the files.
- **A few environment variables**: `LOCALAPPDATA` or `HOME` (pixelbg's folder, below), `TEMP`,
  `TMP` or `TMPDIR` (the temporary folder), `USERPROFILE` or `HOME` (your home folder, for `~`, the
  folders above, and keeping it out of answers), `OS`, and `LC_ALL`, `LC_MESSAGES` and `LANG` (your
  language). A folder counts only if it is absolute on the system the session runs on, which
  pixelbg tells from the session's working folder: a drive path on Windows, a path from `/`
  elsewhere. A Windows-style folder on Linux (from WSL or a copied profile) would be a relative path
  there, inside your project, so it is skipped.
- **Your system language**, when pixelbg's language is `auto` (the default) and the variables above
  do not say: on Windows it runs `reg query "HKCU\Control Panel\International" /v LocaleName`, on
  macOS (a home folder under `/Users`) `defaults read -g AppleLocale`, and elsewhere nothing. It
  reads only that one value, at most once each time the mod loads.

## What it writes

Everything except the temporary file lives in pixelbg's own folder: `%LOCALAPPDATA%\pixelbg` on
Windows, `~/.pixelbg` elsewhere. If neither `LOCALAPPDATA` nor your home folder is an absolute
path, pixelbg saves nothing and says so, rather than write into whatever folder it runs in.

- **Its settings and the current backdrop**, `current.json`: the settings (including the current
  picture's path), the converted picture as SVG, and colours taken from it, written whole in one
  file. Every open session reads it every few seconds, so a change made in one session reaches
  the others. If the file exists but cannot be read (damaged, or from a later version of pixelbg),
  pixelbg changes nothing and never writes over it.
- **The library**, one small file per entry in `library/`: the entry's name, the picture's path and
  when it was added. Removing an entry writes a small marker in `removed/` (the mod cannot delete
  files) and never touches the picture; Undo marks it kept. An entry file or a marker that cannot
  be read is left as it is (its entry hidden, with a warning), and the rest of the library still
  shows. An entry's file name comes from the picture's path, so the same picture is one entry.
- **Thumbnails**, one small SVG per entry in `thumbs/` (an empty file when the picture could not be
  read).
- **A temporary file**, `pixelbg/still-<id>.rgba` in your system's temporary folder, one for each
  session: FFmpeg writes the decoded pixels there and pixelbg reads them back, then tries to empty
  the file, also when a conversion or a thumbnail fails, and once more if that fails. If it still
  cannot, the conversion fails, or the panel says so for a thumbnail, and pixelbg tells you where the
  file is (as `%TEMP%/pixelbg/still-<id>.rgba`), so you can delete it. A session runs one conversion
  at a time, and sessions never share a file. The emptied files stay until your system clears its
  temporary folder; a session stopped mid-conversion can also leave one behind. An empty `.keep`
  file marks the folder. Without a temporary folder in the environment, the folder is
  `pixelbg-temp` in your local app data or home folder, private to you (on Linux and macOS, if
  there is no home folder either, `/tmp/pixelbg`). On Windows with none of these, or when pixelbg
  cannot tell which system the session runs on, it converts nothing rather than guess.

Test builds before 0.1.0 kept these in other files (`state.json`, `art.json`, `library.json`) or in
Claude Code's store for the mod. 0.1.0 neither reads nor changes them; you may delete them.

## What reaches the conversation

`/pixelbg` answers are read by Claude and kept in the session's transcript, so they are built from
pixelbg's own sentences and name files only (`Picture: lake.png`, `File not found: missing.png`,
`FFmpeg: ffmpeg.exe`): never the folders of a picture, of your project (a relative name you typed is
not shown made absolute), or of a FFmpeg you chose, and never your home folder. An error from the
system is named by its code only (`EEXIST`); FFmpeg's own error line is shown only when it names no
folder. The full message is in the panel, which only you see. As a second guard, any path left in
an answer is cut to its file name, and control characters a file name may hold are left out. The
answers name picture files by their names (`/pixelbg status`, `/pixelbg recent`, which also names the
folder each is in: Downloads, Pictures or Desktop), in the terminal as in the desktop app.

## What it runs

- `ffmpeg` and `ffprobe` (or the path you give with `/pixelbg ffmpeg`, kept as an absolute path so it
  means the same program in every project, and never on a network share), on the pictures you
  choose. That program is yours: pixelbg runs it as it is.
- `reg` (Windows) or `defaults` (macOS), as above, for the language.

Each program is started directly with a list of arguments, never through a shell, so nothing in a
file name can run as a command. Every picture is passed to FFmpeg and ffprobe as `file:<path>` with
`-protocol_whitelist file`, so a path can be neither an option nor a URL, and pixelbg refuses a path
with a URL scheme (`https:`, `rtmp:` …) before FFmpeg starts. It also refuses a network share
(`\\server\share\…`, `//server/…`) before anything looks at it, not even to ask whether it exists:
opening one could make your system contact another machine, which `file:` alone does not prevent.
In a project that is itself on a network share, a bare file name is not looked for there. (A drive
your system has mapped or mounted from elsewhere looks local to every program, pixelbg included.)
FFmpeg may also use only formats that read the one file
(`-format_whitelist image2,gif,mov,mp4,m4a,3gp,3g2,mj2`), so a playlist or a concat list renamed to
`.gif` cannot make it open other files.

## Where it shows

The backdrop is drawn in the Claude desktop app only. Other surfaces (a terminal, a phone) get no
backdrop, so the converted picture and its file name are not handed to them.

## Removing it

Uninstall the plugin, then delete the `pixelbg` folder in `%LOCALAPPDATA%` (Windows) or
`~/.pixelbg` (the settings, the backdrop, the library, its removal markers and thumbnails), the
`pixelbg` folder in your temporary folder, and `pixelbg-temp` in your local app data or home folder
if it is there.
