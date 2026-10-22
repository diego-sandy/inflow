# Brand source artwork

| File | What it is |
| --- | --- |
| `inflow-icon-source.png` | The original icon artwork, 1254×1254. Reference only. |
| `inflow-wordmark-source.png` | The original wordmark artwork. Reference only. |
| `inflow-mark.svg` | The mark redrawn as vectors: the i's dot, and its stem flowing into three streams. The master for anything 48px and up. |
| `inflow-mark-small.svg` | A simplified cut for small sizes: two streams with wider gaps, so they don't close up at 16–32px. |

Both SVGs share one coordinate space (`viewBox="150 155 980 980"`, the source
artwork's pixel grid, cropped so the mark fills the square) and one gradient:
`#52d8fd` → `#5a8dff` → `#7b3cf0` across the streams, with the dot in
`#4c1d95`. In the app, the dot and the wordmark's "in" lighten to violet in dark
themes, where `#4c1d95` would sink into the background.

Rendered from these (do not edit by hand — re-render from the SVGs):

- `public/icon-16.png`, `icon-32.png` — the toolbar icon, from the small cut.
  Chrome draws the 32 on Retina displays.
- `public/icon-48.png` — the extensions page, from the full mark.
- `public/icon-128.png` — the Chrome Web Store listing and notifications:
  the full mark at 96px inside a 128px canvas, the padding the store asks for.
- `mcp-companion/icon.png` — the Claude companion, the full mark at 112 in 128.

The app's collapsed-sidebar mark (`LogoMark` in
`src/components/common/Wordmark.tsx`) inlines the small cut's paths, so the
app and the toolbar show the same thing.
