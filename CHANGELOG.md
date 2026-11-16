# Changelog

All notable changes to pixelbg are listed here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-17

The first test release.

### Added

- Your own still pictures as a pixel-art backdrop behind the Claude desktop app's Code tab.
- Two quality modes: high quality (finds the largest resolution that fits, up to 1,200 pixels across)
  and normal (you pick the width).
- A side panel (`/pixelbg`) with a picture library (thumbnails, use, rename, remove with undo) and
  every setting; minimized, a small card with a switch.
- Settings for colours, fit, dimming and the panels' frosted glass, as sliders and as commands.
- App colours taken from the picture, with a switch.
- Sixteen languages, following the system language (English for any other): English, Traditional
  and Simplified Chinese, Japanese, Korean, Spanish, French, German, Brazilian Portuguese, Italian,
  Indonesian, Hindi, Russian, Vietnamese, Thai and Turkish.
- Long conversions answer the command in time and finish in the background, with a notice.
- Photos marked as turned (portrait phone photos) are read upright.
- FFmpeg may open local files only, through local formats only; the backdrop is drawn in the
  desktop app only.
- A change made in one session reaches every open session within a few seconds, and all of them end
  on the same settings; when sessions change things while one converts, the later choice of each
  setting wins (two saves in the very same instant: the last one stands).
- Command answers name files only: no folders of your pictures, your project or FFmpeg, and no home
  folder; an error from the system by its code, with the full message in the panel.
- Network shares are refused before anything looks at them.
- pixelbg's folders are taken only where they are absolute on the system the session runs on, so
  nothing lands in your project.
