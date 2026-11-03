"""Renders brand/wordmark.svg as the two PNGs the sign-in message shows.

Mail clients strip SVG, so the message's header carries the wordmark as hosted
PNGs at 2x its 142 by 20 CSS pixels:

  site/public/brand/wordmark.png       ink #0f172a on a baked white ground, so a
                                       client that darkens the page on its own
                                       and leaves images alone still shows a
                                       white tab rather than dark ink on dark
  site/public/brand/wordmark-dark.png  light ink #e5edf7 on a transparent
                                       ground, swapped in by the clients that
                                       honour the message's dark-mode query

The check keeps the fill wordmark.svg gives it; only currentColor changes.
Chrome headless draws the SVG, so the script needs no Python imaging package;
each file's size and ground are then checked from its own bytes (the IHDR
chunk and the first pixel).

Run:  python brand/make_wordmark_png.py
Needs Google Chrome; set CHROME to its executable if it is not installed in
the default place.
"""
import os
import pathlib
import struct
import subprocess
import sys
import tempfile
import zlib

HERE = pathlib.Path(__file__).resolve().parent
OUT = HERE.parent / "site" / "public" / "brand"
SVG = (HERE / "wordmark.svg").read_text(encoding="utf-8")
CHROME = os.environ.get("CHROME") or "C:/Program Files/Google/Chrome/Application/chrome.exe"
WIDTH, HEIGHT = 284, 40

# (file, ink, page background, Chrome's default background or None)
VARIANTS = [
    ("wordmark.png", "#0f172a", "#ffffff", None),
    ("wordmark-dark.png", "#e5edf7", "transparent", "00000000"),
]

PAGE = """<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>html,body{{margin:0;padding:0;overflow:hidden;background:{background};}}svg{{display:block;}}</style>
</head><body>{svg}</body></html>
"""


def page(ink: str, background: str) -> str:
    svg = SVG.replace('width="241" height="34"', f'width="{WIDTH}" height="{HEIGHT}"', 1)
    if f'width="{WIDTH}"' not in svg:
        raise SystemExit("wordmark.svg no longer starts at 241 by 34; update this script's size swap")
    return PAGE.format(background=background, svg=svg.replace("currentColor", ink))


def render(html: str, out: pathlib.Path, transparent: str | None, work: pathlib.Path) -> None:
    source = work / f"{out.stem}.html"
    source.write_text(html, encoding="utf-8")
    args = [
        CHROME, "--headless=new", f"--screenshot={out}", f"--window-size={WIDTH},{HEIGHT}",
        "--force-device-scale-factor=1", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
        # A profile of its own, so a running Chrome is neither reused nor touched.
        f"--user-data-dir={work / 'profile'}",
    ]
    if transparent is not None:
        args.append(f"--default-background-color={transparent}")
    args.append(source.as_uri())
    subprocess.run(args, check=True, capture_output=True, timeout=120)


def check(path: pathlib.Path, transparent: bool) -> str:
    """Raises unless the PNG is WIDTH by HEIGHT with the expected ground; returns a summary line."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise SystemExit(f"{path.name}: not a PNG")
    width, height, depth, colour, _, _, interlace = struct.unpack(">IIBBBBB", data[16:29])
    if (width, height) != (WIDTH, HEIGHT):
        raise SystemExit(f"{path.name}: {width} by {height} pixels, expected {WIDTH} by {HEIGHT}")
    if depth != 8 or colour not in (2, 6) or interlace:
        raise SystemExit(f"{path.name}: bit depth {depth}, colour type {colour}, interlace {interlace}; expected 8-bit RGB(A)")
    # The first pixel of the first row is stored unchanged by every PNG
    # filter (its left and upper neighbours count as zero), so it can be
    # read without undoing the filters.
    idat, at = b"", 8
    while at < len(data):
        length, kind = struct.unpack(">I4s", data[at:at + 8])
        if kind == b"IDAT":
            idat += data[at + 8:at + 8 + length]
        at += 12 + length
    channels = 4 if colour == 6 else 3
    first = tuple(zlib.decompress(idat)[1:1 + channels])
    if transparent and (colour != 6 or first[3] != 0):
        raise SystemExit(f"{path.name}: the corner is {first}, expected a transparent ground")
    if not transparent and (first[:3] != (255, 255, 255) or (colour == 6 and first[3] != 255)):
        raise SystemExit(f"{path.name}: the corner is {first}, expected opaque white")
    return f"{path.name}: {width} by {height} pixels, {len(data):,} bytes"


def main() -> None:
    if not pathlib.Path(CHROME).is_file():
        sys.exit(f"Chrome not found at {CHROME}; set CHROME to its executable")
    OUT.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        work = pathlib.Path(tmp)
        for name, ink, background, transparent in VARIANTS:
            out = OUT / name
            render(page(ink, background), out, transparent, work)
            print(check(out, transparent is not None))


if __name__ == "__main__":
    main()
