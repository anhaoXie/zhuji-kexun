# -*- coding: utf-8 -*-
"""把 4 张手机截图合成设计说明用“图9 手机端界面”插图（2200px 宽，11.8cm 打印约 470dpi）。"""
import os, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = r"."
SHOTS = os.path.join(ROOT, "shots")
OUT = os.path.join(ROOT, "figures")
os.makedirs(OUT, exist_ok=True)

ITEMS = [
    ("monitor", "① 实时监控", "状态 / 航线 / 进度"),
    ("control", "② 远程控制", "摇杆 / 限速 / 急停"),
    ("video", "③ 图传监看", "低码率 / 检测框"),
    ("report", "④ 批次报表", "六状态 / 复核 / 导出"),
]

FONT_DIR = r"C:\Windows\Fonts"
def font(name, size):
    for n in (name, "msyhbd.ttc", "msyh.ttc", "simhei.ttf"):
        p = os.path.join(FONT_DIR, n)
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()

def rounded_mask(size, radius):
    m = Image.new("L", size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255)
    return m

def phone(img, w, h):
    """返回带白色机身、细边、圆角与阴影的手机图。"""
    screen = img.convert("RGB").resize((w, h), Image.LANCZOS)
    pad = 14
    W, H = w + pad * 2, h + pad * 2
    canvas = Image.new("RGBA", (W + 40, H + 40), (0, 0, 0, 0))
    # 阴影
    shadow = Image.new("RGBA", (W + 40, H + 40), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle((30, 34, 30 + W, 34 + H), radius=54, fill=(15, 25, 20, 70))
    shadow = shadow.filter(ImageFilter.GaussianBlur(14))
    canvas.alpha_composite(shadow)
    d = ImageDraw.Draw(canvas)
    # 白色机身
    d.rounded_rectangle((20, 20, 20 + W, 20 + H), radius=52, fill=(255, 255, 255, 255), outline=(216, 220, 226, 255), width=2)
    # 屏幕
    scr = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    scr.paste(screen, (pad, pad))
    scr.putalpha(rounded_mask((W, H), 40))
    canvas.alpha_composite(scr, (20, 20))
    # 顶部听筒/摄像头小条（仅在页面顶部留白处，轻量暗示真机）
    return canvas.crop((0, 0, W + 40, H + 40))

def main():
    W_PHONE = 440
    H_PHONE = int(round(W_PHONE * 2532 / 1170))
    gap = 66
    margin_x = (2200 - (W_PHONE + 40) * 4 - gap * 3) // 2
    canvas_w, canvas_h = 2200, 190 + (H_PHONE + 40) + 150
    canvas = Image.new("RGB", (canvas_w, canvas_h), (255, 255, 255))
    d = ImageDraw.Draw(canvas)

    f_title = font("msyhbd.ttc", 54)
    f_sub = font("msyh.ttc", 28)
    f_lab = font("msyhbd.ttc", 30)
    f_lab2 = font("msyh.ttc", 23)
    f_num = font("msyhbd.ttc", 26)

    d.text((margin_x, 44), "手机端（微信小程序）界面", font=f_title, fill=(22, 22, 22))
    d.text((margin_x, 116), "演示棚 1 号棚 · 批次 B-20261104-01 · 2026-11 联调版；识别在车端 K230 完成，图传默认关闭，仅演示/远程接管",
           font=f_sub, fill=(102, 102, 102))

    y = 190
    for i, (key, lab, sub) in enumerate(ITEMS):
        p = os.path.join(SHOTS, key + ".png")
        if not os.path.exists(p):
            raise SystemExit("missing shot: " + p)
        img = Image.open(p)
        ph = phone(img, W_PHONE, H_PHONE)
        x = margin_x + i * ((W_PHONE + 40) + gap) - 20
        canvas.paste(ph, (x, y), ph)
        # 编号徽标
        bx, by = x + 28, y + 8
        d.ellipse((bx, by, bx + 40, by + 40), fill=(7, 193, 96))
        d.text((bx + 20, by + 20), str(i + 1), font=f_num, fill=(255, 255, 255), anchor="mm")
        # 标签
        cx = x + (W_PHONE + 40) // 2
        d.text((cx, y + H_PHONE + 58), lab, font=f_lab, fill=(24, 24, 24), anchor="mm")
        d.text((cx, y + H_PHONE + 100), sub, font=f_lab2, fill=(110, 110, 110), anchor="mm")

    out = os.path.join(OUT, "fig9_app.png")
    canvas.save(out, "PNG")
    print("saved", out, canvas.size)

if __name__ == "__main__":
    main()
