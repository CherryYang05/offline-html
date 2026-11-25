#!/usr/bin/env python3
"""只读核对 Chrome 手工回归产生的 HTML；不代替真实授权和关闭重开测试。"""

import argparse
import base64
import hashlib
import json
import re
from html.parser import HTMLParser
from pathlib import Path


class Report(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = []

    def handle_starttag(self, tag, attrs):
        self.tags.append((tag, dict(attrs)))


def check(path):
    raw = path.read_bytes()
    source = raw.decode("utf-8")
    report = Report()
    report.feed(source)
    match = re.search(
        r'<script\b[^>]*\bid="rsi-review-data"[^>]*>(.*?)</script>', source, re.S
    )
    if not match:
        raise ValueError("缺少内嵌批注 JSON")
    threads = json.loads(match.group(1))["threads"]
    marker = "完整 HTML 实测正文：2026-11-25，关闭重开后保留。"
    expected = "重开后再次编辑成功：<保留> & 正文、双栏与 GIF。"
    if marker not in source or len(threads) != 1:
        raise ValueError("正文标记或单条测试批注未保留")
    thread = threads[0]
    if thread["messages"][0]["text"] != expected or thread["intent"] != "keep":
        raise ValueError("批注文字或请保留意图未保留")
    blocks = {a["data-review-block"] for _, a in report.tags if "data-review-block" in a}
    anchor = thread["anchors"][0]
    if anchor["blockId"] not in blocks or anchor["quote"] != marker:
        raise ValueError("批注锚点没有对应到保存的正文块")
    kinds = [a["data-rsi-added"] for _, a in report.tags if "data-rsi-added" in a]
    if sorted(kinds) != ["columns", "image"]:
        raise ValueError("双栏和图片组件数量不对，可能丢失或重复")
    for text in ("左栏持久化：原始规则和证据。", "右栏持久化：修正后的预测与解释。"):
        if text not in source:
            raise ValueError("双栏内容未保留")
    images = [a for t, a in report.tags if t == "img" and "data-rsi-src" in a]
    if len(images) != 1 or not images[0]["data-rsi-src"].startswith("data:image/gif;base64,"):
        raise ValueError("GIF 未内嵌")
    gif = base64.b64decode(images[0]["data-rsi-src"].split(",", 1)[1], validate=True)
    if gif[:6] not in (b"GIF89a", b"GIF87a") or gif[-1:] != b";":
        raise ValueError("GIF 数据损坏")
    if any(a.get("id") == "review-panel" or "contenteditable" in a for _, a in report.tags):
        raise ValueError("保存文件残留运行时编辑界面")
    return {"passed": True, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
            "threads": len(threads), "components": kinds, "gif_bytes": len(gif)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("html", type=Path, help="按 docs/完整HTML回归.md 操作并写回的测试副本")
    args = parser.parse_args()
    try:
        print(json.dumps(check(args.html), ensure_ascii=False, indent=2))
    except (ValueError, KeyError, OSError) as error:
        parser.exit(1, f"核对失败：{error}\n")
