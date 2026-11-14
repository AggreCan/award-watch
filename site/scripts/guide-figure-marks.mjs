// The marks drawn over a guide figure (public/styles.css, the guide's figure
// block; docs/guides.md, Figures), in CSS pixels on the guide's page. One
// source for the stylesheet's numbers, which test/guide-figures.test.ts holds
// equal to these, and for scripts/make-guide-figures.mjs, which refuses a
// figure whose marks would cover any text.
//
// A mark is the field's own box with an emerald edge drawn outside it: `gap`
// of room, then `edge` of line (.fig-mark's outline-offset and outline). Its
// number sits in a square to the left of the edge, its top level with the
// edge's top and its right side against the edge's left side (.fig-num). A
// square on a field at the image's left edge hangs out of the image into the
// room the frame is indented by (.fig-frame's margin-left), inside the guide
// column's padding, and stays `clear` inside that padding.
export const MARK = Object.freeze({
  edge: 2,
  gap: 3,
  square: 20,
  indent: 8,
  padding: 16,
  clear: 2,
});

// The guide column's content width at its full 880 px measure, and on a
// 390 px phone (less the 16 px gutters as well); the frame takes the indent
// out of each.
export const COLUMN = 846;
export const PHONE_COLUMN = 324;
