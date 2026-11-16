# How pixelbg draws a picture

This note records how pixelbg turns a picture into a backdrop, why it is built that way, and the
measurements behind its choices.

## What the desktop app allows

A mod's backdrop is a tree of elements that the Claude desktop app draws behind the Code tab.
pixelbg uses SVG documents, stretched over the window. The limits, as measured on Claude Code
2.1.325:

| Limit | Value | pixelbg keeps to |
| --- | --- | --- |
| One SVG document | 131,072 characters | 125,000 (`MAX_SVG_CHARS`) |
| The whole backdrop tree | about 256 KiB as JSON | two documents (`MAX_LAYERS`) |
| Elements in the tree | fewer than 2,000 | 2 or 3 (the documents and a veil) |

Inside a document, external and `data:` resources (fonts, bitmaps) are blocked, so a picture must be
drawn with plain shapes. The image backdrop that Claude Code defines (`backdrop.image`) would remove
these limits, but the desktop app does not draw it yet.

## The pipeline

1. **Decode** (`media.ts`). ffprobe reads the first frame's size and any quarter turn on it (a
   phone photo's EXIF orientation), since FFmpeg turns the picture upright when it decodes. FFmpeg
   then writes raw RGBA at the size asked for: area averaging when shrinking, nearest neighbour when
   enlarging a small sprite. At most 900,000 pixels, so one read stays under the engine's 4 MiB
   limit; a picture too long and thin for that even one pixel wide is refused. Inputs are local
   files only (`file:`, `-protocol_whitelist file`, and a format whitelist of readers that read the
   one file); PNG, JPEG, WebP, BMP and TIFF are read by FFmpeg's image reader with numbered
   sequences off, so a name like `frame %02d.png` means that file and not `frame 01.png`. One
   decode runs at a time, and the temporary file is emptied afterwards, whatever happened; if it
   cannot be emptied, the conversion fails and says where it is.
2. **Smooth** (`clean.ts`). Each pixel becomes the mean of those of its 3×3 neighbours whose colour
   is within 24 (summed over R, G and B) of its own: flat areas lose their noise, edges stay.
3. **Palette** (`quantize.ts`). Median cut in RGB seeds the palette; five rounds of k-means in OKLab
   refine it. Both work on a sample of the opaque pixels only (at least half opacity; fainter
   pixels are left out and the app shows through), picked at fixed pseudo-random places, so neither
   a regular pattern of see-through pixels nor stripes in step with a sampling stride can hide part
   of the picture from them. Pixels are matched to the nearest colour in OKLab.
4. **Despeckle** (`clean.ts`). A pixel whose left and right neighbours share a colour within 0.08
   of its own (OKLab distance) takes that colour: a one-pixel speck costs two runs and is rarely seen.
5. **Encode** (`dash.ts`, `encode.ts`), described below.
6. **Theme** (`tint.ts`). The palette's hues weighted by area pick the surface tint; the most vivid
   colours give the accent. The theme is built with the design system's own code
   (`make-colors.js`) and checked so that every colour stays readable; if a check fails, the tint
   is made greyer and tried again.

## Encoding: layered runs, written as dashes

**Layered runs** (`runs.ts`). Colours are painted in order, most frequent first. The first fills
the box with one rectangle. A later colour's run may reach across pixels of colours painted after
it, since those cover it again, so there are fewer and longer runs than one per stretch of colour.

**Dashes** (`dash.ts`). One path walks every row in turn, left to right and then right to left,
one unit down between rows: a zigzag, written once per document. Each colour draws that path with
`stroke-dasharray` set to its runs along the walk (dash, gap, dash, gap), so a run costs two
numbers and finding the start of a row costs nothing. A dash pattern starts over at each subpath,
which is why the walk is one unbroken line. The steps down between rows fall in gaps, except where
one colour holds both ends of a step; drawing the step there only covers that colour's own pixels
again.

A dash pattern's positions are summed in floating point along the path, so a very long walk would
drift by a fraction of a unit near its end. Each zigzag is therefore cut into blocks of about
60,000 units, which stay exact.

Compared with the plain encoding (`encode.ts`: one stroked path per colour, with relative moves
along each row), the dashed documents were about 31% smaller for the same pixels. The tests paint
both encodings back into pixels and require them to match the input exactly. The dashed encoding
cannot leave a pixel out, so pictures with see-through pixels use the plain one, as do the panel's
small previews.

**Two documents.** When one document would pass the limit, the rows are split where the two halves
weigh about the same. Both documents keep the whole picture's view box, so stacked they line up.

## The two modes

- **High quality.** The picture is decoded once, at up to 1,200 pixels across (no wider than the
  picture itself, but at least 64, so a tiny sprite is enlarged with square pixels), and one palette
  is cut from it. If the whole width does not fit, the narrowest
  width (16) is tried first; if even that does not fit, nothing does. Otherwise a binary search over
  widths, shrinking in the mod, finds the widest copy that fits in two documents, to within 8
  pixels.
