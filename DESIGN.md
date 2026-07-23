# Luna AI Cut — 设计文档

## Direction

Luna AI Cut uses a photography-first desktop style: the media is the product, and the interface should step back. The application borrows the restraint of Apple's product pages without turning into a marketing site: a thin black global bar, a frosted contextual bar, compact controls, then a real gallery surface where photos and videos dominate the viewport.

## Principles

- Put real media first. Every major surface should contain an actual image or playable preview when one is available.
- Use near-invisible UI. Controls stay compact, textual chrome is sparse, and selection states should not cover the media.
- Keep one accent: Action Blue `#0066cc` for primary actions, links, selected states, and focus.
- Alternate surfaces with color, not decoration: white, parchment `#f5f5f7`, and near-black `#272729`.
- Use flat UI. Shadows are reserved for media or preview objects only, never for buttons or text.
- Keep typography quiet and confident: system SF stack, 600-weight headlines, 17px body text, tight display letter spacing.
- Buttons use Apple-like grammars: blue primary pills, outline secondary pills, compact utility rectangles, and circular icon controls over media.

## Tokens

### Color

- `--blue`: `#0066cc`
- `--blue-dark`: `#004f9f`
- `--blue-on-dark`: `#2997ff`
- `--canvas`: `#ffffff`
- `--parchment`: `#f5f5f7`
- `--tile-dark`: `#272729`
- `--tile-dark-2`: `#2a2a2c`
- `--black`: `#000000`
- `--ink`: `#1d1d1f`
- `--muted`: `#6e6e73`
- `--muted-dark`: `#cccccc`
- `--hairline`: `rgba(0, 0, 0, 0.08)`

### Typography

- Display: `system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", sans-serif`
- Body: same stack, with 17px as the default readable size.
- Hero title: 56px / 600 / 1.07 / `-0.28px`
- Tile title: 40px / 600 / 1.1
- Lead: 24-28px / 400 / 1.2
- Body: 17px / 400 / 1.47
- Caption: 12-14px / 400

### Shape

- Full-bleed tiles: `0px`
- Utility buttons: `8px`
- Cards and media cells: `18px`
- Pills and search: `999px`
- Circular controls: `50%`

## Layout

- The app uses two persistent bars:
  - Global nav: 44px black bar with section tabs and compact status. The native app title bar already carries the product name, so do not repeat it here.
  - Sub nav: 52px parchment blur bar with the active date pinned on the left and search/filter/read controls grouped on the right.
- The Library page opens directly into an album workflow. Do not place a large hero preview or repeated page title before the gallery.
- Gallery sections group by day. Media type switches are tabs: All, Photos, Videos.
- Files are sorted by captured time descending. Keep the visual layout as a normal card grid, not masonry, so order remains easy to follow left-to-right and top-to-bottom.
- Sorting can be toggled between captured-time descending and ascending from the date row. Descending is the default.
- Card preview size can switch between large, medium, and small from the date row. Large is the default; medium reduces card width by about one third; small reduces it by about one third again.
- Video cells use the LRV preview source where available.
- Connection state and Wi-Fi settings live only in the top global nav.
- Settings use one quiet list on parchment, not a card wall. Each row keeps one setting, one value, and one action.
- The top nav separates `设备媒体库` and `已下载`. The downloaded view uses the same gallery grammar, but its source is the selected download directory grouped by date folders.

## Interaction

- Primary action: blue pill, active scale `0.95`.
- Secondary action: outline blue pill.
- Icon action over media: translucent circular chip.
- Dialogs, popovers, floating panels, progress dropdowns, and modal backdrops use frosted glass: a visible blur/saturate backdrop, a sufficiently opaque glass surface, and a subtle light border. Do not use low-opacity overlays without blur because media behind the layer must never compete with foreground text.
- Selection: blue ring and small check chip; never tint the whole image.
- Drag selection: dragging across media cards adds files to the current selection while preserving normal click-to-preview behavior.
- Drag selection uses a visible rectangular marquee. It activates only after the pointer moves at least half a card width, then selects all cards intersecting the marquee.
- Download state: circular progress appears at the top-left of a media card. Finished downloads become a blue folder chip that reveals the downloaded file in the system file browser.
- Downloads are written into date folders under the selected download directory. Each file is first written as `filename.tmp`, then renamed to the final file name after completion.
- Downloaded state is derived by scanning the expected date folder and matching final file names against the current library; no separate downloaded-state database is required.
- Downloaded view media is already local. It should not expose download or selection actions; it keeps preview, reveal-in-folder, search, filter, sort, and size controls.
- Preview: edge-to-edge dark modal, actual image or video centered.
- Preview inspector: the media stays dominant on the left, with a restrained right-side inspector for dimensions, file size, capture time, video duration, bitrate estimate, and a curated image property list matching the app's useful camera attributes.
- Image color analytics use overlaid area curves for luminance, red, green, and blue instead of bar charts.
- Preview navigation: image arrow keys switch previous/next media; video arrow keys seek backward/forward. Wheel zoom is reserved for images.
- Download state is persistent across app reloads when the downloaded file still exists locally.

## Applied To This App

- Demo assets are loaded from the configured Mock media directory so image and video preview states can be evaluated without a Luna device.
- Real Luna device loading remains available through the same UI. The app should make the source clear with a short status line, not a large empty instruction block.
- LRV files remain hidden in the gallery when paired with MP4, but are used as the low-resolution preview source.
