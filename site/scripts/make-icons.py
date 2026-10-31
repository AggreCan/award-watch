"""Writes the site icons from the two tiles brand/make_mark.py draws.

brand/favicon-w.svg is the w and its check alone on a white rounded tile (the
whole mark does not read at 16 px): it becomes public/favicon.svg, copied
unchanged, and public/favicon.ico. brand/favicon.svg is the whole mark on the
same tile: it becomes public/apple-touch-icon.png and any icon of 64 px or
more. Each ICO size is rendered from the vector at its own pixel size rather
than resampled from one large image, so the small sizes stay sharp.

Run from the repository root or from site/:  python site/scripts/make-icons.py
Needs PySide6 (QtSvg) and Pillow.
Outputs: site/public/favicon.svg, favicon.ico (16, 32, 48) and apple-touch-icon.png (180).
"""

from io import BytesIO
from pathlib import Path

from PIL import Image
from PySide6.QtCore import QBuffer, QByteArray, QIODevice, QRectF, Qt
from PySide6.QtGui import QColor, QGuiApplication, QImage, QPainter
from PySide6.QtSvg import QSvgRenderer

SITE = Path(__file__).resolve().parent.parent
PUBLIC = SITE / "public"
BRAND = SITE.parent / "brand"
SMALL = BRAND / "favicon-w.svg"
LARGE = BRAND / "favicon.svg"


def render(svg: bytes, size: int, *, fill: QColor | None = None) -> Image.Image:
    """The SVG at size by size pixels; transparent outside the tile unless fill is given."""
    renderer = QSvgRenderer(QByteArray(svg))
    if not renderer.isValid():
        raise SystemExit("an icon source is not a valid SVG")
    image = QImage(size, size, QImage.Format.Format_ARGB32)
    image.fill(fill if fill is not None else QColor(0, 0, 0, 0))
    painter = QPainter(image)
    painter.setRenderHint(QPainter.RenderHint.Antialiasing)
    renderer.render(painter, QRectF(0, 0, size, size))
    painter.end()
    buffer = QBuffer()
    buffer.open(QIODevice.OpenModeFlag.WriteOnly)
    image.save(buffer, "PNG")
    return Image.open(BytesIO(bytes(buffer.data()))).convert("RGBA")


def main() -> None:
    # QtSvg paints through QPainter, which needs an application object, though
    # no window is shown.
    app = QGuiApplication.instance() or QGuiApplication(["make-icons", "-platform", "offscreen"])
    small = SMALL.read_bytes()
    (PUBLIC / "favicon.svg").write_bytes(small)
    sizes = [48, 32, 16]
    frames = [render(small, s) for s in sizes]
    frames[0].save(PUBLIC / "favicon.ico", sizes=[(s, s) for s in sizes], append_images=frames[1:])

    # iOS rounds the corners itself and composites over black, so the touch
    # icon is opaque: the tile on white, rendered large and resampled.
    touch = render(LARGE.read_bytes(), 360, fill=QColor(Qt.GlobalColor.white)).resize((180, 180), Image.Resampling.LANCZOS)
    touch.convert("RGB").save(PUBLIC / "apple-touch-icon.png", optimize=True)
    del app
    print("wrote favicon.svg, favicon.ico and apple-touch-icon.png to", PUBLIC)


if __name__ == "__main__":
    main()