- **Normal.** The width the user picks. When even two documents would pass the limit, pixelbg
  estimates a width that fits from how far over it is (the size grows with the pixel count) and
  tries again, up to six times.

## Measurements

Ten pictures (six landscape photographs and four illustrations), split into a tune set and a
validate set of five each. Each method's result was shown at the source's size and compared with
the source:

- **width**: the widest copy that fit in two documents with 24 colours;
- **err**: the mean OKLab distance between shown and source pixels, ×100 (lower is closer);
- **edge**: the mean difference in lightness gradient between shown and source, after a 2×2 box
  blur of both, ×1000 (lower keeps edges better).

| Method | tune width | tune err | tune edge | validate width | validate err | validate edge |
| --- | --- | --- | --- | --- | --- | --- |
| dashes, 24 colours | 961 | 3.005 | 15.47 | 866 | 3.497 | 19.20 |
| + despeckle 0.08 | 995 | 2.997 | 15.39 | 881 | 3.478 | 19.22 |
| + smoothing 24 | 995 | 2.997 | 15.30 | 883 | 3.499 | 19.21 |
| **+ both (shipped)** | **1015** | **2.952** | **14.92** | **895** | **3.478** | **19.08** |

Smoothing and despeckling together gave 3 to 6% more width at the same budget, with colour and
edges a little closer to the picture on both sets.

## Sessions

Each session of the desktop app runs its own copy of the mod and draws its own backdrop, and the
sessions do not hear from one another. The settings and the converted backdrop therefore live in
one snapshot file in pixelbg's folder, `current.json` (`shared.ts`), always written whole: a session
never sees the settings of one change with the backdrop of another, and a file caught half-written
does not parse and is read again. Plain files are used, not the engine's store, because a file read
always sees what another session wrote.

A snapshot carries an id, a revision, and for each setting the revision in which someone last chose
it. Every session reads the file every three seconds and takes up any snapshot whose id is not the
one it shows. A change (`change` in `show.ts`):

1. reads the snapshot (a file that stays unreadable stops the change: it is never written over);
2. converts, when the change needs new pixels or the picture was chosen again on purpose;
3. reads the snapshot again and applies only the settings nobody chose after step 1, so the later
   choice wins, even one that chose the value already there (an explicit `off` stays off);
4. keeps a backdrop whose recorded settings (picture, quality, colours, width in normal mode) match
   the result; if another session chose a picture meanwhile (its `chosen` revision for the picture
   says so; a backdrop on disk alone does not, as it may be the old picture in new colours), its
   picture stays, with its own pixels even for the same file, and this change's picture settings
   give way, with a note;
5. if no backdrop matches settings that are on (another window chose other colours while this one
   converted, say), converts again for the settings as they now stand and goes back to step 3, at
   most three conversions in all; then it gives up with a message and commits nothing, so what is
   committed always holds pixels for its settings;
6. writes the result whole, and only then takes it as this session's own and shows it. A failed
   write changes nothing here.

Two sessions that change things at the same moment can each write after the other's read; the last
write stands, both sessions take it up within three seconds, and both end on the same snapshot.
Pictures are kept by absolute path (a path from the root gets the session's drive on Windows), so
every session means the same file. A theme update the host refused (a `theme.clear` or
`theme.set` that failed, also at a session's start) is tried again at the next three-second look,
so a session never stays unlike its settings. When two sessions choose pictures at once, the one
saved first stays.

The library is one file per entry, one thumbnail file per entry and one removal marker per removed
entry, so no change rewrites another: two windows adding different pictures keep both, the same
picture is one entry (its file name comes from the picture's path), a thumbnail finished late never
brings back an entry removed meanwhile, a rename never undoes a removal, and a damaged entry or
marker is left alone, its entry hidden with a warning, while the rest show. The panel shows the
library as it is on disk after each change, so a write that failed leaves it as it was; another
window's change shows when the panel is opened again.

pixelbg's folders come from the environment, but only when they are absolute on the system the
session runs on (`host.ts`): the engine does not say which system that is, so the session's working
folder does (a drive or share path on Windows, a path from `/` elsewhere). A Windows-style folder in
a Linux session would otherwise be a relative path, inside the user's project. When the working
folder says neither, nothing is written.

Command answers enter the conversation, so they are built from pixelbg's own sentences (`Told` in
`text.ts`), which name files only. An error from elsewhere is named by its code (`EEXIST`), and
FFmpeg's error line is used only when it names no folder; the full message goes to the panel.
`withoutFolders` cuts any path still left in an answer to its file name.

## What was tried and left out

- **Glyphs as pixels**, drawing rows of a custom pixel font: fonts are blocked inside documents, and
  non-ASCII text grows when the tree is encoded as JSON.
- **An embedded bitmap** (`data:` PNG or JPEG inside the SVG): blocked.
- **A palette per band of rows**: colours came closer, but the seams between bands showed as
  stripes.
- **Moving pictures** (GIF and video as one-second SVG segments): the desktop app recreates each
  document when it changes, so swaps flashed, and CSS animation was frozen on some machines.
  Left for a later version.
