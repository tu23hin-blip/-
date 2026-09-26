#!/usr/bin/env python3
"""X（旧Twitter）の重み付き文字数を数える（twitter-text v3 準拠の簡易版）。

数え方
  - 次のコードポイントは重み1、それ以外（日本語・全角・絵文字など）は重み2
      0x0000-0x10FF / 0x2000-0x200D / 0x2010-0x201F / 0x2032-0x2037
  - URL（http:// または https:// で始まる文字列）は長さに関係なく23
  - 改行は1
  - 上限は280（全角140字）

使い方
  python3 scripts/count_chars.py "本文"                  本文を1つ検査（複数渡すとそれぞれ検査）
  python3 scripts/count_chars.py -f ファイル              --- だけの行で区切った各ブロックを一括検査
  python3 scripts/count_chars.py --md ファイル.md [...]   .md 内の ```text / ```profile コードブロックを一括検査
  python3 scripts/count_chars.py -                        標準入力の本文を検査
  python3 scripts/count_chars.py --selftest               動作確認（あ×140 / あ×141 / URL入り）

オプション
  --limit N   上限を変える（既定 280）
  --plain     重み付けせず、1文字=1で数える（プロフィール文の160字チェック用）

終了コード：すべて OK なら 0、NG が1つでもあれば 1、使い方の誤りは 2
"""

import re
import sys

LIMIT = 280
URL_WEIGHT = 23
PROFILE_LIMIT = 160

# 重み1のコードポイント範囲（それ以外は重み2）
WEIGHT1_RANGES = (
    (0x0000, 0x10FF),
    (0x2000, 0x200D),
    (0x2010, 0x201F),
    (0x2032, 0x2037),
)

URL_RE = re.compile(r"https?://[\x21-\x7E]+")
URL_TRAILING_PUNCT = ".,!?:;)]}'\""

# コードブロックの見出しから拾う ID（例：buzz-01、mention-03、article-p1）
ID_RE = re.compile(r"\b(buzz|post|quote|reply|mention|like|article|monetize)-[0-9A-Za-z]+\b")


def char_weight(ch):
    cp = ord(ch)
    for lo, hi in WEIGHT1_RANGES:
        if lo <= cp <= hi:
            return 1
    return 2


def _split_urls(text):
    """本文を [(文字列, URLかどうか)] に分ける。URL末尾の句読点はURLに含めない。"""
    parts = []
    pos = 0
    for m in URL_RE.finditer(text):
        url = m.group(0)
        tail = ""
        while url and url[-1] in URL_TRAILING_PUNCT:
            tail = url[-1] + tail
            url = url[:-1]
        if m.start() > pos:
            parts.append((text[pos:m.start()], False))
        if url in ("http://", "https://", ""):
            parts.append((m.group(0), False))
        else:
            parts.append((url, True))
            if tail:
                parts.append((tail, False))
        pos = m.end()
    if pos < len(text):
        parts.append((text[pos:], False))
    return parts


def weighted_length(text):
    """X の重み付き文字数を返す。改行（\\r\\n も）は1として数える。"""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    total = 0
    for chunk, is_url in _split_urls(text):
        if is_url:
            total += URL_WEIGHT
        else:
            total += sum(char_weight(ch) for ch in chunk)
    return total


def plain_length(text):
    """重み付けしない文字数（1文字=1、改行も1）。"""
    return len(text.replace("\r\n", "\n").replace("\r", "\n"))


def format_zenkaku(n):
    half = n / 2
    return str(int(half)) if n % 2 == 0 else f"{half:.1f}"


def format_result(n, limit=LIMIT, plain=False):
    ok = n <= limit
    if plain:
        return f"文字数: {n} / {limit} {'OK' if ok else 'NG'}", ok
    return f"重み付き: {n} / {limit}（全角換算: {format_zenkaku(n)} 字）{'OK' if ok else 'NG'}", ok


def measure(text, limit=LIMIT, plain=False):
    n = plain_length(text) if plain else weighted_length(text)
    line, ok = format_result(n, limit, plain)
    return n, line, ok


def split_blocks(content):
    """--- だけの行で区切られたブロックに分ける（前後の空行は除く）。"""
    content = content.replace("\r\n", "\n").replace("\r", "\n")
    blocks, cur = [], []
    for line in content.split("\n"):
        if line.strip() == "---":
            blocks.append("\n".join(cur))
            cur = []
        else:
            cur.append(line)
    blocks.append("\n".join(cur))
    return [b.strip("\n") for b in blocks if b.strip()]


def normalize_block(lines):
    """コードブロックの中身を投稿本文として整える（前後の空行と行末の空白を除く）。"""
    lines = [ln.rstrip() for ln in lines]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    return "\n".join(lines)


