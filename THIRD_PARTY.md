# Third-party material

## Included in this repository

### make-colors.js and make-colors.d.ts (hooks/)

From Anthropic's plugin-authoring skill, as shipped with Claude Code 2.1.325: the design system's
theme code, which turns a few colours into a full theme the Claude apps can paint. The file's own
first line says to copy it into a mod's hooks folder and leave it as it is, and the skill's guide to
themes says the same; it is unchanged here (the release checks compare it with the hash in its
header). It is Anthropic's work, provided
with Claude Code for building mods, and is not covered by this repository's MIT license.

## Used, not included

### FFmpeg

pixelbg starts the `ffmpeg` and `ffprobe` programs you have installed to read pictures. FFmpeg is
not part of this repository and is not distributed with it. FFmpeg is licensed under the LGPL 2.1
or later, or the GPL 2 or later depending on how it was built; see <https://ffmpeg.org/legal.html>.

### Claude Code

pixelbg is a mod for Claude Code and runs on its plugin API (the `claude-code` types it imports are
erased at run time). Claude Code is Anthropic's product, under its own terms.

## Methods

- **OKLab**, the colour space pixelbg measures colour differences in, was published by Björn
  Ottosson (2020). pixelbg's conversion is its own implementation of the published formulas.
- **Median cut** (Paul Heckbert, 1982) and **k-means** are long-published methods, implemented here
  from their descriptions.

## Pictures

Every picture in this repository is drawn from code alone, with no fonts or outside images: the
mark, logo, icon and pipeline picture (`assets/brand/`, `docs/images/pipeline*.svg`) by
[scripts/make-brand.mjs](scripts/make-brand.mjs), whose letters are drawn on its own pixel grid, and
the example scene (`docs/images/demo-*.png`) by [scripts/make-art.mjs](scripts/make-art.mjs). They
are covered by the MIT license with the rest of the repository.
