"""Writes site/src/canada_map.ts, the outlines of the home page's Canada map.

Source: Statistics Canada, 2021 Census cartographic boundary file for
provinces and territories, under the Statistics Canada Open Licence
(https://www12.statcan.gc.ca/census-recensement/2021/geo/sip-pis/boundary-limites/index2021-eng.cfm).
The input is that layer as JSON rings in longitude and latitude (EPSG:4326),
one feature per province or territory carrying its PRUID:

  {"features": [{"attributes": {"PRUID": "59", ...}, "geometry": {"rings": [[[lon, lat], ...], ...]}}, ...]}

which is what layer 0 of Statistics Canada's map service for those files
answers to a query per PRUID (outSR=4326, f=json; the whole country in one
request fails):
  https://geo.statcan.gc.ca/geo_wa/rest/services/2021/Cartographic_boundary_files/MapServer/0/query
Any generalization of the file will do (0.03 degrees is plenty; the three
Maritime provinces, which the inset enlarges, read better at 0.005), since
the steps below simplify it again for the page.

The outlines are drawn in Statistics Canada's own Lambert conformal conic
(EPSG:3347) so the country has the shape readers know, scaled into a viewBox
WIDTH units wide. The Maritime provinces are a few units across at that scale,
so an inset in the top right corner, over the Arctic islands, repeats them
enlarged. Each ring is simplified with Douglas-Peucker at TOLERANCE units of
its own drawing (main map or inset), rings whose bounding box covers less
than MIN_RING_AREA square units are dropped (the small islands), and points
are rounded to whole units: at the map's widest the drawing is about 600
pixels across, so a unit is under a pixel. The paths are written with
relative steps, which keeps the file small; the same input always gives the
same bytes.

Labels sit at fixed points (longitude, latitude), chosen so a province's
code and its count fit inside it: the prairie labels staggered, Prince
Edward Island's above it in the Gulf and Nova Scotia's below it, both on the
water of the inset.

Between two neighbours the page leaves a gap, so two provinces on one step of
the ramp still read as two shapes. The script writes the land borders
(LAND_BORDERS) for that, as open lines worked from the outlines as drawn:
each is the later-drawn neighbour's own edge where it runs within
BORDER_REACH units of the earlier one's. A coast gets no line, so no island
is thinned by it.

Run from the repository root or from site/:
  python site/scripts/make-canada-map.py --from <boundaries.json>
  python site/scripts/make-canada-map.py --borders
The second works the borders again from the outlines already in the output
file, without the boundary file.
Output: site/src/canada_map.ts.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
OUT = SITE / "src" / "canada_map.ts"

# Statistics Canada's province and territory codes (PRUID) to the postal abbreviations.
CODES = {"10": "NL", "11": "PE", "12": "NS", "13": "NB", "24": "QC", "35": "ON", "46": "MB",
         "47": "SK", "48": "AB", "59": "BC", "60": "YT", "61": "NT", "62": "NU"}
MARITIMES = ("NB", "NS", "PE")

WIDTH = 1000
PAD = 6
TOLERANCE = {"main": 1.1, "inset": 0.8}
MIN_RING_AREA = {"main": 40.0, "inset": 8.0}
# Edges longer than this (degrees) are cut before projecting (densify).
DENSIFY_DEG = 0.25
# The inset's frame on the map: top right, over the Arctic islands.
INSET = (WIDTH - 272, PAD, 266, 196)
INSET_PAD = 14
# The land borders: each pair of neighbours that meet on land, first the one
# the page draws first (it draws them in the order of their codes). A strait
# is not a border, so Prince Edward Island has none.
LAND_BORDERS = (("AB", "BC"), ("AB", "NT"), ("AB", "SK"), ("BC", "NT"), ("BC", "YT"), ("MB", "NU"), ("MB", "ON"),
                ("MB", "SK"), ("NB", "NS"), ("NB", "QC"), ("NL", "QC"), ("NT", "NU"), ("NT", "SK"), ("NT", "YT"),
                ("ON", "QC"))
# Two neighbours' drawings of one border lie within BORDER_REACH units of each
# other (the narrowest strait drawn is twice that wide). A break shorter than
# BORDER_BRIDGE inside a border is drawn through, and a run shorter than
# BORDER_MIN is two corners touching, which is no border.
BORDER_REACH = 1.5
BORDER_BRIDGE = 3.0
BORDER_MIN = 3.0
# The side of a square of the grid that finds the edges near a point.
BORDER_CELL = 16

# Label anchors (longitude, latitude). Codes and counts are drawn in two lines
# centred on the point.
MAIN_LABELS = {"BC": (-124.2, 54.6), "AB": (-114.6, 55.0), "SK": (-105.6, 52.4), "MB": (-97.6, 55.6),
               "ON": (-86.4, 50.4), "QC": (-72.4, 52.0), "NL": (-62.2, 53.4), "YT": (-135.6, 63.4),
               "NT": (-120.0, 64.2), "NU": (-97.0, 66.6)}
INSET_LABELS = {"NB": (-66.4, 46.5), "NS": (-63.4, 44.0), "PE": (-63.2, 47.45)}

# Lambert conformal conic on the unit sphere with EPSG:3347's parameters:
# standard parallels 49 and 77, latitude of origin 63.390675, central meridian -91.866667.
_LAT1, _LAT2, _LAT0, _LON0 = map(math.radians, (49.0, 77.0, 63.390675, -91.866667))
_N = math.log(math.cos(_LAT1) / math.cos(_LAT2)) / math.log(
    math.tan(math.pi / 4 + _LAT2 / 2) / math.tan(math.pi / 4 + _LAT1 / 2))
_F = math.cos(_LAT1) * math.tan(math.pi / 4 + _LAT1 / 2) ** _N / _N
_RHO0 = _F / math.tan(math.pi / 4 + _LAT0 / 2) ** _N

Point = tuple[float, float]


def lcc(lon: float, lat: float) -> Point:
    """Projected x (east) and y (north) of a longitude and latitude."""
    rho = _F / math.tan(math.pi / 4 + math.radians(lat) / 2) ** _N
    theta = _N * (math.radians(lon) - _LON0)
    return rho * math.sin(theta), _RHO0 - rho * math.cos(theta)


def fit(rings: list[list[Point]], box: tuple[float, float, float, float], pad: float):
    """A function from projected units to viewBox units that centres the rings in box (x, y, w, h), north up."""
    x0, y0, w, h = box
    xs = [p[0] for r in rings for p in r]
    ys = [p[1] for r in rings for p in r]
    mnx, mxx, mny, mxy = min(xs), max(xs), min(ys), max(ys)
    s = min((w - 2 * pad) / (mxx - mnx), (h - 2 * pad) / (mxy - mny))
    ox = x0 + pad + ((w - 2 * pad) - (mxx - mnx) * s) / 2
    oy = y0 + pad + ((h - 2 * pad) - (mxy - mny) * s) / 2
    return lambda x, y: (ox + (x - mnx) * s, oy + (mxy - y) * s)


def dp(points: list[Point], tol: float) -> list[Point]:
    """Douglas-Peucker on an open polyline; keeps both ends."""
    if len(points) < 3:
        return points
    (x0, y0), (x1, y1) = points[0], points[-1]
    dx, dy = x1 - x0, y1 - y0
    norm = math.hypot(dx, dy) or 1e-12
    best, idx = 0.0, 0
    for i in range(1, len(points) - 1):
        px, py = points[i]
        dist = abs(dy * px - dx * py + x1 * y0 - y1 * x0) / norm
        if dist > best:
            best, idx = dist, i
    if best > tol:
        return dp(points[: idx + 1], tol)[:-1] + dp(points[idx:], tol)
    return [points[0], points[-1]]


def simplify(ring: list[Point], tol: float, min_area: float) -> list[tuple[int, int]] | None:
    """A ring in viewBox units, simplified and rounded, or None when it is too small to draw."""
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    if (max(xs) - min(xs)) * (max(ys) - min(ys)) < min_area:
        return None
    # A ring closes on its first point, which gives Douglas-Peucker a zero-length
    # baseline; open it at the point farthest from the start and simplify the halves.
    x0, y0 = ring[0]
    k = max(range(1, len(ring) - 1), key=lambda i: (ring[i][0] - x0) ** 2 + (ring[i][1] - y0) ** 2)
    simple = dp(ring[: k + 1], tol)[:-1] + dp(ring[k:], tol)
    out: list[tuple[int, int]] = []
    for x, y in simple:
        p = (round(x), round(y))
        if not out or out[-1] != p:
            out.append(p)
    if len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out if len(out) >= 3 else None


def numbers(values: list[int]) -> str:
    """Numbers as SVG path data writes them: a minus sign separates two numbers without a space."""
    s = ""
    for v in values:
        s += (str(v) if v < 0 or not s else f" {v}")
    return s


def path_data(rings: list[list[tuple[int, int]]], end: str = "z") -> str:
    """Each ring as one absolute move and relative lines, closed; with end="" each is an open line."""
    parts = []
    for ring in rings:
        (x, y), rest = ring[0], ring[1:]
        steps: list[int] = []
        px, py = x, y
        for qx, qy in rest:
            steps += [qx - px, qy - py]
            px, py = qx, qy
        parts.append(f"M{numbers([x, y])}l{numbers(steps)}{end}")
    return "".join(parts)


def rings_of(data: str) -> list[list[tuple[int, int]]]:
    """The rings of path data as path_data writes it."""
    out = []
    for part in data.split("z"):
        if not part:
            continue
        head, _, steps = part.partition("l")
        x, y = (int(v) for v in re.findall(r"-?\d+", head))
        ring = [(x, y)]
        values = [int(v) for v in re.findall(r"-?\d+", steps)]
        for dx, dy in zip(values[::2], values[1::2]):
            x, y = x + dx, y + dy
            ring.append((x, y))
        out.append(ring)
    return out


def _distance(p: Point, a: Point, b: Point) -> float:
    """From a point to a segment."""
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    length = dx * dx + dy * dy
    t = 0.0 if length == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def _runs(ring: list[tuple[int, int]], near) -> list[list[tuple[int, int]]]:
    """The stretches of a ring that lie along a neighbour (near says so of a point), as open lines."""
    # Points a unit apart at most around the ring: where each is, the length of the step
    # to the next, and whether it is one of the ring's own points.
    points: list[tuple[Point, float, bool]] = []
    for (ax, ay), (bx, by) in zip(ring, ring[1:] + ring[:1]):
        length = math.hypot(bx - ax, by - ay)
        n = max(1, math.ceil(length))
        points += [((ax + (bx - ax) * i / n, ay + (by - ay) * i / n), length / n, i == 0) for i in range(n)]
    flags = [near(p) for p, _, _ in points]
    if not any(flags):
        return []
    # Begin on a point off the border, so no run wraps past the end of the list.
    start = flags.index(False) if not all(flags) else 0
    points, flags = points[start:] + points[:start], flags[start:] + flags[:start]
    runs: list[list[int]] = []
    gap = math.inf
    for i, flag in enumerate(flags):
        if flag:
            if runs and gap < BORDER_BRIDGE:
                runs[-1][1] = i
            else:
                runs.append([i, i])
            gap = 0.0
        gap += points[i][1]
    lines = []
    for first, last in runs:
        if sum(points[k][1] for k in range(first, last)) < BORDER_MIN:
            continue
        line: list[tuple[int, int]] = []
        for k in range(first, last + 1):
            (x, y), _, own = points[k]
            if own or k in (first, last):
                p = (round(x), round(y))
                if not line or line[-1] != p:
                    line.append(p)
        if len(line) > 1:
            lines.append(line)
    return lines


def border_lines(paths: dict[str, str]) -> str:
    """The land borders among the drawn outlines, as open lines. Each is the later-drawn neighbour's own edge
    where it runs along the earlier one's, so the line lies on the edge the page shows. Worked from the path
    data as written, so the same outlines always give the same borders."""
    shapes = {code: rings_of(data) for code, data in paths.items()}
    lines: list[list[tuple[int, int]]] = []
    for code in sorted(shapes):
        grid: dict[tuple[int, int], list[tuple[Point, Point]]] = {}
        for first, second in LAND_BORDERS:
            if second != code or first not in shapes:
                continue
            for ring in shapes[first]:
                for a, b in zip(ring, ring[1:] + ring[:1]):
                    for cx in range(int((min(a[0], b[0]) - BORDER_REACH) // BORDER_CELL), int((max(a[0], b[0]) + BORDER_REACH) // BORDER_CELL) + 1):
                        for cy in range(int((min(a[1], b[1]) - BORDER_REACH) // BORDER_CELL), int((max(a[1], b[1]) + BORDER_REACH) // BORDER_CELL) + 1):
                            grid.setdefault((cx, cy), []).append((a, b))
        if not grid:
            continue

        def near(p: Point) -> bool:
            cell = (int(p[0] // BORDER_CELL), int(p[1] // BORDER_CELL))
            return any(_distance(p, a, b) <= BORDER_REACH for a, b in grid.get(cell, ()))

        for ring in shapes[code]:
            lines += _runs(ring, near)
    return path_data(lines, end="")


def borders_block(paths: dict[str, str], inset_paths: dict[str, str]) -> str:
    """The borders as the output file carries them."""
    return (
        "// The land borders between neighbours, as open lines: on the main map and in\n"
        "// the inset. The map draws them as a gap in the colour of its ground.\n"
        f"export const MAP_BORDERS = {json.dumps(border_lines(paths))};\n"
        f"export const INSET_BORDERS = {json.dumps(border_lines(inset_paths))};\n\n"
    )


# The line of the output file the borders are written above.
BORDERS_BEFORE = "// Where the inset's provinces lie on the main map.\n"


def reborder(out: Path) -> str:
    """The written file with its borders worked again from its own outlines."""
    text = out.read_text(encoding="utf-8")

    def paths(name: str) -> dict[str, str]:
        body = re.search(name + r": [^=]*= \{\n(.*?)\n\};", text, re.S)
        if not body:
            raise SystemExit(f"no {name} in {out}")
        return dict(re.findall(r'^  ([A-Z]{2}): "([^"]*)",$', body.group(1), re.M))

    block = borders_block(paths("MAP_PATHS"), paths("INSET_PATHS"))
    old = re.search(r"// The land borders between neighbours.*?\n\n", text, re.S)
    if old:
        return text[: old.start()] + block + text[old.end():]
    if text.count(BORDERS_BEFORE) != 1:
        raise SystemExit(f"{out} is not this script's output")
    return text.replace(BORDERS_BEFORE, block + BORDERS_BEFORE)


def densify(ring: list[Point], step: float = DENSIFY_DEG) -> list[Point]:
    """The ring with points added along any edge longer than step degrees. A border along a parallel (the
    60th, the 49th) is a straight edge in longitude and latitude but an arc once projected, and the
    neighbours on either side of it may carry different points: drawn as chords they would leave a sliver
    between them, so every edge is cut short enough to follow the arc before projecting."""
    out = [ring[0]]
    for (x0, y0), (x1, y1) in zip(ring, ring[1:]):
        n = max(1, math.ceil(max(abs(x1 - x0), abs(y1 - y0)) / step))
        out += [(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n) for i in range(1, n + 1)]
    return out


def read(path: Path) -> dict[str, list[list[Point]]]:
    """The projected rings of each province and territory, by code."""
    data = json.loads(path.read_text(encoding="utf-8"))
    out: dict[str, list[list[Point]]] = {}
    for f in data["features"]:
        code = CODES[str(f["attributes"]["PRUID"])]
        rings = [[lcc(x, y) for x, y in densify([(float(p[0]), float(p[1])) for p in ring])]
                 for ring in f["geometry"]["rings"] if len(ring) >= 4]
        out.setdefault(code, []).extend(rings)
    missing = sorted(set(CODES.values()) - set(out))
    if missing:
        raise SystemExit(f"no outline for {', '.join(missing)}")
    return out


def draw(shapes: dict[str, list[list[Point]]], pt, kind: str) -> dict[str, str]:
    out = {}
    for code in sorted(shapes):
        kept = [r for ring in shapes[code] if (r := simplify([pt(x, y) for x, y in ring], TOLERANCE[kind], MIN_RING_AREA[kind]))]
        out[code] = path_data(kept)
    return out


def label_points(labels: dict[str, Point], pt) -> dict[str, tuple[int, int]]:
    return {code: tuple(round(v) for v in pt(*lcc(lon, lat))) for code, (lon, lat) in sorted(labels.items())}


def build(source: Path) -> str:
    shapes = read(source)
    every = [r for rings in shapes.values() for r in rings]
    xs = [p[0] for r in every for p in r]
    ys = [p[1] for r in every for p in r]
    height = round((WIDTH - 2 * PAD) * (max(ys) - min(ys)) / (max(xs) - min(xs)) + 2 * PAD)
    main = fit(every, (0, 0, WIDTH, height), PAD)
    east = {code: shapes[code] for code in MARITIMES}
    inset = fit([r for rings in east.values() for r in rings], INSET, INSET_PAD)
    paths = draw(shapes, main, "main")
    inset_paths = draw(east, inset, "inset")
    # Where the inset's provinces lie on the main map, framed with a margin.
    ex = [main(*p)[0] for rings in east.values() for r in rings for p in r]
    ey = [main(*p)[1] for rings in east.values() for r in rings for p in r]
    m = 4
    extent = (round(min(ex) - m), round(min(ey) - m), round(max(ex) - min(ex) + 2 * m), round(max(ey) - min(ey) + 2 * m))
    labels = {**{c: (*xy, False) for c, xy in label_points(MAIN_LABELS, main).items()},
              **{c: (*xy, True) for c, xy in label_points(INSET_LABELS, inset).items()}}

    def obj(d: dict[str, str]) -> str:
        return "{\n" + "".join(f"  {k}: {json.dumps(v)},\n" for k, v in d.items()) + "}"

    label_lines = "".join(f"  {c}: {{ x: {x}, y: {y}, inset: {str(i).lower()} }},\n" for c, (x, y, i) in sorted(labels.items()))
    x, y, w, h = INSET
    return (
        "// Generated by scripts/make-canada-map.py from Statistics Canada's 2021 Census\n"
        "// cartographic boundary file for provinces and territories (Statistics Canada\n"
        "// Open Licence), drawn in the Lambert conformal conic of EPSG:3347 and\n"
        "// simplified for the home page's map. Do not edit by hand: run the script.\n\n"
        'import type { PROVINCES } from "./constants";\n\n'
        "type Province = (typeof PROVINCES)[number];\n"
        'export type MaritimeProvince = "NB" | "NS" | "PE";\n\n'
        f"export const MAP_WIDTH = {WIDTH};\n"
        f"export const MAP_HEIGHT = {height};\n\n"
        "// Each province and territory on the main map.\n"
        f"export const MAP_PATHS: Readonly<Record<Province, string>> = {obj(paths)};\n\n"
        "// The inset: the three Maritime provinces enlarged, in its frame (x, y, w, h).\n"
        f"export const INSET_FRAME = {{ x: {x}, y: {y}, w: {w}, h: {h} }} as const;\n"
        f"export const INSET_PATHS: Readonly<Record<MaritimeProvince, string>> = {obj(inset_paths)};\n\n"
        + borders_block(paths, inset_paths)
        + BORDERS_BEFORE
        + f"export const INSET_EXTENT = {{ x: {extent[0]}, y: {extent[1]}, w: {extent[2]}, h: {extent[3]} }} as const;\n\n"
        "// Each province's label point: on the main map, or in the inset for the Maritimes.\n"
        f"export const MAP_LABELS: Readonly<Record<Province, {{ x: number; y: number; inset: boolean }}>> = {{\n{label_lines}}};\n"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--from", dest="source", help="the boundary file, JSON rings in longitude and latitude")
    parser.add_argument("--borders", action="store_true", help="work the borders again from the outlines already in the output file")
    parser.add_argument("--out", default=str(OUT))
    args = parser.parse_args(argv)
    if args.borders == bool(args.source):
        parser.error("give --from <boundaries.json> or --borders, one of them")
    sys.setrecursionlimit(max(sys.getrecursionlimit(), 20000))  # Douglas-Peucker recurses per split
    text = reborder(Path(args.out)) if args.borders else build(Path(args.source))
    Path(args.out).write_text(text, encoding="utf-8", newline="\n")
    print(f"wrote {len(text) // 1024} KB to {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
