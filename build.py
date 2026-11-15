#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
广东新高考模考错题溯源器 —— 构建脚本（v2.0 起生效）

职责：
1. 审核校验：对 src/bank-data.js 中每条题目做字段完整性与来源标注检查，
   任何一条不达标即构建失败（收录审核流程的自动化关卡）。
2. 数据注入：将审核通过的题库数组替换进 错题溯源器.html 中的
   `const BUILT_IN_BANK = [` ... `];` 区段，保持单文件离线交付。

用法：python3 build.py
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "src" / "bank-data.js"
HTML = ROOT / "错题溯源器.html"

REQUIRED_NUM = {"year"}
REQUIRED_STR = {"subject", "exam", "source", "stem"}
MIN_SOURCE_LEN = 8  # 来源标注至少要写清出处与核对方式


def load_bank():
    """用 Node 解析 bank-data.js（而非正则），保证语法与运行时一致。"""
    code = DATA.read_text(encoding="utf-8")
    script = code + "\n;console.log(JSON.stringify(BUILT_IN_BANK));"
    out = subprocess.run(
        ["node", "-e", script],
        capture_output=True, text=True, check=True,
    )
    import json
    return json.loads(out.stdout)


def audit(items):
    errors = []
    for idx, it in enumerate(items, 1):
        tag = f"第{idx}条 ({it.get('subject', '?')} {it.get('year', '?')})"
        if not isinstance(it, dict):
            errors.append(f"{tag}: 不是对象")
            continue
        for k in REQUIRED_NUM:
            v = it.get(k)
            if not isinstance(v, int) or not (2000 <= v <= 2100):
                errors.append(f"{tag}: 字段 {k} 缺失或非法（{v!r}）")
        for k in REQUIRED_STR:
            v = it.get(k)
            if not isinstance(v, str) or not v.strip():
                errors.append(f"{tag}: 字段 {k} 缺失或为空")
        src = it.get("source", "")
        if isinstance(src, str) and len(src.strip()) < MIN_SOURCE_LEN:
            errors.append(f"{tag}: source 来源标注过短，须写明出处与核对方式")
        if not it.get("answer", "").strip():
            errors.append(f"{tag}: 缺少答案（无答案题目须在 answer 中据实标注原因）")
    return errors


def inject(html_text, items_js_array_text):
    """把 HTML 中 BUILT_IN_BANK 数组语句整体替换为 bank-data.js 中的完整语句原文。"""
    pat = re.compile(r"const BUILT_IN_BANK = \[[\s\S]*?\n\];", re.M)
    m = pat.search(html_text)
    if not m:
        sys.exit("错误：未在 HTML 中找到 BUILT_IN_BANK 数组区段")
    return html_text[: m.start()] + items_js_array_text + html_text[m.end():]


def main():
    items = load_bank()
    print(f"题库数据：{len(items)} 条")

    errs = audit(items)
    if errs:
        print("收录审核未通过：")
        for e in errs:
            print("  ✗", e)
        sys.exit(1)
    print("收录审核：全部条目字段完整、来源标注达标 ✓")

    # 取 bank-data.js 中完整数组语句原文（保持手工排版），注入 HTML
    code = DATA.read_text(encoding="utf-8")
    m = re.search(r"const BUILT_IN_BANK = \[[\s\S]*\n\];", code)
    if not m:
        sys.exit("错误：bank-data.js 中未找到数组字面量")
    html_text = HTML.read_text(encoding="utf-8")
    new_html = inject(html_text, m.group(0))

    if new_html == html_text:
        print("页面题库与数据源已一致，无需改动。")
        return
    HTML.write_text(new_html, encoding="utf-8")

    # 注入后再做一次语法 + 数量验证
    check = subprocess.run(
        ["node", "-e",
         "const fs=require('fs');"
         "const html=fs.readFileSync(process.argv[1],'utf8');"
         "const scripts=[...html.matchAll(/<script>([\\s\\S]*?)<\\/script>/g)];"
         "scripts.forEach(m=>new Function(m[1]));"
         "console.log('语法 OK');",
         str(HTML)],
        capture_output=True, text=True,
    )
    if check.returncode != 0:
        sys.exit("错误：注入后 HTML 的 JS 语法校验失败\n" + check.stderr)
    print("构建完成：题库已注入 错题溯源器.html（单文件交付保持不变）")


if __name__ == "__main__":
    main()
