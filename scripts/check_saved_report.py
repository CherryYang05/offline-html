#!/usr/bin/env python3
"""只读核对通用模板的保存产物；不代替原文件授权与实际写回测试。"""

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
    marker = "把一份文档，变成可讲、可改、可讨论的汇报。"
    expected = "请保留这句结论。示例内容可以替换成自己的项目。"
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
    if sorted(kinds) != ["columns", "details"]:
        raise ValueError("双栏和折叠组件数量不对，可能丢失或重复")
    for text in ("内容原位编辑", "讨论就在正文旁", "使用提示"):
        if text not in source:
            raise ValueError("双栏内容未保留")
    images = [a for t, a in report.tags if t == "img" and "data-rsi-src" in a]
    gif_bytes = 0
    for image in images:
        if not image["data-rsi-src"].startswith("data:image/gif;base64,"):
            raise ValueError("GIF 未内嵌")
        gif = base64.b64decode(image["data-rsi-src"].split(",", 1)[1], validate=True)
        if gif[:6] not in (b"GIF89a", b"GIF87a") or gif[-1:] != b";":
            raise ValueError("GIF 数据损坏")
        gif_bytes += len(gif)
    if any(a.get("id") == "review-panel" or "contenteditable" in a for _, a in report.tags):
        raise ValueError("保存文件残留运行时编辑界面")
    return {"passed": True, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
            "threads": len(threads), "components": kinds, "gif_bytes": gif_bytes}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("html", type=Path, help="主模板 offline-report.html 或按回归记录操作生成的测试副本")
    args = parser.parse_args()
    try:
        print(json.dumps(check(args.html), ensure_ascii=False, indent=2))
    except (ValueError, KeyError, OSError) as error:
        parser.exit(1, f"核对失败：{error}\n")
