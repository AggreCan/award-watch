// The dashboard's grid (public/dash-grid.js; docs/accounts.md, Dashboard):
// the rules the page's script and the Worker share. Property checks over
// seeded random layouts and random runs of moves, resizes and steps (no
// overlap ever, every tile inside the columns and within its sizes, the
// same input always the same output, a compacted layout unchanged by
// compacting again, no tile with a free row above it), then the rules by
// example (pushing down, sliding up, passing a tile at its middle either
// way, sizing, the menu's steps, the earlier panels laid out), and the
// least and starting sizes held to what dashboard_fit.ts says they hold.
import { describe, expect, it } from "vitest";
import {
  BOTH_FROM, COLS, H_MAX, H_MIN, LEAST, NARROW_BELOW, START_H, STEPS, W_MIN, type Step, type Tile, clamp, collides, compact, fromPanels, least, move,
  normalize, place, resize, same, stack, startSize, stepTile, steps, takesBoth,
} from "../public/dash-grid.js";
import { DELAY_MS, KEY_STEPS, UNDO_MAX, fill, layoutJson } from "../public/dashboard.js";
import dashboardJs from "../public/dashboard.js?raw";
import { env } from "cloudflare:test";
import { ROWS_MAX, ROWS_MIN, rowsHeld, tileFit } from "../src/account/dashboard_fit";

// A small seeded generator (mulberry32), so every run checks the same cases and a failure names its seed.
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1)), pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)] };
}

const KEYS = Object.keys(LEAST);

// A layout of n tiles placed anywhere (overlaps, places past the edge and odd sizes allowed), as a post could send.
function anyLayout(r: ReturnType<typeof rng>, n: number): Tile[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `t${i}`, kind: r.pick(KEYS), x: r.int(-3, 14), y: r.int(-2, 40), w: r.int(0, 15), h: r.int(0, 20),
  }));
}

// What every layout the grid gives back must be.
function expectSound(tiles: readonly Tile[], ids: readonly string[], label: string): void {
  expect(tiles.map((t) => t.id).sort(), label).toEqual([...ids].sort());
  for (const t of tiles) {
    const l = least(t.kind, t.w);
    expect(Number.isInteger(t.x) && Number.isInteger(t.y) && Number.isInteger(t.w) && Number.isInteger(t.h), `${label} ${t.id} whole`).toBe(true);
    expect(t.x, `${label} ${t.id} x`).toBeGreaterThanOrEqual(0);
    expect(t.y, `${label} ${t.id} y`).toBeGreaterThanOrEqual(0);
    expect(t.x + t.w, `${label} ${t.id} right edge`).toBeLessThanOrEqual(COLS);
    expect(t.w, `${label} ${t.id} w`).toBeGreaterThanOrEqual(Math.max(W_MIN, l.w));
    expect(t.h, `${label} ${t.id} h`).toBeGreaterThanOrEqual(Math.max(H_MIN, l.h));
    expect(t.h, `${label} ${t.id} h`).toBeLessThanOrEqual(H_MAX);
  }
  for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
    expect(collides(tiles[i], tiles[j]), `${label}: ${tiles[i].id} meets ${tiles[j].id}`).toBe(false);
  }
  // Compacted: every tile at row 0 or resting on a tile above it in its columns.
  for (const t of tiles) {
    const rests = t.y === 0 || tiles.some((o) => o !== t && o.y + o.h === t.y && o.x < t.x + t.w && t.x < o.x + o.w);
    expect(rests, `${label}: ${t.id} has a free row above it`).toBe(true);
  }
  // And compacting again changes nothing.
  expect(same(compact(tiles), tiles), `${label}: compaction is stable`).toBe(true);
}