def extract_md_blocks(content):
    """Markdown から ```text と ```profile のコードブロックを取り出す。

    返り値：[{"kind": "text"|"profile", "text": 本文, "line": 開始行番号, "label": 見出し, "id": ID}]
    """
    content = content.replace("\r\n", "\n").replace("\r", "\n")
    lines = content.split("\n")
    results = []
    label = ""
    last_id = ""
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        fence = re.match(r"^(`{3,}|~{3,})\s*([A-Za-z0-9_-]*)\s*$", stripped)
        if fence:
            marker, info = fence.group(1), fence.group(2).lower()
            j = i + 1
            body = []
            while j < len(lines) and not lines[j].strip().startswith(marker[0] * len(marker)):
                body.append(lines[j])
                j += 1
            if info in ("text", "profile"):
                results.append({
                    "kind": info,
                    "text": normalize_block(body),
                    "line": i + 1,
                    "label": label,
                    "id": last_id,
                })
            i = j + 1
            continue
        if stripped.startswith("#"):
            label = stripped.lstrip("#").strip()
            m = ID_RE.search(stripped)
            last_id = m.group(0) if m else ""
        else:
            m = ID_RE.search(stripped)
            if m and stripped.startswith(("-", "*", "|")):
                last_id = m.group(0)
                if not label or not ID_RE.search(label):
                    label = stripped.lstrip("-*| ").strip()
        i += 1
    return results


def run_md(paths, limit, plain_override):
    any_ng = False
    for path in paths:
        try:
            with open(path, encoding="utf-8") as fh:
                content = fh.read()
        except OSError as exc:
            print(f"エラー: {path} を読めません（{exc}）")
            any_ng = True
            continue
        blocks = extract_md_blocks(content)
        print(f"■ {path}（コードブロック {len(blocks)} 件）")
        if not blocks:
            print("  本文のコードブロック（```text）が見つかりません")
            continue
        for b in blocks:
            is_profile = b["kind"] == "profile"
            use_plain = plain_override or is_profile
            use_limit = limit if limit is not None else (PROFILE_LIMIT if is_profile else LIMIT)
            _, line, ok = measure(b["text"], use_limit, use_plain)
            any_ng = any_ng or not ok
            name = b["label"] or "(見出しなし)"
            kind = "プロフィール文 " if is_profile else ""
            first = b["text"].split("\n", 1)[0][:24]
            print(f"  {path}:{b['line']} [{name}] {kind}{line}  「{first}…」")
    return any_ng


def selftest():
    cases = [
        ("「あ」×140", "あ" * 140, 280, True),
        ("「あ」×141", "あ" * 141, 282, False),
        ("URL入り（あ×100＋改行＋長いURL）",
         "あ" * 100 + "\nhttps://example.com/" + "a" * 80, 200 + 1 + 23, True),
        ("英数字280字", "a" * 280, 280, True),
        ("改行2つ＋あ×139", "あ" * 139 + "\n\n", 280, True),
    ]
    all_pass = True
    for name, text, expected, expected_ok in cases:
        n, line, ok = measure(text)
        passed = n == expected and ok == expected_ok
        all_pass = all_pass and passed
        print(f"{'✅' if passed else '❌'} {name}: {line}（期待値 {expected}）")
    print("すべて期待どおり" if all_pass else "期待と違う結果があります")
    return 0 if all_pass else 1


def main(argv):
    args = list(argv)
    limit = None
    plain = False
    if "--selftest" in args:
        return selftest()
    if "--plain" in args:
        plain = True
        args.remove("--plain")
    if "--limit" in args:
        idx = args.index("--limit")
        try:
            limit = int(args[idx + 1])
        except (IndexError, ValueError):
            print("--limit には数字を指定してください")
            return 2
        del args[idx:idx + 2]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        return 2 if not args else 0

    base_limit = limit if limit is not None else LIMIT

    if args[0] == "--md":
        if len(args) < 2:
            print("--md の後にファイル名を指定してください")
            return 2
        return 1 if run_md(args[1:], limit, plain) else 0

    if args[0] == "-f":
        if len(args) < 2:
            print("-f の後にファイル名を指定してください")
            return 2
        any_ng = False
        for path in args[1:]:
            try:
                with open(path, encoding="utf-8") as fh:
                    blocks = split_blocks(fh.read())
            except OSError as exc:
                print(f"エラー: {path} を読めません（{exc}）")
                any_ng = True
                continue
            print(f"■ {path}（{len(blocks)} ブロック）")
            for i, block in enumerate(blocks, 1):
                _, line, ok = measure(block, base_limit, plain)
                any_ng = any_ng or not ok
                first = block.split("\n", 1)[0][:24]
                print(f"  [{i}] {line}  「{first}…」")
        return 1 if any_ng else 0

    if args[0] == "-":
        texts = [sys.stdin.read().strip("\n")]
    else:
        texts = args

    any_ng = False
    for i, text in enumerate(texts, 1):
        _, line, ok = measure(text, base_limit, plain)
        any_ng = any_ng or not ok
        print(line if len(texts) == 1 else f"[{i}] {line}")
    return 1 if any_ng else 0


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    try:
        sys.exit(main(sys.argv[1:]))
    except BrokenPipeError:
        # 出力の途中でパイプが閉じられた（| head など）。ファイルの書き込みは終わっているので静かに終わる
        try:
            sys.stdout.close()
        except Exception:
            pass
        sys.exit(0)
