from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "desktop"
SIZE = 1024


def rounded_book(width: int, height: int, color: str, accent: str) -> Image.Image:
    layer = Image.new("RGBA", (width + 80, height + 80), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    box = (40, 40, 40 + width, 40 + height)
    draw.rounded_rectangle(box, radius=34, fill=color, outline=accent, width=8)
    draw.rounded_rectangle((66, 68, 86, 40 + height - 28), radius=10, fill=accent)
    draw.rounded_rectangle((106, 78, 40 + width - 26, 98), radius=10, fill=(255, 255, 255, 46))
    draw.rounded_rectangle((106, 40 + height - 70, 40 + width - 26, 40 + height - 50), radius=10, fill=(0, 0, 0, 50))
    return layer


canvas = Image.new("RGBA", (SIZE, SIZE), "#0d0d11")

glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
glow_draw = ImageDraw.Draw(glow)
glow_draw.ellipse((160, 120, 864, 824), fill=(125, 83, 202, 92))
glow = glow.filter(ImageFilter.GaussianBlur(120))
canvas.alpha_composite(glow)

draw = ImageDraw.Draw(canvas)
draw.rounded_rectangle((36, 36, SIZE - 36, SIZE - 36), radius=214, fill="#15151b", outline="#36313e", width=10)
draw.rounded_rectangle((80, 80, SIZE - 80, SIZE - 80), radius=176, outline=(255, 255, 255, 16), width=4)

books = [
    (rounded_book(170, 500, "#6f4cb6", "#a98bea"), (235, 285), -7),
    (rounded_book(170, 590, "#a85b3d", "#e6a170"), (420, 210), 0),
    (rounded_book(170, 530, "#5f459d", "#9b7bd7"), (605, 260), 7),
]

for book, position, angle in books:
    rotated = book.rotate(angle, resample=Image.Resampling.BICUBIC, expand=True)
    x = position[0] - (rotated.width - book.width) // 2
    y = position[1] - (rotated.height - book.height) // 2
    canvas.alpha_composite(rotated, (x, y))

draw = ImageDraw.Draw(canvas)
draw.rounded_rectangle((190, 800, 834, 850), radius=25, fill="#a96a45")
draw.rounded_rectangle((228, 810, 796, 826), radius=8, fill=(255, 255, 255, 48))

png_path = OUT / "icon.png"
ico_path = OUT / "icon.ico"
canvas.save(png_path, "PNG", optimize=True)
canvas.save(ico_path, "ICO", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(png_path)
print(ico_path)