describe("the grid's properties", () => {
  it("keep any posted layout sound once normalized, the same each time", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r = rng(seed);
      const raw = anyLayout(r, r.int(0, 16));
      const copy = JSON.parse(JSON.stringify(raw));
      const out = normalize(raw);
      expectSound(out, raw.map((t) => t.id), `seed ${seed}`);
      expect(normalize(raw), `seed ${seed}`).toEqual(out);
      expect(normalize(out), `seed ${seed}`).toEqual(out);
      // The input is left as it was.
      expect(raw, `seed ${seed}`).toEqual(copy);
    }
  });

  it("keep every layout sound through any run of moves, resizes and steps, the same each time", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const r = rng(seed * 7919);
      let tiles = normalize(anyLayout(r, r.int(1, 12)));
      const ids = tiles.map((t) => t.id);
      const ops: string[] = [];
      for (let k = 0; k < 25; k++) {
        const id = r.pick(ids);
        const op = r.int(0, 2);
        const before = tiles;
        if (op === 0) {
          const x = r.int(-4, 15);
          const y = r.int(-4, 60);
          tiles = move(tiles, id, x, y);
          expect(move(before, id, x, y), `seed ${seed} move`).toEqual(tiles);
          ops.push(`move ${id} ${x},${y}`);
        } else if (op === 1) {
          const w = r.int(0, 15);
          const h = r.int(0, 20);
          tiles = resize(tiles, id, w, h);
          expect(resize(before, id, w, h), `seed ${seed} resize`).toEqual(tiles);
          ops.push(`resize ${id} ${w}x${h}`);
        } else {
          const s = r.pick(STEPS) as Step;
          tiles = stepTile(tiles, id, s);
          expect(stepTile(before, id, s), `seed ${seed} step`).toEqual(tiles);
          ops.push(`${s} ${id}`);
        }
        expectSound(tiles, ids, `seed ${seed}: ${ops.join("; ")}`);
      }
    }
  });

  it("never change the layout given them", () => {
    const tiles = normalize(anyLayout(rng(5), 8));
    const copy = JSON.parse(JSON.stringify(tiles));
    move(tiles, tiles[0].id, 6, 0);
    resize(tiles, tiles[1].id, 12, 16);
    stepTile(tiles, tiles[2].id, "down");
    steps(tiles, tiles[3].id);
    compact(tiles);
    expect(tiles).toEqual(copy);
  });
});

// Full-width tiles of four rows, one under another: A at 0, B at 4, C at 8.
const column = (): Tile[] => [
  { id: "A", kind: "x", x: 0, y: 0, w: 12, h: 4 }, { id: "B", kind: "x", x: 0, y: 4, w: 12, h: 4 }, { id: "C", kind: "x", x: 0, y: 8, w: 12, h: 4 },
];
const at = (tiles: readonly Tile[]) => Object.fromEntries(tiles.map((t) => [t.id, `${t.x},${t.y} ${t.w}x${t.h}`]));

