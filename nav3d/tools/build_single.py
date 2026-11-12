# -*- coding: utf-8 -*-
"""
把 _dev.html 里外链的 three.js 和楼层数据内联进去，生成 index.html。

为什么要这么做：
    _dev.html 里写的是 <script src="../js/vendor/three.min.js">，
    路径跑到了 nav3d 目录外面。用浏览器双击打开没问题，
    但预览面板 / 单独分享 / 只拷一个文件给别人时，这一步跳不出去，
    三维库就加载不到，画布只剩背景色。

用法：
    python tools/build_single.py
    改完 _dev.html 或 data/floor-3f.js 之后重跑一次即可。
"""
import io
import os

HERE = os.path.dirname(os.path.abspath(__file__))
NAV = os.path.dirname(HERE)
ROOT = os.path.dirname(NAV)

SRC = os.path.join(NAV, "_dev.html")
THREE = os.path.join(ROOT, "js", "vendor", "three.min.js")
DATA = os.path.join(NAV, "data", "floor-3f.js")
DATA2 = os.path.join(NAV, "data", "floor-2f.js")
DATA4 = os.path.join(NAV, "data", "floor-4f.js")
DATA5 = os.path.join(NAV, "data", "floor-5f.js")
DATA1 = os.path.join(NAV, "data", "floor-1f.js")
OUT = os.path.join(NAV, "index.html")

THREE_TAG = '<script src="../js/vendor/three.min.js"></script>'
DATA_TAG = '<script src="data/floor-3f.js"></script>'
DATA2_TAG = '<script src="data/floor-2f.js"></script>'
DATA4_TAG = '<script src="data/floor-4f.js"></script>'
DATA5_TAG = '<script src="data/floor-5f.js"></script>'
DATA1_TAG = '<script src="data/floor-1f.js"></script>'


def read(p):
    # utf-8-sig：顺手吃掉可能存在的 BOM，避免它跑到 <script> 开头
    return io.open(p, encoding="utf-8-sig").read()


def safe(s):
    # 防止库或数据里出现 </script> 把标签提前闭合
    return s.replace("</script>", "<\\/script>")


def main():
    for p in (SRC, THREE, DATA, DATA2, DATA4, DATA5, DATA1):
        if not os.path.isfile(p):
            raise SystemExit("找不到文件：" + p)

    html = read(SRC)
    for tag in (THREE_TAG, DATA_TAG, DATA2_TAG, DATA4_TAG, DATA5_TAG, DATA1_TAG):
        if tag not in html:
            raise SystemExit("_dev.html 里的外链标签被改过了，检查一下：" + tag)

    html = html.replace(
        THREE_TAG,
        "<script>\n/* three.js r128（内联副本，来源 js/vendor/three.min.js） */\n"
        + safe(read(THREE)) + "\n</script>"
    )
    html = html.replace(
        DATA_TAG,
        "<script>\n/* 楼层数据（内联副本，来源 data/floor-3f.js） */\n"
        + safe(read(DATA)) + "\n</script>"
    )

    html = html.replace(
        DATA2_TAG,
        "<script>\n/* 2 层数据（内联副本，来源 data/floor-2f.js） */\n"
        + safe(read(DATA2)) + "\n</script>"
    )
    html = html.replace(
        DATA4_TAG,
        "<script>\n/* 4 层数据（内联副本，来源 data/floor-4f.js） */\n"
        + safe(read(DATA4)) + "\n</script>"
    )
    html = html.replace(
        DATA5_TAG,
        "<script>\n/* 5 层数据（内联副本，来源 data/floor-5f.js） */\n"
        + safe(read(DATA5)) + "\n</script>"
    )
    html = html.replace(
        DATA1_TAG,
        "<script>\n/* 1 层数据（内联副本，来源 data/floor-1f.js） */\n"
        + safe(read(DATA1)) + "\n</script>"
    )

    io.open(OUT, "w", encoding="utf-8").write(html)
    print("wrote %s  (%.1f KB)" % (OUT, os.path.getsize(OUT) / 1024.0))


if __name__ == "__main__":
    main()
