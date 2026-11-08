# Brand files

The mark is lowercase "aw" set in Inter Bold, with the second v of the w redrawn as a
tick: its short down-stroke is cut across at half x-height, it turns on a rounded joint
that sits on the baseline, and its long stroke is carried on past x-height, turning
outward and tapering, to end in Inter's flat cut at 1.5 x-heights. A hairline across the
down-stroke separates the tick from the w; in the two-tone version the tick is emerald
`#0f7b4f`. The a and the w are Inter's own glyphs (SIL Open Font License,
`fonts/Inter-Bold.ttf`, the static file from the Inter release). The icon PNG and ICO
files the site ships are generated from these SVGs by `site/scripts/make-icons.py`.

| File | Use |
|---|---|
| `mark.svg` | One colour, filled with `currentColor`. The hairline crosses the tick's down-stroke and shows as a break in the stroke from about 32 px up. For anywhere a single colour is required. |
| `mark-two-tone.svg` | The check in emerald. The header mark. |
| `favicon-w.svg` | The browser tab: a white rounded tile with the w and its check alone, which is what still reads at 16 px. |
| `favicon.svg` | The same tile with the whole mark, kept for larger icons. |
| `wordmark.svg` | "award watch" with the check built into its own first two letters. |
| `lockup.svg` | The mark beside "Award Watch". |
| `make_mark.py` | Regenerates every file above. Run `python brand/make_mark.py`. |
| `make_wordmark_png.py` | Renders `wordmark.svg` with Chrome headless as the sign-in message's two header images, `site/public/brand/wordmark.png` (ink on white) and `wordmark-dark.png` (light ink on transparent), 284 by 40 pixels each, and checks each file's size and ground. Run `python brand/make_wordmark_png.py` after changing the wordmark. |

`explorations/` holds the directions tried on 2026-10-31 before this one (three grid
pictograms, serif and sans monograms, a single-stroke AW with a kinked tail, and the
lowercase cut across eight sans faces) with the scripts that drew them. The fonts those
scripts fetch go under `fonts/variations/`, which is not tracked.

Colours: ink is the page text colour of whichever direction the site adopts; the emerald
is fixed by the mark and is the site's accent.