describe("the grid's rules", () => {
  it("clamp a tile to whole numbers, the columns and its kind's least size", () => {
    expect(clamp({ id: "a", kind: "radar", x: 11.6, y: -3, w: 2, h: 99 })).toEqual({ id: "a", kind: "radar", x: 8, y: 0, w: 4, h: 16 });
    expect(clamp({ id: "a", kind: "radar", x: "x" as never, y: Number.NaN, w: Infinity, h: 1 })).toEqual({ id: "a", kind: "radar", x: 0, y: 0, w: 4, h: 10 });
    // Narrower than NARROW_BELOW, the kind's taller least height; an unknown kind the grid's own.
    expect(least("tenders", NARROW_BELOW - 1)).toEqual({ w: LEAST.tenders.w, h: LEAST.tenders.hn });
    expect(least("tenders", NARROW_BELOW)).toEqual({ w: LEAST.tenders.w, h: LEAST.tenders.h });
    expect(least("org:ending", 12)).toEqual({ w: 4, h: LEAST["org:ending"].h });
    expect(least("org:years", 12)).toEqual({ w: 4, h: LEAST.org.h });
    expect(least("nothing", 12)).toEqual({ w: W_MIN, h: H_MIN });
  });

  it("slide every tile up into the free rows above it, in reading order, a tile never passing another", () => {
    const loose = [
      { id: "a", kind: "x", x: 0, y: 5, w: 6, h: 3 }, { id: "b", kind: "x", x: 6, y: 9, w: 6, h: 2 }, { id: "c", kind: "x", x: 0, y: 20, w: 12, h: 2 },
    ];
    expect(at(compact(loose))).toEqual({ a: "0,0 6x3", b: "6,0 6x2", c: "0,3 12x2" });
    // A tile under a wide one stays under it, though a gap beside a tall one would hold it.
    const gap = [
      { id: "tall", kind: "x", x: 0, y: 0, w: 6, h: 8 }, { id: "short", kind: "x", x: 6, y: 0, w: 6, h: 2 }, { id: "wide", kind: "x", x: 0, y: 8, w: 12, h: 2 },
      { id: "late", kind: "x", x: 6, y: 10, w: 6, h: 2 },
    ];
    expect(at(compact(gap))).toEqual({ tall: "0,0 6x8", short: "6,0 6x2", wide: "0,8 12x2", late: "6,10 6x2" });
    // Two tiles on one place: the later in reading order goes under.
    expect(at(compact([{ id: "p", kind: "x", x: 0, y: 2, w: 12, h: 2 }, { id: "q", kind: "x", x: 0, y: 2, w: 12, h: 3 }]))).toEqual({ p: "0,0 12x2", q: "0,2 12x3" });
  });

  it("push down what a moved tile meets, beside it or under it", () => {
    const side = [{ id: "m", kind: "x", x: 0, y: 0, w: 6, h: 4 }, { id: "b", kind: "x", x: 6, y: 0, w: 6, h: 2 }, { id: "c", kind: "x", x: 6, y: 2, w: 6, h: 2 }];
    // m along its row onto b's column: b and c go under it.
    expect(at(move(side, "m", 6, 0))).toEqual({ m: "6,0 6x4", b: "6,4 6x2", c: "6,6 6x2" });
    // A move to rows of its own changes nothing but its place, which then slides up.
    expect(at(move(side, "m", 0, 30))).toEqual({ m: "0,0 6x4", b: "6,0 6x2", c: "6,2 6x2" });
  });

  it("pass a tile once the moved tile's top reaches its middle going up, or its bottom passes it going down", () => {
    // Up: C over B. At B's lower half it stays under B; from B's middle it goes above, B pushed down.
    expect(at(move(column(), "C", 0, 7))).toEqual(at(column()));
    expect(at(move(column(), "C", 0, 6))).toEqual({ A: "0,0 12x4", C: "0,4 12x4", B: "0,8 12x4" });
    // Down: A over B. Its bottom at B's middle or above, nothing; past it, A goes under B.
    expect(at(move(column(), "A", 0, 2))).toEqual(at(column()));
    expect(at(move(column(), "A", 0, 3))).toEqual({ B: "0,0 12x4", A: "0,4 12x4", C: "0,8 12x4" });
    // Dropped exactly where a tile of its height was, it takes that place, either way.
    expect(at(move(column(), "A", 0, 4))).toEqual({ B: "0,0 12x4", A: "0,4 12x4", C: "0,8 12x4" });
    expect(at(move(column(), "C", 0, 4))).toEqual({ A: "0,0 12x4", C: "0,4 12x4", B: "0,8 12x4" });
    // A tall tile passes only the tiles it was dropped on, and pushes down the ones it then meets.
    const tall = [{ id: "T", kind: "x", x: 6, y: 0, w: 6, h: 11 }, { id: "a", kind: "x", x: 0, y: 0, w: 6, h: 9 }, { id: "M", kind: "x", x: 0, y: 11, w: 12, h: 10 },
      { id: "o", kind: "x", x: 0, y: 21, w: 12, h: 9 }, { id: "s", kind: "x", x: 0, y: 30, w: 12, h: 10 }];
    expect(at(move(tall, "T", 6, 6))).toEqual({ a: "0,0 6x9", M: "0,9 12x10", T: "6,19 6x11", o: "0,30 12x9", s: "0,39 12x10" });
  });

  it("size a tile and push down what it then meets, keeping its column unless the new width passes the edge", () => {
    const pair = [{ id: "l", kind: "x", x: 0, y: 0, w: 6, h: 4 }, { id: "r", kind: "x", x: 6, y: 0, w: 6, h: 4 }, { id: "u", kind: "x", x: 0, y: 4, w: 12, h: 2 }];
    expect(at(resize(pair, "l", 8, 4))).toEqual({ l: "0,0 8x4", r: "6,4 6x4", u: "0,8 12x2" });
    expect(at(resize(pair, "r", 9, 4))).toEqual({ r: "3,0 9x4", l: "0,4 6x4", u: "0,8 12x2" });
    // Shorter: what was under it slides up.
    expect(at(resize(pair, "l", 6, 2))).toEqual({ l: "0,0 6x2", r: "6,0 6x4", u: "0,4 12x2" });
    // Held to the kind's least.
    expect(at(resize([{ id: "k", kind: "radar", x: 0, y: 0, w: 6, h: 9 }], "k", 1, 1))).toEqual({ k: `0,0 4x${LEAST.radar.hn}` });
  });

  it("step a tile a column, a size, or up and down to the next place where the layout changes, and say which steps would", () => {
    expect(at(stepTile(column(), "B", "up"))).toEqual({ B: "0,0 12x4", A: "0,4 12x4", C: "0,8 12x4" });
    expect(at(stepTile(column(), "B", "down"))).toEqual({ A: "0,0 12x4", C: "0,4 12x4", B: "0,8 12x4" });
    // The last tile cannot go down, the first cannot go up, a full-width one cannot go sideways.
    expect(same(stepTile(column(), "C", "down"), column())).toBe(true);
    expect(steps(column(), "A")).toEqual({ left: false, right: false, up: false, down: true, wider: false, narrower: true, taller: true, shorter: true });
    const half = [{ id: "h", kind: "x", x: 3, y: 0, w: 6, h: 4 }];
    expect(at(stepTile(half, "h", "left"))).toEqual({ h: "2,0 6x4" });
    expect(at(stepTile(half, "h", "right"))).toEqual({ h: "4,0 6x4" });
    expect(at(stepTile(half, "h", "wider"))).toEqual({ h: "3,0 7x4" });
    expect(at(stepTile(half, "h", "narrower"))).toEqual({ h: "3,0 5x4" });
    expect(at(stepTile(half, "h", "taller"))).toEqual({ h: "3,0 6x5" });
    expect(at(stepTile(half, "h", "shorter"))).toEqual({ h: "3,0 6x3" });
    expect(steps([{ id: "z", kind: "x", x: 0, y: 0, w: W_MIN, h: H_MIN }], "z")).toMatchObject({ narrower: false, shorter: false, left: false, right: true });
    // A tall tile's step down passes the one tile under it, not every tile below.
    const tall = [{ id: "T", kind: "x", x: 6, y: 0, w: 6, h: 11 }, { id: "a", kind: "x", x: 0, y: 0, w: 6, h: 9 }, { id: "M", kind: "x", x: 0, y: 11, w: 12, h: 10 },
      { id: "o", kind: "x", x: 0, y: 21, w: 12, h: 9 }, { id: "s", kind: "x", x: 0, y: 30, w: 12, h: 10 }];
    expect(stack(stepTile(tall, "T", "down")).map((t) => t.id)).toEqual(["a", "M", "T", "o", "s"]);
  });

  it("lay the earlier panels out in their order and widths, half-width ones two to a row, at their kinds' starting heights", () => {
    const out = fromPanels([
      { id: "w", kind: "watches", wide: true }, { id: "h1", kind: "radar", wide: false }, { id: "h2", kind: "api", wide: false },
      { id: "h3", kind: "tenders", wide: false }, { id: "f", kind: "org:years", wide: true },
    ]);
    expect(at(out)).toEqual({
      w: `0,0 12x${START_H.watches}`, h1: `0,${START_H.watches} 6x${START_H.radar}`, h2: `6,${START_H.watches} 6x${START_H.api}`,
      h3: `0,${START_H.watches + START_H.radar} 6x${START_H.tenders}`, f: `0,${START_H.watches + START_H.radar + START_H.tenders} 12x${START_H.org}`,
    });
    expect(startSize("view:segment", true)).toEqual({ w: 12, h: START_H["view:segment"] });
    // An added tile goes under the others at the left, then slides up.
    expect(at(place(column(), { id: "n", kind: "x", x: 9, y: 0, w: 6, h: 3 }))).toEqual({ ...at(column()), n: "0,12 6x3" });
    expect(at(place([{ id: "a", kind: "x", x: 6, y: 0, w: 6, h: 8 }], { id: "n", kind: "x", x: 0, y: 0, w: 6, h: 3 }))).toEqual({ a: "6,0 6x8", n: "0,0 6x3" });
  });

  it("put a tile of seven columns or more across both of the narrower page's two", () => {
    expect(BOTH_FROM).toBe(7);
    expect(takesBoth({ id: "a", x: 0, y: 0, w: 6, h: 4 })).toBe(false);
    expect(takesBoth({ id: "a", x: 0, y: 0, w: 7, h: 4 })).toBe(true);
    expect(stack([{ id: "b", x: 6, y: 0, w: 6, h: 2 }, { id: "c", x: 0, y: 2, w: 6, h: 2 }, { id: "a", x: 0, y: 0, w: 6, h: 2 }]).map((t) => t.id)).toEqual(["a", "b", "c"]);
  });
});

// The size keys of each kind and a ref that gives it (dashboard.tsx sizeKey).
const SIZED: [string, string, string][] = [
  ["tenders", "tenders", ""], ["radar", "radar", "3m"], ["records", "records", ""], ["watches", "watches", ""], ["view", "view", "/buyers/pwgsc-tpsgc/analytics?source=awards&years=10"],
  ["view:segment", "view", "/segments/81/analytics?source=awards&years=10"], ["briefing", "briefing", ""], ["org", "org", "years"], ["org", "org", "segments"],
  ["org", "org", "buyers"], ["org:share", "org", "share"], ["org:ending", "org", "ending"], ["org:instruments", "org", "instruments"], ["matches", "matches", ""],
  ["api", "api", ""],
];

describe("the least and starting sizes", () => {
  it("hold three rows at every width from the least, and the five each list showed at half the row", () => {
    for (const [key, kind, ref] of SIZED) {
      for (let w = least(key).w; w <= COLS; w++) {
        expect(rowsHeld(kind, ref, w, least(key, w).h), `${key} ${ref} at ${w} columns`).toBeGreaterThanOrEqual(ROWS_MIN);
      }
      const half = startSize(key, false);
      expect(rowsHeld(kind, ref, half.w, half.h), `${key} ${ref} starting`).toBeGreaterThanOrEqual(kind === "view" ? ROWS_MIN : 5);
      expect(rowsHeld(kind, ref, COLS, startSize(key, true).h), `${key} ${ref} starting wide`).toBeGreaterThanOrEqual(kind === "view" ? ROWS_MIN : 5);
    }
    // Every key the grid lists is one a tile can have.
    expect(new Set(SIZED.map(([k]) => k))).toEqual(new Set(Object.keys(LEAST)));
    expect(Object.keys(START_H).sort()).toEqual(Object.keys(LEAST).sort());
  });

  it("give a list 3 to 25 rows and a chart its tile's width and height", () => {
    expect(tileFit("radar", "3m", 4, 2).rows).toBe(ROWS_MIN);
    expect(tileFit("briefing", "", 12, 16).rows).toBe(ROWS_MAX);
    expect(tileFit("radar", "3m", 12, 16).rows).toBeGreaterThan(tileFit("radar", "3m", 12, 9).rows);
    // Narrower than its table, a tile's rows stack and stand taller: fewer of them at one height.
    expect(tileFit("radar", "3m", 4, 12).stacked).toBe(true);
    expect(tileFit("radar", "3m", 6, 12).stacked).toBe(false);
    expect(tileFit("radar", "3m", 4, 12).rows).toBeLessThan(tileFit("radar", "3m", 6, 12).rows);
    const small = tileFit("view", "/buyers/pwgsc-tpsgc/analytics?source=awards&years=10", 4, 5).chart!;
    const big = tileFit("view", "/buyers/pwgsc-tpsgc/analytics?source=awards&years=10", 12, 12).chart!;
    expect(big.width).toBeGreaterThan(small.width);
    expect(big.height).toBeGreaterThan(small.height);
    expect(tileFit("view", "/segments/81/analytics?source=awards&years=10", 12, 12).chart!.panels).toBe(2);
  });
});

describe("the page's script", () => {
  it("asks the grid for every rule, puts the Worker's fragment in place without writing markup, and keeps to the handles", () => {
    // The grid's rules come from the one module; the script defines none of its own.
    expect(dashboardJs).toMatch(/^import \{[^}]*\bmove\b[^}]*\bresize\b[^}]*\bstepTile\b[^}]*\} from "\.\/dash-grid\.js";$/m);
    expect(dashboardJs).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    expect(dashboardJs).toContain("new DOMParser().parseFromString(");
    expect(dashboardJs).toContain("replaceChildren(");
    expect(dashboardJs).toContain("setPointerCapture(");
    expect(dashboardJs).toContain('"(prefers-reduced-motion: reduce)"');
    // Nothing runs on import outside a page.
    expect(typeof (globalThis as { document?: unknown }).document).toBe("undefined");
    // touch-action none on the two handles alone; their sliding off for a reader who asks for less motion.
    const styles = (env as unknown as { STYLES_CSS: string }).STYLES_CSS;
    expect([...styles.matchAll(/^([^{\n]*)\{[^}\n]*touch-action: none/gm)].map((m) => m[1].trim())).toEqual([".dash-grip, .dash-corner"]);
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\n\s*\.dash-grip, \.dash-corner \{ transition: none; \}/);
  });

  it("fills its words' pieces, sends a layout as the Worker reads it, and maps the arrows to the grid's steps", () => {
    expect(fill(["", "title", ": column ", "x", " of ", "cols", "."], { title: "Contracts ending", x: 3, cols: 12 })).toBe("Contracts ending: column 3 of 12.");
    expect(fill("not pieces", {})).toBe("");
    expect(JSON.parse(layoutJson([{ id: "a", kind: "radar", x: 1, y: 2, w: 6, h: 9 }]))).toEqual([{ id: "a", x: 1, y: 2, w: 6, h: 9 }]);
    expect(KEY_STEPS.grip).toEqual({ ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" });
    expect(KEY_STEPS.corner).toEqual({ ArrowLeft: "narrower", ArrowRight: "wider", ArrowUp: "shorter", ArrowDown: "taller" });
    for (const s of [...Object.values(KEY_STEPS.grip), ...Object.values(KEY_STEPS.corner)]) expect(STEPS).toContain(s);
    expect(UNDO_MAX).toBe(20);
    expect(DELAY_MS).toBeGreaterThan(0);
  });
});
