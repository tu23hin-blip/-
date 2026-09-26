#!/usr/bin/env python3
"""X運用ダッシュボード（dashboard/index.html）を作る。Python 標準ライブラリだけで動く。

使い方（x-marketing フォルダで実行）
  python3 scripts/build_dashboard.py                  ダッシュボードを作り直す
  python3 scripts/build_dashboard.py --check 日付      logs/日付/ の status.json・approval.json を検証する
  python3 scripts/build_dashboard.py --log ファイル    投稿を記録する（/x-log 用）。posted.md と posted.csv に追記して作り直す
  python3 scripts/build_dashboard.py --status         直近7日の投稿数・inbox/ の更新日・足りないデータを表示する
  python3 scripts/build_dashboard.py --today          今日の日付（JST）を表示する

読むもの：logs/*/status.json・approval.json・*.md、data/*.csv、knowledge/learnings.md・profile.md、inbox/ の更新日時
書くもの：dashboard/index.html（--log のときは inbox/posted.md と data/posted.csv にも追記）
"""

import csv
import datetime as dt
import difflib
import html
import io
import json
import os
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
ROOT = SCRIPT_DIR.parent
sys.path.insert(0, str(SCRIPT_DIR))
import count_chars  # noqa: E402

JST = dt.timezone(dt.timedelta(hours=9))
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")

TEAMS = [
    "buzz-director", "researcher", "buzz-writer", "post-writer", "quote-poster", "reply-worker",
    "like-worker", "article-writer", "monetize", "analyst", "checker",
]
TEAM_LABELS = {
    "buzz-director": "統括", "researcher": "リサーチ", "buzz-writer": "勝負ポスト",
    "post-writer": "通常ポスト", "quote-poster": "引用ポスト", "reply-worker": "リプライ",
    "like-worker": "いいね回り", "article-writer": "記事・スレッド", "monetize": "マネタイズ（導線）",
    "analyst": "分析", "checker": "品質チェック",
}
TEAM_FILES = {
    "buzz-director": "director-report.md", "researcher": "research.md", "buzz-writer": "buzz-posts.md",
    "post-writer": "posts.md", "quote-poster": "quotes.md", "reply-worker": "replies.md",
    "like-worker": "likes.md", "article-writer": "article.md", "monetize": "monetize.md",
    "analyst": "weekly-review.md", "checker": "checks.md",
}
STATUS_VALUES = ["done", "returned", "ng", "skipped", "missing"]
KINDS = ["buzz", "post", "quote", "reply", "mention-reply", "like", "article", "monetize"]
KIND_LABELS = {
    "buzz": "勝負ポスト", "post": "通常ポスト", "quote": "引用", "reply": "リプ",
    "mention-reply": "返信", "like": "いいね", "article": "記事・スレッド", "monetize": "導線",
}
KIND_FILES = {
    "buzz": "buzz-posts.md", "post": "posts.md", "quote": "quotes.md", "reply": "replies.md",
    "mention-reply": "replies.md", "article": "article.md", "monetize": "monetize.md", "like": "likes.md",
}
CHECKS = ["OK", "要修正", "NG"]
APPROVAL_KEYS = ["id", "kind", "time", "type", "text", "target", "target_url", "chars", "check",
                 "rank", "recommended", "reason"]
METRICS_COLS = ["date", "followers", "impressions", "likes", "reposts", "replies", "bookmarks",
                "profile_clicks", "line_signups"]
POSTED_COLS = ["posted_at", "kind", "type", "text", "url", "approval_id"]
PERF_COLS = ["url", "posted_at", "kind", "type", "time_slot", "impressions", "likes", "reposts",
             "replies", "bookmarks", "profile_clicks", "engagement_rate"]
TIME_SLOTS = ["朝", "昼", "夕方", "夜", "深夜"]
# (ファイル名, 何日で古いとみなすか（None=判定しない）, 説明)
INBOX_FILES = [
    ("instructions.md", None, "今日の指示（空でもOK）"),
    ("buzz-posts.md", 1, "参考にしたいバズ投稿"),
    ("accounts.md", 1, "交流候補アカウント"),
    ("mentions.md", None, "自分の投稿に来たリプ・引用"),
    ("posted.md", None, "投稿した記録（/x-log が追記）"),
    ("stats/", 8, "Xアナリティクスの数字"),
]
# フォロワー増加モードで出てはいけない言葉（checker の検査項目6と同じ考え方。ここでは警告だけ）
SALES_WORDS_RE = re.compile(r"LINE|ＬＩＮＥ|公式ライン|無料プレゼント|特典|商品|販売|購入|有料|講座")
X_STATUS_URL_RE = re.compile(r"https?://(?:www\.|mobile\.)?(?:x|twitter)\.com/[A-Za-z0-9_]+/status/\d+[^\s]*")


# ---------------------------------------------------------------- 基本の読み書き

def now_jst():
    return dt.datetime.now(JST)


def read_text(path):
    """テキストを読む（UTF-8 / BOM付き / Excel の Shift_JIS に対応）。読めなければ None。"""
    path = Path(path)
    if not path.is_file():
        return None
    data = path.read_bytes()
    for enc in ("utf-8-sig", "cp932"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def load_json(path):
    """(データ, エラー文, ファイルがあるか) を返す。"""
    path = Path(path)
    if not path.is_file():
        return None, None, False
    text = read_text(path)
    try:
        return json.loads(text), None, True
    except json.JSONDecodeError as exc:
        return None, f"{exc.lineno} 行目 {exc.colno} 文字目：{exc.msg}", True


def read_csv(path, columns):
    """(行のリスト, エラー文) を返す。ファイルがなければ ([], None)。"""
    text = read_text(path)
    if text is None:
        return [], None
    try:
        reader = csv.DictReader(io.StringIO(text))
        header = [h.strip() for h in (reader.fieldnames or [])]
        reader.fieldnames = header
        rows = [r for r in reader if any((v or "").strip() for v in r.values() if isinstance(v, str))]
    except csv.Error as exc:
        return [], f"{Path(path).name} を読めません（{exc}）"
    missing = [c for c in columns if c not in header]
    err = f"{Path(path).name} の見出しに {', '.join(missing)} がありません" if missing and header else None
    return rows, err


def to_num(value):
    if value is None:
        return None
    s = str(value).strip().replace(",", "").replace("，", "")
    if not s or s in ("不明", "-", "—", "N/A", "n/a"):
        return None
    pct = s.endswith("%")
    if pct:
        s = s[:-1]
    try:
        n = float(s)
    except ValueError:
        return None
    if pct:
        n = n / 100
    return int(n) if n.is_integer() and not pct else n


def normalize_date(value):
    s = (value or "").strip().replace("/", "-")
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if not m:
        return ""
    try:
        return dt.date(int(m.group(1)), int(m.group(2)), int(m.group(3))).isoformat()
    except ValueError:
        return ""


def normalize_datetime(value):
    """'2026/9/26 7:03' なども 'YYYY-MM-DD HH:MM' にそろえる。読めなければ ''。"""
    s = (value or "").strip().replace("/", "-").replace("T", " ")
    m = re.match(r"^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?", s)
    if not m:
        return ""
    try:
        d = dt.datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)),
                        int(m.group(4) or 0), int(m.group(5) or 0))
    except ValueError:
        return ""
    return d.strftime("%Y-%m-%d %H:%M")


def normalize_post(text):
    """本文の比較用：改行をそろえ、行末の空白と前後の空行を取る。"""
    lines = (text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    return count_chars.normalize_block(lines)


def strip_comments(md):
    return re.sub(r"<!--.*?-->", "", md or "", flags=re.S)


def strip_example_sections(md):
    """見出しに「※例」がついた部分（次の同じか上の階層の見出しまで）と、「※例」を含む行を取り除く。"""
    out = []
    skip_level = None
    for line in strip_comments(md).replace("\r\n", "\n").split("\n"):
        m = re.match(r"^\s*(#{1,6})\s", line)
        if m:
            level = len(m.group(1))
            if skip_level is not None and level <= skip_level:
                skip_level = None
            if skip_level is None and "※例" in line:
                skip_level = level
                continue
        if skip_level is not None:
            continue
        if "※例" in line:
            continue
        out.append(line)
    return "\n".join(out)


def has_real_content(md):
    """記入例・見出し・説明（> の行）以外に中身があるか。"""
    for line in strip_example_sections(md or "").split("\n"):
        s = line.strip()
        if s and not s.startswith(("#", ">")) and not re.match(r"^(-{3,}|\|?[\s:|-]+\|?)$", s):
            return True
    return False


def read_settings():
    """knowledge/profile.md の「アカウント設定」を読む。"""
    text = read_text(ROOT / "knowledge" / "profile.md") or ""
    body = strip_example_sections(text)

    def field(name):
        m = re.search(r"^[ \t]*[-*・]?[ \t]*" + re.escape(name) + r"[ \t]*[:：][ \t]*(.*)$", body, re.M)
        value = m.group(1).strip() if m else ""
        return "" if value.startswith(("（未記入", "(未記入")) else value

    mode_raw = field("運用モード")
    return {
        "account": field("Xアカウント"),
        "mode": "収益化" if mode_raw.startswith("収益化") else "フォロワー増加",
        "mode_raw": mode_raw,
        "genre": field("発信ジャンル"),
        "target": field("ターゲット"),
        "premium": "加入" if re.match(r"^加入", field("X Premium")) else "未加入",
        "posts_per_day": field("1日の投稿本数"),
        "profile_found": bool(text),
    }


def list_log_dates():
    d = ROOT / "logs"
    if not d.is_dir():
        return []
    return sorted(p.name for p in d.iterdir() if p.is_dir() and DATE_RE.match(p.name))


def is_profile_item(item):
    return item.get("kind") == "monetize" and "プロフィール" in str(item.get("type") or "")


def item_limit(item):
    return count_chars.PROFILE_LIMIT if is_profile_item(item) else count_chars.LIMIT


def item_length(item):
    text = item.get("text") or ""
    if is_profile_item(item):
        return count_chars.plain_length(normalize_post(text))
    return count_chars.weighted_length(normalize_post(text))


def time_slot_of(posted_at):
    try:
        hour = int(posted_at[11:13])
    except (TypeError, ValueError):
        return ""
    if 5 <= hour <= 9:
        return "朝"
    if 10 <= hour <= 14:
        return "昼"
    if 15 <= hour <= 18:
        return "夕方"
    if 19 <= hour <= 23:
        return "夜"
    return "深夜"


# ---------------------------------------------------------------- Markdown → HTML（表示用・安全にエスケープ）

def _split_row(line):
    s = line.strip().replace("\\|", "\x01")
    if s.startswith("|"):
        s = s[1:]
    if s.endswith("|"):
        s = s[:-1]
    return [c.strip().replace("\x01", "|") for c in s.split("|")]


def _link(url, label):
    return (f'<a href="{html.escape(url, quote=True)}" target="_blank" rel="noopener noreferrer">'
            f"{html.escape(label)}</a>")


def _inline_plain(text):
    tokens = []

    def keep(fragment):
        tokens.append(fragment)
        return f"\x00{len(tokens) - 1}\x00"

    text = text.replace("\x00", "")
    text = re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", lambda m: keep(_link(m.group(2), m.group(1))), text)

    def bare(m):
        url = m.group(0)
        tail = ""
        while url and url[-1] in count_chars.URL_TRAILING_PUNCT:
            tail = url[-1] + tail
            url = url[:-1]
        return keep(_link(url, url)) + tail

    text = re.sub(r"https?://[\x21-\x7E]+", bare, text)
    s = html.escape(text)
    s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
    s = re.sub(r"~~(.+?)~~", r"<del>\1</del>", s)
    return re.sub(r"\x00(\d+)\x00", lambda m: tokens[int(m.group(1))], s)


def inline_md(text):
    out = []
    for part in re.split(r"(`[^`]+`)", text or ""):
        if len(part) >= 2 and part.startswith("`") and part.endswith("`"):
            out.append("<code>" + html.escape(part[1:-1]) + "</code>")
        else:
            out.append(_inline_plain(part))
    return "".join(out)


def _li_html(text):
    m = re.match(r"^\[([ xX])\]\s*(.*)$", text, re.S)
    if m:
        checked = " checked" if m.group(1).lower() == "x" else ""
        body = "<br>".join(inline_md(t) for t in m.group(2).split("\n"))
        return f'<input type="checkbox" disabled{checked}> {body}'
    return "<br>".join(inline_md(t) for t in text.split("\n"))


def _render_list(items, ordered):
    tag = "ol" if ordered else "ul"
    parts = [f"<{tag}>"]
    stack = [items[0][0]]
    for n, (indent, text) in enumerate(items):
        if n:
            if indent > stack[-1]:
                parts.append(f"<{tag}>")
                stack.append(indent)
            else:
                parts.append("</li>")
                while len(stack) > 1 and indent < stack[-1]:
                    stack.pop()
                    parts.append(f"</{tag}></li>")
        parts.append("<li>" + _li_html(text))
    parts.append("</li>")
    while len(stack) > 1:
        stack.pop()
        parts.append(f"</{tag}></li>")
    parts.append(f"</{tag}>")
    return "".join(parts)


LIST_RE = re.compile(r"^(\s*)([-*+]|\d+[.)])\s+(.*)$")


def md_to_html(md):
    lines = strip_comments(md).replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out, para = [], []

    def flush():
        if para:
            out.append("<p>" + "<br>".join(inline_md(p) for p in para) + "</p>")
            para.clear()

    i = 0
    while i < len(lines):
        line = lines[i]
        s = line.strip()
        fence = re.match(r"^(`{3,}|~{3,})\s*([\w-]*)\s*$", s)
        if fence:
            flush()
            marker, info = fence.group(1), fence.group(2).lower()
            j, body = i + 1, []
            while j < len(lines) and not lines[j].strip().startswith(marker[0] * len(marker)):
                body.append(lines[j])
                j += 1
            code = html.escape("\n".join(body).strip("\n"))
            if info in ("text", "profile"):
                out.append('<div class="md-code"><button type="button" class="btn small md-copy">コピー</button>'
                           f"<pre><code>{code}</code></pre></div>")
            else:
                out.append(f'<pre class="md-pre"><code>{code}</code></pre>')
            i = j + 1
            continue
        if not s:
            flush()
            i += 1
            continue
        m = re.match(r"^(#{1,6})\s+(.*)$", s)
        if m:
            flush()
            level = min(6, len(m.group(1)) + 2)
            out.append(f"<h{level}>{inline_md(m.group(2).rstrip('#').strip())}</h{level}>")
            i += 1
            continue
        if re.match(r"^(-{3,}|\*{3,}|_{3,})$", s):
            flush()
            out.append("<hr>")
            i += 1
            continue
        if s.startswith("|") and i + 1 < len(lines) and re.match(r"^\|?\s*:?-{2,}", lines[i + 1].strip()):
            flush()
            head = _split_row(s)
            j, rows = i + 2, []
            while j < len(lines) and lines[j].strip().startswith("|"):
                rows.append(_split_row(lines[j]))
                j += 1
            thead = "".join(f"<th>{inline_md(c)}</th>" for c in head)
            tbody = "".join("<tr>" + "".join(f"<td>{inline_md(c)}</td>" for c in r) + "</tr>" for r in rows)
            out.append(f'<div class="md-table"><table><thead><tr>{thead}</tr></thead><tbody>{tbody}</tbody></table></div>')
            i = j
            continue
        if s.startswith(">"):
            flush()
            quote = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                quote.append(lines[i].strip()[1:].strip())
                i += 1
            out.append("<blockquote>" + "<br>".join(inline_md(q) for q in quote) + "</blockquote>")
            continue
        m = LIST_RE.match(line)
        if m:
            flush()
            ordered = m.group(2)[0].isdigit()
            items = []
            while i < len(lines):
                mm = LIST_RE.match(lines[i])
                if mm:
                    items.append((len(mm.group(1).replace("\t", "    ")), mm.group(3)))
                    i += 1
                    continue
                nxt = lines[i]
                if items and nxt.startswith("  ") and nxt.strip() and not nxt.strip().startswith(("```", "~~~")):
                    indent, text = items[-1]
                    items[-1] = (indent, text + "\n" + nxt.strip())
                    i += 1
                    continue
                break
            out.append(_render_list(items, ordered))
            continue
        para.append(s)
        i += 1
    flush()
    return "\n".join(out)


def extract_section(md, keyword):
    """見出しに keyword を含む節（次の同じか上の階層の見出しまで）を返す。"""
    lines = (md or "").replace("\r\n", "\n").split("\n")
    start, level = None, None
    for idx, line in enumerate(lines):
        m = re.match(r"^\s*(#{1,6})\s+(.*)$", line)
        if not m:
            continue
        if start is None and keyword in m.group(2):
            start, level = idx, len(m.group(1))
        elif start is not None and len(m.group(1)) <= level:
            return "\n".join(lines[start:idx])
    return "\n".join(lines[start:]) if start is not None else ""


# ---------------------------------------------------------------- データ読み込み

def load_metrics():
    rows, err = read_csv(ROOT / "data" / "metrics.csv", METRICS_COLS)
    by_date = {}
    for r in rows:
        d = normalize_date(r.get("date"))
        if d:
            by_date[d] = {"date": d, **{k: to_num(r.get(k)) for k in METRICS_COLS[1:]}}
    return [by_date[k] for k in sorted(by_date)], err


def load_posted():
    rows, err = read_csv(ROOT / "data" / "posted.csv", POSTED_COLS)
    out = []
    for r in rows:
        pa = normalize_datetime(r.get("posted_at"))
        out.append({
            "posted_at": pa or (r.get("posted_at") or "").strip(),
            "date": pa[:10],
            "kind": (r.get("kind") or "").strip(),
            "type": (r.get("type") or "").strip(),
            "text": r.get("text") or "",
            "url": (r.get("url") or "").strip(),
            "approval_id": (r.get("approval_id") or "").strip(),
        })
    return out, err


def load_performance(posted):
    rows, err = read_csv(ROOT / "data" / "post_performance.csv", PERF_COLS)
    text_by_url = {p["url"]: p["text"] for p in posted if p["url"]}
    out = []
    for r in rows:
        pa = normalize_datetime(r.get("posted_at"))
        nums = {k: to_num(r.get(k)) for k in ["impressions", "likes", "reposts", "replies", "bookmarks", "profile_clicks"]}
        er = to_num(r.get("engagement_rate"))
        if er is not None and er > 1:
            er = er / 100
        if er is None and nums["impressions"]:
            parts = [nums[k] for k in ("likes", "reposts", "replies", "bookmarks")]
            if any(p is not None for p in parts):
                er = sum(p or 0 for p in parts) / nums["impressions"]
        slot = (r.get("time_slot") or "").strip()
        slot = re.split(r"[（(]", slot)[0].strip() if slot else time_slot_of(pa)
        url = (r.get("url") or "").strip()
        out.append({
            "url": url, "posted_at": pa, "date": pa[:10], "kind": (r.get("kind") or "").strip(),
            "type": (r.get("type") or "").strip(), "time_slot": slot, "engagement_rate": er,
            "text": text_by_url.get(url, ""), **nums,
        })
    return out, err


def load_learnings():
    text = read_text(ROOT / "knowledge" / "learnings.md")
    if text is None:
        return [], "knowledge/learnings.md がありません"
    entries = []
    for idx, line in enumerate(strip_example_sections(text).split("\n")):
        s = line.strip()
        if re.match(r"^[-*+]\s+", s):
            content = re.sub(r"^[-*+]\s+", "", s)
        elif s.startswith("|") and not re.match(r"^\|?\s*:?-{2,}", s):
            cells = _split_row(s)
            if not cells or cells[0] in ("日付", "date"):
                continue
            content = "｜".join(cells)
        else:
            continue
        if not content.strip():
            continue
        m = re.search(r"\d{4}-\d{2}-\d{2}", content)
        shown = content
        if m:
            shown = re.sub(r"^(~~)?\s*" + re.escape(m.group(0)) + r"\s*[｜|／/]\s*", r"\1", content)
        entries.append({
            "date": m.group(0) if m else "",
            "html": inline_md(shown),
            "struck": content.strip().startswith("~~"),
            "order": idx,
        })
    entries.sort(key=lambda e: (e["date"], e["order"]), reverse=True)
    return entries[:10], None


def load_weekly(dates):
    for d in reversed(dates):
        text = read_text(ROOT / "logs" / d / "weekly-review.md")
        if text is None:
            continue
        section = extract_section(text, "来週の提案")
        return {"date": d, "html": md_to_html(section) if section else "", "found": bool(section)}
    return None


def inbox_status(now):
    items = []
    for name, stale_days, desc in INBOX_FILES:
        entry = {"name": name, "desc": desc, "stale_days": stale_days}
        if name == "stats/":
            folder = ROOT / "inbox" / "stats"
            files = [p for p in folder.iterdir() if p.is_file() and not p.name.startswith((".", "_"))] if folder.is_dir() else []
            mtime = max((p.stat().st_mtime for p in files), default=None)
            entry.update(exists=folder.is_dir(), has_data=bool(files), has_example=False, count=len(files))
        else:
            path = ROOT / "inbox" / name
            text = read_text(path)
            mtime = path.stat().st_mtime if path.is_file() else None
            entry.update(exists=text is not None, has_data=has_real_content(text or ""),
                         has_example="※例" in (text or ""))
        age = (now.timestamp() - mtime) / 86400 if mtime else None
        entry["mtime"] = dt.datetime.fromtimestamp(mtime, JST).strftime("%Y-%m-%d %H:%M") if mtime else ""
        entry["age_days"] = round(age, 2) if age is not None else None
        if not entry["exists"]:
            state = "missing"
        elif stale_days is not None and not entry["has_data"]:
            state = "empty"
        elif stale_days is not None and age is not None and age >= stale_days:
            state = "stale"
        else:
            state = "ok"
        entry["state"] = state
        items.append(entry)
    return items


def load_day(date, logged_ids, with_files=False):
    folder = ROOT / "logs" / date
    day = {"date": date, "status": None, "approval": None, "status_error": None, "approval_error": None}
    status, err, exists = load_json(folder / "status.json")
    if err:
        day["status_error"] = err
    elif exists and not isinstance(status, dict):
        day["status_error"] = "中身が { } の形になっていません"
    elif exists:
        day["status"] = status
    approval, err, exists = load_json(folder / "approval.json")
    if err:
        day["approval_error"] = err
    elif exists and not isinstance(approval, dict):
        day["approval_error"] = "中身が { } の形になっていません"
    elif exists:
        items = approval.get("items") if isinstance(approval.get("items"), list) else []
        clean = []
        for item in items:
            if not isinstance(item, dict):
                continue
            it = dict(item)
            for key in ("id", "kind", "time", "type", "text", "target", "reason", "check"):
                it[key] = "" if it.get(key) is None else str(it.get(key))
            if it["kind"] != "like":
                it["_chars"] = item_length(it)
                it["_limit"] = item_limit(it)
                it["_chars_mismatch"] = isinstance(item.get("chars"), int) and item.get("chars") != it["_chars"]
            it["_logged"] = f"{date}#{it['id']}" in logged_ids
            clean.append(it)
        approval = dict(approval)
        approval["items"] = clean
        day["approval"] = approval
    names = sorted(p.name for p in folder.glob("*.md")) if folder.is_dir() else []
    day["file_names"] = names
    if with_files:
        files = {}
        for name in names:
            text = read_text(folder / name) or ""
            if len(text) > 400_000:
                text = text[:400_000] + "\n\n（長すぎるため途中まで表示しています）"
            files[name] = md_to_html(text)
        day["files"] = files
    return day


def adoption_series(days, logged_ids, today):
    out = []
    for date in sorted(days):
        approval = days[date].get("approval")
        if not approval:
            continue
        postable = [it for it in approval["items"] if it.get("kind") != "like" and (it.get("text") or "").strip()]
        posted = sum(1 for it in postable if f"{date}#{it['id']}" in logged_ids)
        if date == today and posted == 0:
            continue  # 今日はまだ途中。1件も記録がないうちは 0% と表示しない
        out.append({"date": date, "total": len(postable), "posted": posted,
                    "rate": (posted / len(postable)) if postable else None})
    return out


def json_for_html(payload):
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    return text.replace("&", "\\u0026").replace("<", "\\u003c").replace(">", "\\u003e")


def build(verbose=True):
    now = now_jst()
    today = now.strftime("%Y-%m-%d")
    settings = read_settings()
    posted, posted_err = load_posted()
    metrics, metrics_err = load_metrics()
    performance, perf_err = load_performance(posted)
    logged_ids = {p["approval_id"] for p in posted if p["approval_id"]}
    dates = list_log_dates()[-120:]

    days = {d: load_day(d, logged_ids) for d in dates}
    with_data = [d for d in dates if days[d]["status"] or days[d]["approval"] or days[d]["status_error"]
                 or days[d]["approval_error"]]
    if today in with_data:
        display = today
    elif with_data:
        display = with_data[-1]
    elif today in days:
        display = today
    else:
        display = dates[-1] if dates else today
    if display in days:
        days[display] = load_day(display, logged_ids, with_files=True)

    learnings, learn_err = load_learnings()
    payload = {
        "generated_at": now.strftime("%Y-%m-%d %H:%M"),
        "today": today,
        "display_date": display,
        "initialized": (ROOT / "knowledge").is_dir() and (ROOT / "inbox").is_dir(),
        "settings": settings,
        "teams": [{"name": n, "label": TEAM_LABELS[n], "file": TEAM_FILES[n]} for n in TEAMS],
        "kind_labels": KIND_LABELS,
        "days": days,
        "metrics": metrics,
        "posted": posted,
        "performance": performance,
        "errors": {"metrics": metrics_err, "posted": posted_err, "performance": perf_err, "learnings": learn_err},
        "learnings": learnings,
        "weekly": load_weekly(dates),
        "inbox": inbox_status(now),
        "adoption": adoption_series(days, logged_ids, today),
    }
    page = TEMPLATE.replace("__GENERATED__", html.escape(payload["generated_at"] + "（JST）"))
    page = page.replace("__DATA__", json_for_html(payload))
    out = ROOT / "dashboard" / "index.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    tmp = out.with_name("index.html.tmp")
    tmp.write_text(page, encoding="utf-8")
    os.replace(tmp, out)
    if verbose:
        day = days.get(display) or {}
        n_items = len((day.get("approval") or {}).get("items") or [])
        print(f"ダッシュボードを更新しました：{out}")
        print(f"  表示する日：{display}（今日 {today}）／承認待ちアイテム {n_items} 件／運用モード：{settings['mode']}")
        if display != today:
            print(f"  ※ 今日（{today}）の logs/ はまだありません。/x-morning を実行すると今日の分が表示されます")
    return out


# ---------------------------------------------------------------- --check（status.json / approval.json の検証）

def check_day(date):
    errors, warnings = [], []
    if not DATE_RE.match(date or ""):
        print(f"日付は YYYY-MM-DD の形で指定してください（受け取った値：{date}）")
        return 2
    folder = ROOT / "logs" / date
    settings = read_settings()
    print(f"■ logs/{date}/ の検証（運用モード：{settings['mode']}）")
    if not folder.is_dir():
        print(f"エラー 1件／警告 0件\n  エラー：logs/{date}/ がありません")
        return 1

    status, err, exists = load_json(folder / "status.json")
    if not exists:
        errors.append("status.json がありません")
    elif err:
        errors.append(f"status.json が JSON として読めません（{err}）")
    else:
        _check_status(status, date, folder, settings, errors, warnings)

    approval, err, exists = load_json(folder / "approval.json")
    if not exists:
        warnings.append("approval.json がありません（週次だけの日なら問題ありません）")
    elif err:
        errors.append(f"approval.json が JSON として読めません（{err}）")
    else:
        _check_approval(approval, date, folder, settings, errors, warnings)

    print(f"エラー {len(errors)}件／警告 {len(warnings)}件")
    for e in errors:
        print(f"  エラー：{e}")
    for w in warnings:
        print(f"  警告：{w}")
    if not errors:
        print("  → 仕様どおりです")
    return 1 if errors else 0


def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _check_status(status, date, folder, settings, errors, warnings):
    if not isinstance(status, dict):
        errors.append("status.json：中身が { } の形になっていません")
        return
    for key in ("date", "theme", "teams", "decisions", "requests"):
        if key not in status:
            errors.append(f"status.json：「{key}」がありません")
    if "date" in status and status.get("date") != date:
        errors.append(f"status.json：date が {status.get('date')!r} です（フォルダの日付 {date} と違います）")
    if "theme" in status and not isinstance(status.get("theme"), str):
        errors.append("status.json：theme は文字列にしてください")
    for key in ("decisions", "requests"):
        if key in status and (not isinstance(status[key], list) or not all(isinstance(x, str) for x in status[key])):
            errors.append(f"status.json：{key} は文字列のリスト [\"…\"] にしてください")
    teams = status.get("teams")
    if "teams" in status and not isinstance(teams, list):
        errors.append("status.json：teams はリスト [ … ] にしてください")
        return
    seen = set()
    for n, t in enumerate(teams or [], 1):
        where = f"status.json：teams の {n} 番目"
        if not isinstance(t, dict):
            errors.append(f"{where}が {{ }} の形になっていません")
            continue
        name = t.get("name")
        where = f"status.json：{name or f'teams の {n} 番目'}"
        if name not in TEAMS:
            errors.append(f"{where}：name {name!r} は11チームの名前ではありません")
        elif name in seen:
            errors.append(f"{where}：同じチームが2回あります")
        seen.add(name)
        if t.get("status") not in STATUS_VALUES:
            errors.append(f"{where}：status {t.get('status')!r} は done/returned/ng/skipped/missing のどれかにしてください")
        for key in ("items", "ng"):
            if not _is_int(t.get(key)) or t.get(key) < 0:
                errors.append(f"{where}：{key} は 0 以上の整数にしてください（今は {t.get(key)!r}）")
        if not isinstance(t.get("note", ""), str):
            errors.append(f"{where}：note は文字列にしてください")
        f = t.get("file")
        if f is not None and not isinstance(f, str):
            errors.append(f"{where}：file は文字列か null にしてください")
        elif f and t.get("status") in ("done", "returned", "ng") and not (folder / f).is_file():
            errors.append(f"{where}：file {f!r} が logs/{date}/ にありません")
    missing = [n for n in TEAMS if n not in seen]
    if missing:
        warnings.append("status.json：次のチームがありません（11チームすべて入れてください）：" + "、".join(missing))
    by_name = {t.get("name"): t for t in teams or [] if isinstance(t, dict)}
    mon = by_name.get("monetize")
    if settings["mode"] == "フォロワー増加" and mon and mon.get("status") != "skipped":
        warnings.append("status.json：フォロワー増加モードなのに monetize が skipped になっていません")


def _check_approval(approval, date, folder, settings, errors, warnings):
    if not isinstance(approval, dict):
        errors.append("approval.json：中身が { } の形になっていません")
        return
    if approval.get("date") != date:
        errors.append(f"approval.json：date が {approval.get('date')!r} です（フォルダの日付 {date} と違います）")
    items = approval.get("items")
    if not isinstance(items, list):
        errors.append("approval.json：items はリスト [ … ] にしてください")
        return
    block_cache = {}

    def blocks_of(name):
        if name not in block_cache:
            text = read_text(folder / name)
            block_cache[name] = None if text is None else {
                normalize_post(b["text"]) for b in count_chars.extract_md_blocks(text)}
        return block_cache[name]

    ids = set()
    recommended_buzz = 0
    for n, it in enumerate(items, 1):
        if not isinstance(it, dict):
            errors.append(f"approval.json：items の {n} 番目が {{ }} の形になっていません")
            continue
        iid = it.get("id")
        where = f"approval.json：{iid or f'items の {n} 番目'}"
        missing = [k for k in APPROVAL_KEYS if k not in it]
        if missing:
            errors.append(f"{where}：項目 {', '.join(missing)} がありません")
        if not isinstance(iid, str) or not iid:
            errors.append(f"{where}：id がありません")
        elif iid in ids:
            errors.append(f"{where}：id が重複しています")
        ids.add(iid)
        kind = it.get("kind")
        if kind not in KINDS:
            errors.append(f"{where}：kind {kind!r} は {'/'.join(KINDS)} のどれかにしてください")
            continue
        t = it.get("time", "")
        if not isinstance(t, str) or (t and not TIME_RE.match(t)):
            errors.append(f"{where}：time は \"07:00\" の形か \"\" にしてください（今は {t!r}）")
        for key in ("type", "text", "target", "reason"):
            if key in it and not isinstance(it.get(key), str):
                errors.append(f"{where}：{key} は文字列にしてください")
        url = it.get("target_url")
        if url is not None and (not isinstance(url, str) or not re.match(r"^https?://", url)):
            errors.append(f"{where}：target_url は http で始まる URL か null にしてください（今は {url!r}）")
        if "chars" in it and not _is_int(it.get("chars")):
            errors.append(f"{where}：chars は整数にしてください")
        if it.get("check") not in CHECKS:
            errors.append(f"{where}：check は OK/要修正/NG のどれかにしてください（今は {it.get('check')!r}）")
        if it.get("rank") is not None and not _is_int(it.get("rank")):
            errors.append(f"{where}：rank は整数か null にしてください")
        if "recommended" in it and not isinstance(it.get("recommended"), bool):
            errors.append(f"{where}：recommended は true か false にしてください")
        text = it.get("text") if isinstance(it.get("text"), str) else ""
        target = it.get("target") if isinstance(it.get("target"), str) else ""
        if kind == "like":
            if not target.strip():
                errors.append(f"{where}：いいねの相手（target）がありません")
            if text.strip():
                warnings.append(f"{where}：いいねの text は \"\" にしてください")
            continue
        if not text.strip():
            if kind == "mention-reply" and not it.get("recommended"):
                continue
            errors.append(f"{where}：本文（text）が空です")
            continue
        if kind in ("reply", "mention-reply") and not target.strip():
            errors.append(f"{where}：リプの相手（target）がありません")
        if kind == "quote" and not target.strip():
            warnings.append(f"{where}：引用元（target）がありません")
        length, limit = item_length(it), item_limit(it)
        if _is_int(it.get("chars")) and it.get("chars") != length:
            warnings.append(f"{where}：chars が {it.get('chars')} ですが、本文を数え直すと {length} です"
                            "（checks.md の数値と本文を確認してください。ダッシュボードは数え直した値を表示します）")
        if length > limit and it.get("check") == "OK":
            errors.append(f"{where}：{length}/{limit} で上限を超えているのに check が OK です")
        if length > limit and it.get("recommended"):
            errors.append(f"{where}：上限を超えている案が recommended になっています")
        if it.get("check") == "NG" and it.get("recommended"):
            errors.append(f"{where}：NG の案が recommended になっています")
        if kind == "buzz" and it.get("recommended"):
            recommended_buzz += 1
        source = KIND_FILES.get(kind)
        found = blocks_of(source)
        first = text.strip().split("\n")[0][:20]
        if found is None:
            errors.append(f"{where}：本文の元ファイル {source} が logs/{date}/ にありません")
        elif normalize_post(text) not in found:
            errors.append(f"{where}：本文が {source} のコードブロックと一致しません（書き換え・写し間違いの可能性）：「{first}…」")
        if settings["mode"] == "フォロワー増加" and SALES_WORDS_RE.search(text):
            warnings.append(f"{where}：フォロワー増加モードなのに LINE・商品・販売に関する言葉があります：「{first}…」")
    if not items:
        warnings.append("approval.json：items が空です")
    elif recommended_buzz == 0 and any(isinstance(i, dict) and i.get("kind") == "buzz" for i in items):
        warnings.append("approval.json：おすすめ（recommended: true）の勝負ポストがありません")


# ---------------------------------------------------------------- --log（投稿の記録）

LOG_KEY_ALIASES = {
    "id": "id", "承認id": "id", "approval_id": "id", "kind": "kind", "種類": "kind", "type": "type", "型": "type",
    "posted_at": "posted_at", "日時": "posted_at", "投稿日時": "posted_at", "url": "url",
}
BODY_RE = re.compile(r"^\s*(本文|text)\s*[:：]\s*$", re.I)


def parse_log_input(raw):
    text = (raw or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if text.startswith("/x-log"):
        text = text[len("/x-log"):].strip()
    chunks, cur = [], []
    for line in text.split("\n"):
        if line.strip() == "---":
            chunks.append(cur)
            cur = []
        else:
            cur.append(line)
    chunks.append(cur)
    entries = []
    for lines in chunks:
        if not "\n".join(lines).strip():
            continue
        if any(BODY_RE.match(ln) for ln in lines):
            meta, body, in_body = {}, [], False
            for ln in lines:
                if in_body:
                    body.append(ln)
                    continue
                if BODY_RE.match(ln):
                    in_body = True
                    continue
                m = re.match(r"^\s*([A-Za-z_]+|承認ID|種類|型|日時|投稿日時)\s*[:：]\s*(.*)$", ln)
                if m and m.group(1).lower() in LOG_KEY_ALIASES:
                    meta[LOG_KEY_ALIASES[m.group(1).lower()]] = m.group(2).strip()
            entries.append({**meta, "text": normalize_post("\n".join(body))})
        else:
            chunk = "\n".join(lines)
            urls = X_STATUS_URL_RE.findall(chunk)
            url = urls[-1] if urls else ""
            if url:
                idx = chunk.rfind(url)
                chunk = chunk[:idx] + chunk[idx + len(url):]
            entries.append({"text": normalize_post(chunk), "url": url})
    return entries


def load_recent_approvals(days=14):
    out = []
    for d in list_log_dates()[-days:]:
        data, err, exists = load_json(ROOT / "logs" / d / "approval.json")
        if exists and not err and isinstance(data, dict) and isinstance(data.get("items"), list):
            for it in data["items"]:
                if isinstance(it, dict) and it.get("kind") != "like" and isinstance(it.get("text"), str):
                    out.append((d, it))
    return out


def md_escape_block(text):
    return text.replace("```", "ˋˋˋ")


def log_posts(input_path):
    path = Path(input_path)
    if not path.is_absolute():
        path = (Path.cwd() / path).resolve()
    raw = read_text(path)
    if raw is None:
        print(f"エラー：{input_path} を読めません")
        return 1
    entries = parse_log_input(raw)
    if not entries:
        print("エラー：記録する本文が見つかりません")
        return 1

    now = now_jst()
    approvals = load_recent_approvals()
    by_key = {f"{d}#{it.get('id')}": (d, it) for d, it in approvals}
    csv_path = ROOT / "data" / "posted.csv"
    rows, err = read_csv(csv_path, POSTED_COLS)
    if err:
        print(f"エラー：{err}（data/posted.csv の1行目を {','.join(POSTED_COLS)} にしてください）")
        return 1
    rows = [{k: (r.get(k) or "") for k in POSTED_COLS} for r in rows]

    added, updated, skipped, md_blocks, problems = [], [], [], [], []
    for e in entries:
        text = e.get("text", "")
        if not text:
            problems.append("本文が空のものがあったので記録しませんでした")
            continue
        posted_at = normalize_datetime(e.get("posted_at")) or now.strftime("%Y-%m-%d %H:%M")
        url = (e.get("url") or "").strip()
        if url and not re.match(r"^https?://", url):
            problems.append(f"URL の形ではないので記録しませんでした：{url}")
            url = ""
        kind, typ, note = (e.get("kind") or "").strip(), (e.get("type") or "").strip(), ""
        aid = (e.get("id") or "").strip()
        if aid and "#" not in aid:
            aid = f"{posted_at[:10]}#{aid}"
        match = by_key.get(aid) if aid else None
        if not aid:
            exact = [(d, it) for d, it in approvals if normalize_post(it.get("text")) == text]
            if exact:
                match = exact[-1]
            else:
                best, score = None, 0.0
                for d, it in approvals:  # 日付の古い順なので、同点なら新しい日の案が勝つ
                    r = difflib.SequenceMatcher(None, normalize_post(it.get("text")), text).ratio()
                    if r >= score and r > 0:
                        best, score = (d, it), r
                if best and score >= 0.85:
                    match, note = best, "（案を一部修正して投稿）"
            if match:
                aid = f"{match[0]}#{match[1].get('id')}"
        if match:
            kind = kind or str(match[1].get("kind") or "")
            typ = typ or str(match[1].get("type") or "")

        dup = None
        for r in rows:
            if aid and r["approval_id"] == aid:
                dup = r
                break
            if not aid and normalize_post(r["text"]) == text and (r["posted_at"] or "")[:10] == posted_at[:10]:
                dup = r
                break
        first = text.split("\n")[0][:30]
        if dup:
            if url and not dup["url"]:
                dup["url"] = url
                updated.append(f"URL を追記：{aid or first}")
                md_blocks.append(f"\n- {posted_at} 追記：{aid or first} の URL → {url}\n")
            else:
                skipped.append(f"記録済みのためスキップ：{aid or first}")
            continue
        row = {"posted_at": posted_at, "kind": kind, "type": typ, "text": text, "url": url, "approval_id": aid}
        rows.append(row)
        added.append(row)
        label = "／".join(x for x in (KIND_LABELS.get(kind, kind), typ) if x) or "種類不明"
        md_blocks.append(
            f"\n## {posted_at}（{label}）{note}\n"
            f"- URL：{url or 'URL未記録'}\n"
            f"- 承認ID：{aid or 'なし'}\n"
            f"```text\n{md_escape_block(text)}\n```\n"
        )

    if added or updated:
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=POSTED_COLS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
        tmp = csv_path.with_name("posted.csv.tmp")
        tmp.write_text(buf.getvalue(), encoding="utf-8")
        os.replace(tmp, csv_path)
        md_path = ROOT / "inbox" / "posted.md"
        md_path.parent.mkdir(parents=True, exist_ok=True)
        if not md_path.exists():
            md_path.write_text("# 投稿した記録\n", encoding="utf-8")
        with md_path.open("a", encoding="utf-8") as fh:
            fh.write("".join(md_blocks))

    print(f"記録：追加 {len(added)} 件／URL追記 {len(updated)} 件／スキップ {len(skipped)} 件")
    for r in added:
        print(f"  追加：{r['posted_at']}｜{KIND_LABELS.get(r['kind'], r['kind'] or '種類不明')}"
              f"｜{r['text'].split(chr(10))[0][:30]}｜URL：{r['url'] or 'なし'}｜承認ID：{r['approval_id'] or 'なし'}")
    for s in updated + skipped + problems:
        print(f"  {s}")

    if path.name == "_xlog_input.txt" and ROOT / "logs" in path.parents:
        try:
            path.unlink()
        except OSError:
            pass
    build(verbose=True)
    return 0


# ---------------------------------------------------------------- --status

def print_status():
    now = now_jst()
    today = now.date()
    posted, _ = load_posted()
    print("■ 直近7日の投稿数（data/posted.csv）")
    total = 0
    for back in range(6, -1, -1):
        d = (today - dt.timedelta(days=back)).isoformat()
        n = sum(1 for p in posted if p["date"] == d)
        total += n
        wd = "月火水木金土日"[dt.date.fromisoformat(d).weekday()]
        print(f"  {d}（{wd}）：{n} 件")
    print(f"  合計：{total} 件（1日平均 {total / 7:.1f} 件）")

    print("\n■ inbox/ の最終更新")
    missing = []
    for e in inbox_status(now):
        age = f"{e['age_days']:.1f}日前" if e["age_days"] is not None else "—"
        mark = {"ok": "", "stale": " ⚠️ 古くなっています", "empty": " ⚠️ まだ中身がありません",
                "missing": " ⚠️ ファイルがありません"}[e["state"]]
        example = "（記入例が残っています）" if e.get("has_example") else ""
        print(f"  {e['name']:<16} {e['mtime'] or '—'}（{age}）{mark}{example}")
        if e["name"] == "stats/":
            if not e.get("has_data"):
                missing.append("inbox/stats/ に数字がまだありません → X のアナリティクスの数字を貼って /x-weekly")
            elif e["age_days"] is not None and e["age_days"] >= 8:
                missing.append(f"inbox/stats/ が {int(e['age_days'])} 日更新されていません → 最新の数字を貼って /x-weekly")
        elif e["state"] in ("stale", "empty"):
            missing.append(f"inbox/{e['name']}（{e['desc']}）が{'古い' if e['state'] == 'stale' else '空'}です → 今日の分を貼ってください")

    metrics, _ = load_metrics()
    if not metrics:
        missing.append("data/metrics.csv に数字がありません → inbox/stats/ に数字を貼って /x-weekly")
    else:
        last = dt.date.fromisoformat(metrics[-1]["date"])
        if (today - last).days >= 14:
            missing.append(f"data/metrics.csv の最新が {last}（{(today - last).days}日前）です → /x-weekly で更新")
        recent = [m for m in metrics if (today - dt.date.fromisoformat(m["date"])).days < 14]
        if recent and all(m["profile_clicks"] is None for m in recent):
            missing.append("直近2週間のプロフィールクリックの数字がないため、フォロー率が出せません")
    if total == 0:
        missing.append("直近7日の投稿記録がありません → 投稿したら /x-log で記録してください")
    for name in ("profile.md", "voice.md", "ng-words.md"):
        text = read_text(ROOT / "knowledge" / name)
        if text is None:
            missing.append(f"knowledge/{name} がありません → bash scripts/init.sh を実行してください")
        elif "※例" in text:
            missing.append(f"knowledge/{name} に記入例（※例）が残っています → 自分の内容に書き換えてください")

    print("\n■ 足りないデータ")
    if missing:
        for m in missing:
            print(f"  - {m}")
    else:
        print("  なし")
    return 0


# ---------------------------------------------------------------- 入口

def main(argv):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    if not argv:
        build()
        return 0
    cmd = argv[0]
    if cmd in ("-h", "--help"):
        print(__doc__)
        return 0
    if cmd == "--today":
        print(now_jst().strftime("%Y-%m-%d"))
        return 0
    if cmd == "--check":
        if len(argv) < 2:
            print("--check の後に日付（YYYY-MM-DD）を指定してください")
            return 2
        return check_day(argv[1])
    if cmd == "--log":
        if len(argv) < 2:
            print("--log の後に入力ファイルを指定してください（例：logs/_xlog_input.txt）")
            return 2
        return log_posts(argv[1])
    if cmd == "--status":
        return print_status()
    print(f"知らないオプションです：{cmd}\n")
    print(__doc__)
    return 2


# ---------------------------------------------------------------- HTML テンプレート

TEMPLATE = r"""<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>X運用ダッシュボード</title>
<style>
:root{
  color-scheme: light;
  --page:#f9f9f7; --surface:#fcfcfb; --surface-2:#f1f0ec; --text:#0b0b0b; --text-2:#52514e; --muted:#6c6a65;
  --grid:#e1e0d9; --baseline:#c3c2b7; --border:rgba(11,11,11,.10); --border-strong:rgba(11,11,11,.20);
  --series-1:#2a78d6; --track:#cde2fb; --accent:#2a78d6; --accent-ink:#ffffff; --accent-wash:rgba(42,120,214,.10);
  --good:#0ca30c; --warning:#fab219; --serious:#ec835a; --critical:#d03b3b; --neutral:#898781;
  --delta-good:#006300; --delta-bad:#d03b3b; --shadow:0 1px 2px rgba(0,0,0,.05);
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    color-scheme: dark;
    --page:#0d0d0d; --surface:#1a1a19; --surface-2:#242422; --text:#ffffff; --text-2:#c3c2b7; --muted:#a3a198;
    --grid:#2c2c2a; --baseline:#383835; --border:rgba(255,255,255,.10); --border-strong:rgba(255,255,255,.22);
    --series-1:#3987e5; --track:#104281; --accent:#3987e5; --accent-ink:#ffffff; --accent-wash:rgba(57,135,229,.18);
    --delta-good:#0ca30c; --delta-bad:#e66767; --shadow:none;
  }
}
:root[data-theme="dark"]{
  color-scheme: dark;
  --page:#0d0d0d; --surface:#1a1a19; --surface-2:#242422; --text:#ffffff; --text-2:#c3c2b7; --muted:#a3a198;
  --grid:#2c2c2a; --baseline:#383835; --border:rgba(255,255,255,.10); --border-strong:rgba(255,255,255,.22);
  --series-1:#3987e5; --track:#104281; --accent:#3987e5; --accent-ink:#ffffff; --accent-wash:rgba(57,135,229,.18);
  --delta-good:#0ca30c; --delta-bad:#e66767; --shadow:none;
}
*{box-sizing:border-box}
[hidden]{display:none !important}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--page);color:var(--text);font:15px/1.65 system-ui,-apple-system,"Segoe UI","Hiragino Sans","Hiragino Kaku Gothic ProN","Noto Sans JP","Yu Gothic UI",Meiryo,sans-serif;overflow-wrap:anywhere}
a{color:var(--accent)}
button,input,select,textarea{font:inherit;color:inherit}
.wrap{max-width:1180px;margin:0 auto;padding:16px 16px 48px}
.top{display:flex;flex-wrap:wrap;gap:8px 16px;align-items:flex-start;justify-content:space-between;margin-bottom:8px}
.brand h1{font-size:20px;margin:0;line-height:1.3}
.brand .sub{display:flex;flex-wrap:wrap;gap:8px;align-items:center;color:var(--text-2);font-size:14px;margin-top:4px}
.mode{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--border-strong);border-radius:999px;padding:1px 10px;font-size:13px;color:var(--text)}
.mode::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--series-1)}
.meta{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:flex-end;margin-left:auto}
.gen{font-size:13px;color:var(--text-2)}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--border);margin:8px 0 16px;overflow-x:auto;scrollbar-width:none}
.tabs button{background:none;border:0;border-bottom:3px solid transparent;padding:10px 14px;font-size:15px;color:var(--text-2);cursor:pointer;white-space:nowrap}
.tabs button[aria-selected="true"]{color:var(--text);border-bottom-color:var(--accent);font-weight:600}
.tabs button:focus-visible,.btn:focus-visible,.chip:focus-visible,.team:focus-visible,.svgc:focus-visible,.c-hit:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.grid{display:grid;gap:16px}
.cols-2{grid-template-columns:repeat(auto-fit,minmax(min(100%,420px),1fr))}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:16px;box-shadow:var(--shadow);min-width:0}
.card h2{font-size:16px;margin:0 0 12px;display:flex;flex-wrap:wrap;gap:8px;align-items:baseline}
.card h2 .count{font-size:13px;font-weight:400;color:var(--text-2)}
.card h3{font-size:15px;margin:16px 0 8px}
.hint{color:var(--text-2);font-size:13px;margin:-6px 0 12px}
section[role=tabpanel]>*+*{margin-top:16px}
.notice{border-radius:10px;padding:10px 14px;border:1px solid var(--border-strong);background:var(--surface);display:flex;gap:10px;align-items:flex-start;font-size:14px}
.notice .ico{flex:none;width:20px;height:20px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#0b0b0b;margin-top:1px}
.notice.info .ico{background:var(--series-1);color:#fff}
.notice.warn .ico{background:var(--warning)}
.notice.error .ico{background:var(--critical);color:#fff}
.hero{display:grid;gap:12px}
.hero-date{font-size:22px;font-weight:600;line-height:1.3}
.hero-theme{display:flex;gap:10px;flex-wrap:wrap;align-items:baseline}
.lbl{display:inline-block;font-size:12px;color:var(--text-2);border:1px solid var(--border-strong);border-radius:6px;padding:0 6px;line-height:1.6;white-space:nowrap}
.checks{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.checks label{display:flex;gap:10px;align-items:flex-start;cursor:pointer}
.checks input{margin-top:5px;width:18px;height:18px;flex:none;accent-color:var(--accent)}
.checks .done-text{color:var(--text-2);text-decoration:line-through}
.teams{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,190px),1fr));gap:10px}
.team{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;gap:6px;background:var(--surface);border:1px solid var(--border);border-left:5px solid var(--neutral);border-radius:10px;padding:10px 12px;min-height:112px}
.team:hover{border-color:var(--border-strong)}
.team .name{font-weight:600;line-height:1.3}
.team .en{font-size:12px;color:var(--text-2)}
.team .nums{font-size:13px;color:var(--text-2)}
.team .note{font-size:13px;color:var(--text-2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.st-done{border-left-color:var(--good)}.st-returned{border-left-color:var(--warning)}.st-ng{border-left-color:var(--critical)}.st-missing{border-left-color:var(--serious)}.st-skipped{border-left-color:var(--neutral)}
.badge{display:inline-flex;align-items:center;gap:6px;font-size:13px;white-space:nowrap}
.badge .i{width:18px;height:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;flex:none}
.b-good .i{background:var(--good)}.b-warning .i{background:var(--warning);color:#0b0b0b}.b-critical .i{background:var(--critical)}.b-serious .i{background:var(--serious);color:#0b0b0b}.b-neutral .i{background:var(--neutral)}
.files{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--border-strong);background:var(--surface);border-radius:8px;padding:6px 12px;min-height:36px;cursor:pointer;font-size:14px;text-decoration:none;color:var(--text)}
.btn:hover{background:var(--surface-2)}
.btn.primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.btn.primary:hover{filter:brightness(1.06)}
.btn.small{min-height:28px;padding:2px 10px;font-size:13px}
.btn[disabled]{opacity:.45;cursor:not-allowed}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.chip{border:1px solid var(--border-strong);background:var(--surface);border-radius:999px;padding:4px 12px;cursor:pointer;font-size:13px;color:var(--text)}
.chip[aria-pressed="true"]{background:var(--accent-wash);border-color:var(--accent);font-weight:600}
.queue{display:grid;gap:12px}
.item{border:1px solid var(--border);border-radius:12px;padding:12px 14px;background:var(--surface);display:grid;gap:10px;min-width:0}
.item.rec{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent) inset}
.item.is-ng{opacity:.72}
.item-head{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center}
.time{font-weight:700;font-variant-numeric:tabular-nums}
.kind{font-size:12px;border-radius:6px;padding:1px 8px;background:var(--surface-2);border:1px solid var(--border)}
.type{font-size:13px;color:var(--text-2)}
.rec-badge{font-size:12px;font-weight:700;color:var(--accent-ink);background:var(--accent);border-radius:6px;padding:1px 8px}
.push-right{margin-left:auto}
.post-text{white-space:pre-wrap;background:var(--surface-2);border-radius:8px;padding:10px 12px;font-size:15px;line-height:1.7}
.target{font-size:14px;color:var(--text-2);display:flex;flex-wrap:wrap;gap:4px 10px}
.charline{display:flex;align-items:center;gap:10px;font-size:13px;color:var(--text-2)}
.meter{flex:1;max-width:260px;height:6px;border-radius:3px;background:var(--track);overflow:hidden}
.meter>span{display:block;height:100%;border-radius:3px;background:var(--series-1)}
.meter.over>span{background:var(--critical)}
.chars{font-variant-numeric:tabular-nums;white-space:nowrap}
.warn-text{font-size:13px;color:var(--text-2)}
.reason{margin:0;font-size:14px;color:var(--text-2);display:flex;gap:8px;align-items:baseline}
.actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.posted{display:inline-flex;gap:6px;align-items:center;font-size:14px;cursor:pointer;padding:4px 2px}
.posted input{width:18px;height:18px;accent-color:var(--good)}
.url-in{flex:1 1 220px;min-width:0;border:1px solid var(--border-strong);background:var(--surface);border-radius:8px;padding:6px 10px;font-size:14px}
.logged{font-size:13px;color:var(--text-2)}
.bulk{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-top:12px;padding-top:12px;border-top:1px solid var(--border)}
.like-groups{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr))}
.like-group h3{margin:0 0 6px;font-size:14px}
.likes{list-style:none;padding:0;margin:0;display:grid;gap:4px}
.likes label{display:flex;gap:8px;align-items:flex-start;padding:6px 4px;border-radius:6px;cursor:pointer}
.likes label:hover{background:var(--surface-2)}
.likes input{margin-top:4px;width:18px;height:18px;flex:none;accent-color:var(--good)}
.likes .why{display:block;font-size:13px;color:var(--text-2)}
.prog{display:flex;gap:10px;align-items:center;margin-bottom:12px;font-size:14px}
.prog .meter{max-width:320px;height:8px}
.prog .meter>span{background:var(--good)}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{border-bottom:1px solid var(--grid);padding:6px 8px;text-align:left;vertical-align:top}
th{color:var(--text-2);font-weight:600;font-size:13px;white-space:nowrap}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
td.nowrap{white-space:nowrap}
.md-table{overflow-x:auto;max-width:100%}
.state{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.state::before{content:"";width:10px;height:10px;border-radius:50%;background:var(--good);flex:none}
.state.s-stale::before,.state.s-empty::before{background:var(--warning)}
.state.s-missing::before{background:var(--critical)}
.state.s-info::before{background:var(--neutral)}
tr.warnrow td{background:rgba(250,178,25,.12)}
.kpis{display:grid;gap:12px;grid-template-columns:1fr}
@media (min-width:480px){.kpis{grid-template-columns:repeat(2,1fr)}}
@media (min-width:900px){.kpis{grid-template-columns:repeat(3,1fr)}}
.kpi .label{font-size:13px;color:var(--text-2)}
.kpi .value{font-size:28px;font-weight:600;line-height:1.3;margin-top:2px}
.kpi .delta{font-size:13px;margin-top:2px;color:var(--text-2)}
.kpi .delta.up{color:var(--delta-good)}
.kpi .delta.down{color:var(--delta-bad)}
.kpi .note{font-size:12px;color:var(--text-2);margin-top:4px}
.filters{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.filters .lbl2{font-size:14px;color:var(--text-2);margin-right:4px}
.chart{position:relative;width:100%;min-height:40px}
.chart svg{display:block;overflow:visible}
.c-grid{stroke:var(--grid);stroke-width:1;shape-rendering:crispEdges}
.c-base{stroke:var(--baseline);stroke-width:1;shape-rendering:crispEdges}
.c-tick{fill:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
.c-label{fill:var(--text-2);font-size:13px}
.c-value{fill:var(--text);font-size:13px;font-weight:600}
.c-endlabel{fill:var(--text);font-size:13px;font-weight:600}
.c-line{fill:none;stroke:var(--series-1);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.c-dot{fill:var(--series-1);stroke:var(--surface);stroke-width:2}
.c-bar{fill:var(--series-1)}
.c-bar.hot{opacity:.78}
.c-cross{stroke:var(--baseline);stroke-width:1}
.c-hit{fill:transparent;cursor:default;outline:none}
.tip{position:absolute;display:none;pointer-events:none;background:var(--surface);border:1px solid var(--border-strong);border-radius:8px;padding:6px 10px;font-size:13px;box-shadow:0 4px 14px rgba(0,0,0,.14);z-index:5;white-space:nowrap}
.tip strong{display:block;font-size:15px;color:var(--text)}
.tip .k{color:var(--text-2)}
details.tv{margin-top:8px}
details.tv summary{cursor:pointer;color:var(--text-2);font-size:13px}
.empty{display:flex;gap:10px;align-items:flex-start;color:var(--text-2);font-size:14px;background:var(--surface-2);border-radius:10px;padding:12px 14px}
.empty::before{content:"i";flex:none;width:20px;height:20px;border-radius:50%;background:var(--neutral);color:#fff;font-size:12px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;margin-top:1px}
.learn{list-style:none;padding:0;margin:0;display:grid;gap:8px}
.learn li{padding:8px 12px;border-radius:8px;background:var(--surface-2)}
.learn li.struck{color:var(--muted);background:transparent;border:1px dashed var(--border-strong)}
.learn .d{font-size:12px;color:var(--text-2);display:block}
select{border:1px solid var(--border-strong);background:var(--surface);border-radius:8px;padding:6px 10px;max-width:100%}
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:none;align-items:center;justify-content:center;padding:16px;z-index:50}
.overlay.open{display:flex}
.modal{background:var(--surface);color:var(--text);width:100%;max-width:900px;max-height:90vh;overflow:auto;border-radius:12px;padding:16px 20px;border:1px solid var(--border-strong)}
.modal-head{display:flex;gap:12px;align-items:center;justify-content:space-between;position:sticky;top:-16px;background:var(--surface);padding:8px 0;margin-top:-8px;z-index:1}
.modal-head h2{font-size:16px;margin:0}
.md{font-size:14px}
.md h3{font-size:17px;margin:18px 0 8px}.md h4{font-size:15px;margin:16px 0 6px}.md h5,.md h6{font-size:14px;margin:12px 0 6px}
.md pre{white-space:pre-wrap;background:var(--surface-2);border-radius:8px;padding:10px 12px;margin:6px 0;font:14px/1.7 system-ui,-apple-system,"Segoe UI","Hiragino Sans","Noto Sans JP",Meiryo,sans-serif}
.md code{background:var(--surface-2);border-radius:4px;padding:0 4px;font-size:13px}
.md pre code{background:none;padding:0;font-size:inherit}
.md-code{position:relative}
.md-code .md-copy{position:absolute;top:6px;right:6px}
.md-code pre{padding-right:72px}
.md blockquote{margin:8px 0;padding:6px 12px;border-left:3px solid var(--border-strong);color:var(--text-2)}
.md ul,.md ol{padding-left:22px}
.manual{width:100%;border:1px solid var(--border-strong);border-radius:8px;padding:8px;background:var(--surface-2)}
.toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%) translateY(20px);background:var(--text);color:var(--page);padding:10px 16px;border-radius:10px;font-size:14px;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;z-index:60;max-width:calc(100% - 32px)}
.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.foot{margin-top:32px;color:var(--text-2);font-size:13px}
@media (max-width:640px){
  .wrap{padding:12px 16px 40px}
  .brand h1{font-size:18px}
  .kpi .value{font-size:24px}
  .hero-date{font-size:19px}
  .card{padding:14px}
  .actions .btn{flex:1 1 auto}
}
@media (forced-colors: active){
  .team{border-left-width:5px}
  .meter>span{background:Highlight}
}
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="brand">
      <h1>X Marketing Company</h1>
      <div class="sub"><span id="account"></span><span class="mode" id="mode-badge"></span></div>
    </div>
    <div class="meta">
      <div class="gen">生成：__GENERATED__</div>
      <button type="button" class="btn small" id="theme-btn">テーマ：自動</button>
    </div>
  </header>
  <nav class="tabs" role="tablist" aria-label="ダッシュボードのタブ">
    <button type="button" role="tab" id="tab-today" aria-controls="panel-today" aria-selected="true">今日</button>
    <button type="button" role="tab" id="tab-results" aria-controls="panel-results" aria-selected="false" tabindex="-1">成果</button>
    <button type="button" role="tab" id="tab-history" aria-controls="panel-history" aria-selected="false" tabindex="-1">履歴</button>
    <button type="button" role="tab" id="tab-learn" aria-controls="panel-learn" aria-selected="false" tabindex="-1">学び</button>
  </nav>
  <main>
    <section id="panel-today" role="tabpanel" aria-labelledby="tab-today"></section>
    <section id="panel-results" role="tabpanel" aria-labelledby="tab-results" hidden></section>
    <section id="panel-history" role="tabpanel" aria-labelledby="tab-history" hidden></section>
    <section id="panel-learn" role="tabpanel" aria-labelledby="tab-learn" hidden></section>
  </main>
  <footer class="foot">X への投稿・いいね・リプ・フォローは自動では行いません。「Xで開く」は X の画面を開くだけで、送信するのは社長です。</footer>
</div>
<div class="overlay" id="overlay" aria-hidden="true">
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal-head"><h2 id="modal-title"></h2><button type="button" class="btn small" id="modal-close">閉じる</button></div>
    <div class="modal-body md" id="modal-body"></div>
  </div>
</div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script type="application/json" id="xmc-data">__DATA__</script>
<script>
(function () {
  'use strict';
  let DATA;
  try {
    DATA = JSON.parse(document.getElementById('xmc-data').textContent);
  } catch (e) {
    const p = document.createElement('p');
    p.textContent = 'データを読み込めませんでした。python3 scripts/build_dashboard.py をもう一度実行してください。';
    document.querySelector('main').appendChild(p);
    return;
  }

  // ---------- 保存（localStorage が使えない環境でも壊れないように） ----------
  const mem = {};
  let lsOK = false;
  try { const k = '__xmc_test__'; window.localStorage.setItem(k, '1'); window.localStorage.removeItem(k); lsOK = true; } catch (e) { lsOK = false; }
  function sget(key, def) {
    if (lsOK) { try { const v = window.localStorage.getItem(key); if (v !== null) return JSON.parse(v); } catch (e) { /* ignore */ } }
    return Object.prototype.hasOwnProperty.call(mem, key) ? mem[key] : def;
  }
  function sset(key, val) {
    mem[key] = val;
    if (lsOK) { try { window.localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ } }
  }

  // ---------- 小さな道具 ----------
  function h(tag, props) {
    const e = document.createElement(tag);
    if (props) {
      for (const k of Object.keys(props)) {
        const v = props[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k === 'html') e.innerHTML = v;
        else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
        else if (v === true) e.setAttribute(k, '');
        else e.setAttribute(k, String(v));
      }
    }
    for (let i = 2; i < arguments.length; i++) add(e, arguments[i]);
    return e;
  }
  function add(parent, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(x => add(parent, x)); return; }
    parent.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  const SVGNS = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs, text) {
    const e = document.createElementNS(SVGNS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text !== undefined) e.textContent = text;
    return e;
  }
  const nf = new Intl.NumberFormat('ja-JP');
  const isNum = v => typeof v === 'number' && isFinite(v);
  const fmtNum = v => isNum(v) ? nf.format(Math.round(v)) : '不明';
  const fmtPct = (v, d) => isNum(v) ? (v * 100).toFixed(d === undefined ? 1 : d) + '%' : '不明';
  function compact(v) {
    if (!isNum(v)) return '不明';
    const a = Math.abs(v);
    if (a >= 1e8) return (v / 1e8).toFixed(1).replace(/\.0$/, '') + '億';
    if (a >= 1e4) return (v / 1e4).toFixed(1).replace(/\.0$/, '') + '万';
    if (a < 10 && !Number.isInteger(v)) return v.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
    return nf.format(Math.round(v));
  }
  const dayNum = d => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86400000;
  const numToDate = n => new Date(n * 86400000).toISOString().slice(0, 10);
  const mdLabel = d => (+d.slice(5, 7)) + '/' + (+d.slice(8, 10));
  const WD = ['日', '月', '火', '水', '木', '金', '土'];
  const wd = d => WD[new Date(dayNum(d) * 86400000).getUTCDay()];
  const nowJst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
  const KL = DATA.kind_labels || {};
  const safeUrl = u => typeof u === 'string' && /^https?:\/\/[^\s]+$/i.test(u) ? u : null;
  const handleOf = t => { const m = /^@?([A-Za-z0-9_]{1,15})$/.exec(String(t || '').trim()); return m ? m[1] : null; };

  let toastTimer = null;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }
  function notice(kind, msg) {
    return h('div', { class: 'notice ' + kind, role: kind === 'error' ? 'alert' : null },
      h('span', { class: 'ico', 'aria-hidden': 'true', text: kind === 'error' ? '!' : kind === 'warn' ? '!' : 'i' }), h('div', { text: msg }));
  }
  const empty = msg => h('div', { class: 'empty', text: msg });

  // ---------- コピー ----------
  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.left = '-9999px'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select(); ta.setSelectionRange(0, text.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }
  function manualCopy(text) {
    openModal('手動でコピーしてください', null, body => {
      body.appendChild(h('p', { text: 'ブラウザの設定で自動コピーが使えませんでした。下の文章を選んでコピーしてください（Ctrl+C / ⌘+C）。' }));
      const ta = h('textarea', { class: 'manual', rows: '10', readonly: true });
      ta.value = text; body.appendChild(ta);
      setTimeout(() => { ta.focus(); ta.select(); }, 30);
    });
  }
  function copyText(text, msg) {
    const done = () => toast(msg || 'コピーしました');
    const fail = () => { if (fallbackCopy(text)) done(); else manualCopy(text); };
    try {
      if (navigator.clipboard && window.isSecureContext) { navigator.clipboard.writeText(text).then(done, fail); return; }
    } catch (e) { /* fall through */ }
    fail();
  }

  // ---------- ダイアログ ----------
  const overlay = document.getElementById('overlay');
  let lastFocus = null;
  function openModal(title, htmlStr, build) {
    lastFocus = document.activeElement;
    document.getElementById('modal-title').textContent = title;
    const body = document.getElementById('modal-body');
    body.textContent = '';
    if (htmlStr) body.innerHTML = htmlStr;
    if (build) build(body);
    overlay.classList.add('open'); overlay.setAttribute('aria-hidden', 'false');
    document.getElementById('modal-close').focus();
  }
  function closeModal() {
    overlay.classList.remove('open'); overlay.setAttribute('aria-hidden', 'true');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  document.getElementById('modal-close').addEventListener('click', closeModal);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay.classList.contains('open')) closeModal(); });
  document.addEventListener('click', e => {
    const b = e.target && e.target.closest ? e.target.closest('.md-copy') : null;
    if (!b) return;
    const code = b.parentElement.querySelector('code');
    if (code) copyText(code.textContent);
  });

  // ---------- テーマ ----------
  const THEMES = ['auto', 'light', 'dark'];
  const THEME_LABEL = { auto: '自動', light: 'ライト', dark: 'ダーク' };
  let theme = sget('xmc:theme', 'auto');
  if (THEMES.indexOf(theme) < 0) theme = 'auto';
  function applyTheme() {
    if (theme === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', theme);
    document.getElementById('theme-btn').textContent = 'テーマ：' + THEME_LABEL[theme];
  }
  applyTheme();
  document.getElementById('theme-btn').addEventListener('click', () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]; sset('xmc:theme', theme); applyTheme();
  });

  // ---------- ヘッダー ----------
  const S = DATA.settings || {};
  document.getElementById('account').textContent = S.account || 'アカウント未設定（knowledge/profile.md）';
  document.getElementById('mode-badge').textContent = '運用モード：' + (S.mode || 'フォロワー増加');

  // ---------- グラフ（外部ライブラリなし・インラインSVG） ----------
  function observeWidth(node, draw) {
    let lastW = -1;
    const run = () => { const w = node.clientWidth; if (w > 0 && Math.abs(w - lastW) > 1) { lastW = w; draw(w); } };
    if ('ResizeObserver' in window) new ResizeObserver(run).observe(node);
    else window.addEventListener('resize', run);
    requestAnimationFrame(run);
  }
  function niceTicks(lo, hi, n, integer) {
    if (!isNum(lo) || !isNum(hi)) { lo = 0; hi = 1; }
    if (lo === hi) { const pad = Math.max(integer ? 1 : 0.01, Math.abs(lo) * 0.05); lo -= pad; hi += pad; }
    let step = (hi - lo) / Math.max(1, n);
    const mag = Math.pow(10, Math.floor(Math.log10(step)));
    const r = step / mag;
    step = (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * mag;
    if (integer && step < 1) step = 1;
    const a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step;
    const out = [];
    for (let v = a; v <= b + step / 2; v += step) out.push(+v.toFixed(10));
    return out;
  }
  function placeTip(tip, x, y, W) {
    tip.style.display = 'block';
    const tw = tip.offsetWidth;
    let left = x + 12;
    if (left + tw > W) left = x - tw - 12;
    tip.style.left = Math.max(0, left) + 'px';
    tip.style.top = Math.max(0, y - 48) + 'px';
  }
  function fillTip(tip, value, key) {
    tip.textContent = '';
    tip.appendChild(h('strong', { text: value }));
    tip.appendChild(h('span', { class: 'k', text: key }));
  }
  function tableView(heads, rows, numCols) {
    const nc = numCols || [];
    return h('details', { class: 'tv' }, h('summary', { text: '表で見る' }),
      h('div', { class: 'md-table' }, h('table', null,
        h('thead', null, h('tr', null, heads.map((x, i) => h('th', { class: nc.indexOf(i) >= 0 ? 'num' : null, text: x })))),
        h('tbody', null, rows.map(r => h('tr', null, r.map((c, i) => h('td', { class: nc.indexOf(i) >= 0 ? 'num' : null, text: c }))))))));
  }
  function roundedRight(x, y, w, hh, r) {
    r = Math.min(r, w, hh / 2);
    return 'M' + x + ',' + y + ' H' + (x + w - r) + ' Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) +
      ' V' + (y + hh - r) + ' Q' + (x + w) + ',' + (y + hh) + ' ' + (x + w - r) + ',' + (y + hh) + ' H' + x + ' Z';
  }
  function roundedTop(x, y, w, hh, r) {
    r = Math.min(r, w / 2, hh);
    return 'M' + x + ',' + (y + hh) + ' V' + (y + r) + ' Q' + x + ',' + y + ' ' + (x + r) + ',' + y +
      ' H' + (x + w - r) + ' Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + r) + ' V' + (y + hh) + ' Z';
  }

  // 折れ線（1系列）：十字線＋ツールチップ、キーボードの←→でも動く
  function lineChart(host, pts, o) {
    const box = h('div', { class: 'chart' });
    const tip = h('div', { class: 'tip', 'aria-hidden': 'true' });
    box.appendChild(tip); host.appendChild(box);
    const fmt = o.fmt || fmtNum;
    observeWidth(box, W => {
      box.querySelectorAll('svg').forEach(s => s.remove());
      const H = o.height || 220, m = { l: 52, r: 70, t: 14, b: 28 };
      const pw = Math.max(40, W - m.l - m.r), ph = H - m.t - m.b;
      const xs = pts.map(p => dayNum(p.d));
      const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
      const vs = pts.map(p => p.v);
      const ticks = niceTicks(o.yMin !== undefined ? o.yMin : Math.min.apply(null, vs), o.yMax !== undefined ? o.yMax : Math.max.apply(null, vs), 4, o.integer);
      const lo = ticks[0], hi = ticks[ticks.length - 1];
      const X = n => x1 === x0 ? m.l + pw / 2 : m.l + (n - x0) / (x1 - x0) * pw;
      const Y = v => m.t + ph - (v - lo) / ((hi - lo) || 1) * ph;
      const svg = sv('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, class: 'svgc', tabindex: '0', role: 'img', 'aria-label': o.label + '（←→キーで日付を移動）' });
      ticks.forEach((t, i) => {
        const y = Y(t);
        svg.appendChild(sv('line', { x1: m.l, x2: m.l + pw, y1: y, y2: y, class: i === 0 ? 'c-base' : 'c-grid' }));
        svg.appendChild(sv('text', { x: m.l - 8, y: y + 4, 'text-anchor': 'end', class: 'c-tick' }, o.tickFmt ? o.tickFmt(t) : compact(t)));
      });
      const span = Math.max(1, x1 - x0), perDay = pw / span;
      const every = Math.max(1, Math.ceil(56 / Math.max(1, perDay)));
      for (let n = x1; n >= x0; n -= every) {
        svg.appendChild(sv('text', { x: X(n), y: H - 8, 'text-anchor': 'middle', class: 'c-tick' }, mdLabel(numToDate(n))));
      }
      svg.appendChild(sv('path', { d: pts.map((p, i) => (i ? 'L' : 'M') + X(xs[i]).toFixed(1) + ',' + Y(p.v).toFixed(1)).join(' '), class: 'c-line' }));
      const last = pts.length - 1;
      svg.appendChild(sv('circle', { cx: X(xs[last]), cy: Y(pts[last].v), r: 4, class: 'c-dot' }));
      svg.appendChild(sv('text', { x: X(xs[last]) + 8, y: Y(pts[last].v) + 4, class: 'c-endlabel' }, fmt(pts[last].v)));
      const cross = sv('line', { x1: 0, x2: 0, y1: m.t, y2: m.t + ph, class: 'c-cross', visibility: 'hidden' });
      const hot = sv('circle', { r: 5, class: 'c-dot', visibility: 'hidden' });
      svg.appendChild(cross); svg.appendChild(hot);
      svg.appendChild(sv('rect', { x: m.l - 8, y: 0, width: pw + 16, height: H, fill: 'transparent' }));
      let cur = last;
      const show = i => {
        cur = i; const x = X(xs[i]), y = Y(pts[i].v);
        cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible');
        hot.setAttribute('cx', x); hot.setAttribute('cy', y); hot.setAttribute('visibility', 'visible');
        fillTip(tip, fmt(pts[i].v), pts[i].d + '（' + wd(pts[i].d) + '）' + (o.series ? '・' + o.series : ''));
        placeTip(tip, x, y, W);
      };
      const hide = () => { cross.setAttribute('visibility', 'hidden'); hot.setAttribute('visibility', 'hidden'); tip.style.display = 'none'; };
      const nearest = cx => { const r = svg.getBoundingClientRect(); const x = cx - r.left; let best = 0, bd = Infinity; xs.forEach((n, i) => { const d = Math.abs(X(n) - x); if (d < bd) { bd = d; best = i; } }); return best; };
      svg.addEventListener('pointermove', e => show(nearest(e.clientX)));
      svg.addEventListener('pointerleave', hide);
      svg.addEventListener('focus', () => show(cur));
      svg.addEventListener('blur', hide);
      svg.addEventListener('keydown', e => {
        if (e.key === 'ArrowLeft') { show(Math.max(0, cur - 1)); e.preventDefault(); }
        if (e.key === 'ArrowRight') { show(Math.min(last, cur + 1)); e.preventDefault(); }
      });
      box.insertBefore(svg, tip);
    });
    host.appendChild(tableView([o.xName || '日付', o.series || '値'].concat(o.extraHeads || []),
      pts.map(p => [p.d + '（' + wd(p.d) + '）', fmt(p.v)].concat(p.extra || [])), [1]));
  }

  // 横棒（1系列）：棒ごとにツールチップ
  function hBarChart(host, rows, o) {
    const box = h('div', { class: 'chart' });
    const tip = h('div', { class: 'tip', 'aria-hidden': 'true' });
    box.appendChild(tip); host.appendChild(box);
    const fmt = o.fmt || fmtNum;
    observeWidth(box, W => {
      box.querySelectorAll('svg').forEach(s => s.remove());
      const rowH = 46, barH = 14, right = 76;
      const H = rows.length * rowH + 4;
      const pw = Math.max(40, W - right);
      const max = Math.max.apply(null, rows.map(r => isNum(r.v) ? r.v : 0)) || 1;
      const svg = sv('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, class: 'svgc', role: 'img', 'aria-label': o.label });
      rows.forEach((r, i) => {
        const y0 = i * rowH + 2, by = y0 + 22;
        const bw = isNum(r.v) && r.v > 0 ? Math.max(2, r.v / max * pw) : 0;
        const valueText = isNum(r.v) ? fmt(r.v) : '不明';
        svg.appendChild(sv('text', { x: 0, y: y0 + 14, class: 'c-label' }, r.label + (r.sub ? '（' + r.sub + '）' : '')));
        svg.appendChild(sv('line', { x1: 0.5, x2: 0.5, y1: by - 3, y2: by + barH + 3, class: 'c-base' }));
        let bar = null;
        if (bw > 0) { bar = sv('path', { d: roundedRight(0, by, bw, barH, 4), class: 'c-bar' }); svg.appendChild(bar); }
        svg.appendChild(sv('text', { x: bw + 6, y: by + barH - 2, class: 'c-value' }, valueText));
        const hit = sv('rect', { x: 0, y: y0, width: W, height: rowH, class: 'c-hit', tabindex: '0', role: 'img', 'aria-label': r.label + '：' + valueText + (r.sub ? '（' + r.sub + '）' : '') });
        const show = () => { if (bar) bar.classList.add('hot'); fillTip(tip, valueText, r.label + (r.sub ? '・' + r.sub : '')); placeTip(tip, Math.min(bw, pw - 40), by, W); };
        const hide = () => { if (bar) bar.classList.remove('hot'); tip.style.display = 'none'; };
        hit.addEventListener('pointerenter', show); hit.addEventListener('pointerleave', hide);
        hit.addEventListener('focus', show); hit.addEventListener('blur', hide);
        svg.appendChild(hit);
      });
      box.insertBefore(svg, tip);
    });
    host.appendChild(tableView([o.catName || '区分', o.series || '値', '本数'],
      rows.map(r => [r.label, isNum(r.v) ? fmt(r.v) : '不明', r.n !== undefined ? String(r.n) : '']), [1, 2]));
  }

  // 縦棒（1系列・日別）：最大と最新だけ数字を出す
  function colChart(host, rows, o) {
    const box = h('div', { class: 'chart' });
    const tip = h('div', { class: 'tip', 'aria-hidden': 'true' });
    box.appendChild(tip); host.appendChild(box);
    observeWidth(box, W => {
      box.querySelectorAll('svg').forEach(s => s.remove());
      const H = o.height || 200, m = { l: 36, r: 8, t: 22, b: 28 };
      const pw = Math.max(40, W - m.l - m.r), ph = H - m.t - m.b;
      const max = Math.max.apply(null, rows.map(r => r.v)) || 1;
      const ticks = niceTicks(0, max, 3, true);
      const top = ticks[ticks.length - 1];
      const Y = v => m.t + ph - v / (top || 1) * ph;
      const band = pw / rows.length, cw = Math.min(24, Math.max(2, band - 2));
      const svg = sv('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, class: 'svgc', role: 'img', 'aria-label': o.label });
      ticks.forEach((t, i) => {
        svg.appendChild(sv('line', { x1: m.l, x2: m.l + pw, y1: Y(t), y2: Y(t), class: i === 0 ? 'c-base' : 'c-grid' }));
        svg.appendChild(sv('text', { x: m.l - 8, y: Y(t) + 4, 'text-anchor': 'end', class: 'c-tick' }, String(t)));
      });
      const every = Math.max(1, Math.ceil(44 / band));
      let maxI = 0; rows.forEach((r, i) => { if (r.v >= rows[maxI].v) maxI = i; });
      rows.forEach((r, i) => {
        const cx = m.l + i * band + band / 2, x = cx - cw / 2;
        let col = null;
        if (r.v > 0) { col = sv('path', { d: roundedTop(x, Y(r.v), cw, Y(0) - Y(r.v), Math.min(4, cw / 2)), class: 'c-bar' }); svg.appendChild(col); }
        if ((rows.length - 1 - i) % every === 0) svg.appendChild(sv('text', { x: cx, y: H - 8, 'text-anchor': 'middle', class: 'c-tick' }, mdLabel(r.d)));
        if (r.v > 0 && (i === maxI || i === rows.length - 1)) svg.appendChild(sv('text', { x: cx, y: Y(r.v) - 6, 'text-anchor': 'middle', class: 'c-value' }, String(r.v)));
        const hit = sv('rect', { x: m.l + i * band, y: m.t, width: band, height: ph, class: 'c-hit', tabindex: '0', role: 'img', 'aria-label': r.d + '：' + r.v + (o.unit || '') });
        const show = () => { if (col) col.classList.add('hot'); fillTip(tip, r.v + (o.unit || ''), r.d + '（' + wd(r.d) + '）'); placeTip(tip, cx, Y(r.v), W); };
        const hide = () => { if (col) col.classList.remove('hot'); tip.style.display = 'none'; };
        hit.addEventListener('pointerenter', show); hit.addEventListener('pointerleave', hide);
        hit.addEventListener('focus', show); hit.addEventListener('blur', hide);
        svg.appendChild(hit);
      });
      box.insertBefore(svg, tip);
    });
    host.appendChild(tableView(['日付', o.series || '値'], rows.map(r => [r.d + '（' + wd(r.d) + '）', r.v + (o.unit || '')]), [1]));
  }

  // ---------- 状態の表示 ----------
  const STATUS_META = {
    done: { label: '提出済み', icon: '✓', cls: 'st-done', b: 'b-good' },
    returned: { label: '差し戻し修正済み', icon: '↺', cls: 'st-returned', b: 'b-warning' },
    ng: { label: '修正後もNG', icon: '✕', cls: 'st-ng', b: 'b-critical' },
    skipped: { label: '稼働なし', icon: '–', cls: 'st-skipped', b: 'b-neutral' },
    missing: { label: '未提出', icon: '!', cls: 'st-missing', b: 'b-serious' },
    none: { label: 'データなし', icon: '–', cls: 'st-skipped', b: 'b-neutral' }
  };
  const CHECK_META = {
    'OK': { label: 'OK', icon: '✓', b: 'b-good' },
    '要修正': { label: '要修正', icon: '!', b: 'b-warning' },
    'NG': { label: 'NG', icon: '✕', b: 'b-critical' }
  };
  const badge = (meta) => h('span', { class: 'badge ' + meta.b }, h('span', { class: 'i', 'aria-hidden': 'true', text: meta.icon }), meta.label);

  // ---------- 「Xで開く」 ----------
  const intent = text => 'https://x.com/intent/post?text=' + encodeURIComponent(text);
  function openPlan(it) {
    const text = it.text || '';
    const target = safeUrl(it.target_url);
    switch (it.kind) {
      case 'reply':
      case 'mention-reply':
        return target ? { url: target, copy: true, msg: '本文をコピーしました。開いた投稿の「返信」に貼り付けて送ってください' }
          : { url: null, why: '相手の投稿URLが不明です（inbox/ に URL を貼ると開けます）。コピーして手動で返信してください' };
      case 'quote':
        return target ? { url: target, copy: true, msg: '本文をコピーしました。開いた投稿の「リポスト → 引用」から貼り付けてください' }
          : { url: intent(text), msg: '引用元のURLが不明なので、本文だけで投稿画面を開きました' };
      case 'like': {
        const hd = handleOf(it.target);
        return target ? { url: target } : hd ? { url: 'https://x.com/' + hd } : { url: null, why: '相手のアカウントが不明です' };
      }
      case 'article': {
        const m = /^article-(\d+)$/.exec(it.id || '');
        if (m && +m[1] >= 2) return { url: null, why: 'スレッドの2本目以降は、前の投稿への「返信」として貼り付けてください（コピーを使ってください）' };
        return { url: intent(text) };
      }
      case 'monetize':
        if (/プロフィール/.test(it.type || '')) return { url: 'https://x.com/settings/profile', copy: true, msg: 'プロフィール文をコピーしました。開いた画面の「自己紹介」に貼り付けてください' };
        return { url: intent(text), msg: /固定/.test(it.type || '') ? '投稿したら、プロフィールでその投稿を「固定」してください' : null };
      default:
        return { url: intent(text) };
    }
  }
  function openX(it) {
    const plan = openPlan(it);
    if (!plan.url) { toast(plan.why || '開けるページがありません'); return; }
    if (plan.copy && it.text) copyText(it.text, plan.msg);
    else if (plan.msg) toast(plan.msg);
    window.open(plan.url, '_blank', 'noopener');
  }

  // ---------- 投稿済みチェック ----------
  const postedKey = (date, id) => 'xmc:posted:' + date + '#' + id;
  function bulkLog(date, items) {
    const lines = ['/x-log'];
    let n = 0;
    items.forEach(it => {
      if (it.kind === 'like' || it._logged || !it.text) return;
      const s = sget(postedKey(date, it.id), null);
      if (!s || !s.on) return;
      n++;
      lines.push('---', 'id: ' + date + '#' + it.id, 'kind: ' + it.kind, 'type: ' + (it.type || ''), 'posted_at: ' + (s.at || ''), 'url: ' + (s.url || ''), '本文:', it.text);
    });
    lines.push('---');
    return { text: lines.join('\n'), count: n };
  }

  // ================================================================ タブ1：今日
  function renderToday(root) {
    const date = DATA.display_date;
    const day = DATA.days[date] || {};
    const status = day.status || null;
    const approval = day.approval || null;
    const items = approval && Array.isArray(approval.items) ? approval.items : [];

    if (!DATA.initialized) root.appendChild(notice('warn', '初期設定がまだです：x-marketing フォルダで「bash scripts/init.sh」を実行してください。'));
    if (date !== DATA.today) {
      root.appendChild(notice('info', '今日（' + DATA.today + '）の /x-morning はまだ実行されていません。' + (DATA.days[date] ? '表示しているのは ' + date + ' のデータです。' : '')));
    }
    if (day.status_error) root.appendChild(notice('error', 'status.json を読めませんでした（' + day.status_error + '）。/x-morning の手順10で buzz-director に作り直してもらってください。'));
    if (day.approval_error) root.appendChild(notice('error', 'approval.json を読めませんでした（' + day.approval_error + '）。/x-morning の手順10で buzz-director に作り直してもらってください。'));

    // 上部：日付・テーマ・判断が必要なこと
    const hero = h('div', { class: 'card hero' },
      h('div', { class: 'hero-date', text: date + '（' + wd(date) + '）' }),
      h('div', { class: 'hero-theme' }, h('span', { class: 'lbl', text: 'テーマ方針' }),
        h('span', { text: status && status.theme ? status.theme : 'データがありません：/x-morning を実行してください' })));
    const decisions = status && Array.isArray(status.decisions) ? status.decisions : [];
    hero.appendChild(h('h3', { text: '社長の判断が必要なこと' }));
    if (decisions.length) {
      hero.appendChild(h('ul', { class: 'checks' }, decisions.map((d, i) => {
        const key = 'xmc:decision:' + date + ':' + i;
        const cb = h('input', { type: 'checkbox' });
        const span = h('span', { text: d });
        cb.checked = !!sget(key, false);
        span.className = cb.checked ? 'done-text' : '';
        cb.addEventListener('change', () => { sset(key, cb.checked); span.className = cb.checked ? 'done-text' : ''; });
        return h('li', null, h('label', null, cb, span));
      })));
    } else {
      hero.appendChild(empty(status ? '今日はありません' : 'データがありません：/x-morning を実行してください'));
    }
    root.appendChild(hero);

    // チーム稼働ボード
    const board = h('div', { class: 'card' }, h('h2', null, 'チーム稼働ボード', h('span', { class: 'count', text: 'カードを押すと提出物を表示' })));
    const byName = {};
    (status && Array.isArray(status.teams) ? status.teams : []).forEach(t => { if (t && t.name) byName[t.name] = t; });
    const files = day.files || {};
    const grid = h('div', { class: 'teams' });
    DATA.teams.forEach(team => {
      const t = byName[team.name];
      let st = t && STATUS_META[t.status] ? t.status : null;
      let note = t && typeof t.note === 'string' ? t.note : '';
      const fname = (t && typeof t.file === 'string' && t.file) || team.file;
      const has = Object.prototype.hasOwnProperty.call(files, fname);
      if (!st) {
        if (!status && !Object.keys(files).length) { st = 'none'; note = '/x-morning を実行すると表示されます'; }
        else { st = has ? 'done' : 'missing'; note = status ? 'status.json に記載がありません' : 'status.json がないため、ファイルの有無から推定'; }
      }
      const meta = STATUS_META[st];
      const nums = t ? '件数 ' + (isNum(t.items) ? t.items : '—') + '／NG ' + (isNum(t.ng) ? t.ng : '—') : '';
      grid.appendChild(h('button', {
        type: 'button', class: 'team ' + meta.cls, 'aria-label': team.label + '（' + team.name + '）：' + meta.label + '。押すと ' + fname + ' を表示',
        onclick: () => {
          if (has) openModal(team.label + '｜' + fname, files[fname]);
          else openModal(team.label + '｜' + fname, null, b => b.appendChild(empty('このチームの提出物（' + fname + '）はありません。')));
        }
      }, h('span', { class: 'name', text: team.label }), h('span', { class: 'en', text: team.name }), badge(meta),
        nums ? h('span', { class: 'nums', text: nums }) : null, note ? h('span', { class: 'note', text: note }) : null));
    });
    board.appendChild(grid);
    const others = (day.file_names || []).filter(n => !DATA.teams.some(t => t.file === n));
    if (others.length) {
      board.appendChild(h('div', { class: 'files' }, h('span', { class: 'lbl', text: 'そのほかのファイル' }),
        others.map(n => h('button', { type: 'button', class: 'btn small', text: n, onclick: () => openModal(n, files[n] || '') }))));
    }
    root.appendChild(board);

    // 承認キュー
    const queueCard = h('div', { class: 'card' });
    const qItems = items.filter(it => it.kind !== 'like').slice().sort((a, b) => {
      const ta = a.time || '99:99', tb = b.time || '99:99';
      if (ta !== tb) return ta < tb ? -1 : 1;
      const ka = Object.keys(KL).indexOf(a.kind), kb = Object.keys(KL).indexOf(b.kind);
      if (ka !== kb) return ka - kb;
      return (isNum(a.rank) ? a.rank : 99) - (isNum(b.rank) ? b.rank : 99);
    });
    const likes = items.filter(it => it.kind === 'like');
    queueCard.appendChild(h('h2', null, '承認キュー', h('span', { class: 'count', text: qItems.length + '件（時間順）' + (likes.length ? '・いいね ' + likes.length + '件は下の「いいね回り」' : '') })));
    if (!qItems.length) {
      queueCard.appendChild(empty(approval ? '承認待ちのアイテムはありません' : 'データがありません：/x-morning を実行してください'));
    } else {
      const kinds = Object.keys(KL).filter(k => k !== 'like' && qItems.some(it => it.kind === k));
      let filter = sget('xmc:filter', 'all');
      if (filter !== 'all' && filter !== 'rec' && kinds.indexOf(filter) < 0) filter = 'all';
      const chips = h('div', { class: 'chips', role: 'group', 'aria-label': '種類で絞り込む' });
      const list = h('div', { class: 'queue' });
      const chipDefs = [['all', 'すべて', qItems.length], ['rec', 'おすすめだけ', qItems.filter(i => i.recommended).length]]
        .concat(kinds.map(k => [k, KL[k], qItems.filter(i => i.kind === k).length]));
      const chipEls = chipDefs.map(([k, label, n]) => h('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(filter === k), text: label + '（' + n + '）',
        onclick: () => { filter = k; sset('xmc:filter', k); chipEls.forEach((c, i) => c.setAttribute('aria-pressed', String(chipDefs[i][0] === k))); drawList(); }
      }));
      chipEls.forEach(c => chips.appendChild(c));
      const bulkBtn = h('button', { type: 'button', class: 'btn primary' });
      const bulkInfo = h('span', { class: 'hint', style: 'margin:0' });
      const updateBulk = () => {
        const b = bulkLog(date, items);
        bulkBtn.textContent = '「投稿済み」' + b.count + '件を /x-log 用にまとめてコピー';
        bulkBtn.disabled = b.count === 0;
        bulkInfo.textContent = b.count ? 'コピーしたら Claude Code に貼り付けて送信すると記録されます' : '投稿したら「投稿済み」にチェック（URLは任意）';
      };
      bulkBtn.addEventListener('click', () => { const b = bulkLog(date, items); if (b.count) copyText(b.text, '/x-log 用のテキストをコピーしました。Claude Code に貼り付けてください'); });
      function drawList() {
        list.textContent = '';
        qItems.filter(it => filter === 'all' || (filter === 'rec' ? it.recommended : it.kind === filter))
          .forEach(it => list.appendChild(itemCard(date, it, updateBulk)));
        if (!list.children.length) list.appendChild(empty('この条件のアイテムはありません'));
      }
      drawList();
      updateBulk();
      queueCard.appendChild(chips);
      queueCard.appendChild(list);
      queueCard.appendChild(h('div', { class: 'bulk' }, bulkBtn, bulkInfo));
    }
    root.appendChild(queueCard);

    // いいね回り
    root.appendChild(likeSection(date, likes, !!approval));

    // 社長にお願いしたい作業
    root.appendChild(requestSection(status));
  }

  function itemCard(date, it, onChange) {
    const key = postedKey(date, it.id);
    const saved = sget(key, null) || {};
    const limit = isNum(it._limit) ? it._limit : 280;
    const chars = isNum(it._chars) ? it._chars : (isNum(it.chars) ? it.chars : 0);
    const over = chars > limit;
    const cm = CHECK_META[it.check];
    const card = h('article', { class: 'item' + (it.recommended ? ' rec' : '') + (it.check === 'NG' ? ' is-ng' : '') });
    card.appendChild(h('div', { class: 'item-head' },
      h('span', { class: 'time', text: it.time || '時間指定なし' }),
      h('span', { class: 'kind', text: KL[it.kind] || it.kind }),
      it.type ? h('span', { class: 'type', text: it.type }) : null,
      isNum(it.rank) ? h('span', { class: 'type', text: it.rank + '位' }) : null,
      it.recommended ? h('span', { class: 'rec-badge', text: '★ おすすめ' }) : null,
      h('span', { class: 'push-right' }, cm ? badge(cm) : h('span', { class: 'type', text: 'チェック：' + (it.check || '不明') }))));
    if (it.text) card.appendChild(h('div', { class: 'post-text', text: it.text }));
    else card.appendChild(h('div', { class: 'post-text', text: '（返信しない推奨）' }));
    if (it.target || safeUrl(it.target_url)) {
      card.appendChild(h('div', { class: 'target' }, h('span', { text: '相手：' + (it.target || '不明') }),
        safeUrl(it.target_url) ? h('a', { href: safeUrl(it.target_url), target: '_blank', rel: 'noopener noreferrer', text: '投稿を開く ↗' }) : h('span', { text: '（投稿URL不明）' })));
    }
    if (it.text) {
      const pct = Math.min(100, chars / limit * 100);
      card.appendChild(h('div', { class: 'charline' },
        h('div', { class: 'meter' + (over ? ' over' : ''), role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': String(limit), 'aria-valuenow': String(chars), 'aria-label': '文字数' }, h('span', { style: 'width:' + pct.toFixed(1) + '%' })),
        h('span', { class: 'chars', text: (limit === 280 ? '重み付き ' + chars + ' / 280（全角換算 ' + (chars / 2) + '字）' : chars + ' / ' + limit + '字') + (over ? '　上限オーバー' : '') })));
      if (it._chars_mismatch) card.appendChild(h('div', { class: 'warn-text', text: '※ approval.json の文字数（' + it.chars + '）と、本文を数え直した値（' + chars + '）が違います。表示は数え直した値です' }));
    }
    if (it.reason) card.appendChild(h('p', { class: 'reason' }, h('span', { class: 'lbl', text: '狙い' }), h('span', { text: it.reason })));
    if (!it.text) return card;
    const plan = openPlan(it);
    const actions = h('div', { class: 'actions' });
    actions.appendChild(h('button', { type: 'button', class: 'btn', text: 'コピー', onclick: () => copyText(it.text) }));
    actions.appendChild(h('button', { type: 'button', class: 'btn primary', text: 'Xで開く ↗', title: plan.url ? '' : (plan.why || ''), disabled: !plan.url, onclick: () => openX(it) }));
    if (!plan.url && plan.why) actions.appendChild(h('span', { class: 'hint', style: 'margin:0', text: plan.why }));
    if (it._logged) {
      actions.appendChild(h('span', { class: 'logged' }, badge({ label: '/x-log で記録済み', icon: '✓', b: 'b-good' })));
    } else {
      const cb = h('input', { type: 'checkbox' });
      cb.checked = !!saved.on;
      const urlIn = h('input', { type: 'url', class: 'url-in', placeholder: '投稿URL（任意）https://x.com/…', 'aria-label': '投稿URL（任意）' });
      urlIn.value = saved.url || '';
      urlIn.hidden = !cb.checked;
      const at = h('span', { class: 'logged', text: saved.on && saved.at ? saved.at + ' に投稿' : '' });
      cb.addEventListener('change', () => {
        const s = sget(key, null) || {};
        s.on = cb.checked; s.at = cb.checked ? (s.at || nowJst()) : ''; if (!cb.checked) s.url = s.url || '';
        sset(key, s); urlIn.hidden = !cb.checked; at.textContent = s.on ? s.at + ' に投稿' : '';
        onChange();
      });
      urlIn.addEventListener('input', () => { const s = sget(key, null) || {}; s.url = urlIn.value.trim(); sset(key, s); onChange(); });
      actions.appendChild(h('label', { class: 'posted' }, cb, '投稿済み'));
      actions.appendChild(at);
      actions.appendChild(urlIn);
    }
    card.appendChild(actions);
    return card;
  }

  function likeSection(date, likes, hasApproval) {
    const card = h('div', { class: 'card' }, h('h2', null, 'いいね回り', h('span', { class: 'count', text: '1日40件まで・朝／昼／夜に分けて' })));
    if (!likes.length) { card.appendChild(empty(hasApproval ? '今日のいいねリストはありません' : 'データがありません：/x-morning を実行してください')); return card; }
    const keys = likes.map(it => 'xmc:like:' + date + '#' + it.id);
    const bar = h('span', { style: 'width:0%' });
    const label = h('span', { class: 'chars' });
    const update = () => {
      const n = keys.filter(k => sget(k, false)).length;
      label.textContent = '進捗 ' + n + '/40（リスト ' + likes.length + '件）';
      bar.style.width = Math.min(100, n / 40 * 100) + '%';
    };
    card.appendChild(h('div', { class: 'prog' }, h('div', { class: 'meter', role: 'progressbar', 'aria-label': 'いいねの進捗' }, bar), label));
    const SLOT = { '07:00': '朝（07:00）', '12:00': '昼（12:00）', '21:00': '夜（21:00）' };
    const groups = {};
    likes.forEach((it, i) => { const g = it.time || 'その他'; (groups[g] = groups[g] || []).push([it, keys[i]]); });
    const wrap = h('div', { class: 'like-groups' });
    Object.keys(groups).sort().forEach(g => {
      wrap.appendChild(h('div', { class: 'like-group' }, h('h3', { text: (SLOT[g] || g) + '・' + groups[g].length + '件' }),
        h('ul', { class: 'likes' }, groups[g].map(([it, key]) => {
          const cb = h('input', { type: 'checkbox' });
          cb.checked = !!sget(key, false);
          cb.addEventListener('change', () => { sset(key, cb.checked); update(); });
          const hd = handleOf(it.target);
          const link = safeUrl(it.target_url) || (hd ? 'https://x.com/' + hd : null);
          return h('li', null, h('label', null, cb, h('span', null,
            h('span', { class: 'kind', text: it.type || '優先度不明' }), ' ',
            link ? h('a', { href: link, target: '_blank', rel: 'noopener noreferrer', text: it.target || link }) : h('span', { text: it.target || '不明' }),
            it.reason ? h('span', { class: 'why', text: it.reason }) : null)));
        }))));
    });
    card.appendChild(wrap);
    update();
    return card;
  }

  function requestSection(status) {
    const card = h('div', { class: 'card' }, h('h2', { text: '社長にお願いしたい作業' }));
    const reqs = status && Array.isArray(status.requests) ? status.requests : [];
    if (reqs.length) card.appendChild(h('ul', null, reqs.map(r => h('li', { text: r }))));
    else card.appendChild(empty(status ? '今日のお願いはありません' : 'データがありません：/x-morning を実行してください'));
    card.appendChild(h('h3', { text: 'inbox/ の更新状況' }));
    const STATE = { ok: ['s-ok', 'OK'], stale: ['s-stale', '古くなっています'], empty: ['s-empty', '中身がありません'], missing: ['s-missing', 'ファイルがありません'] };
    const rows = (DATA.inbox || []).map(e => {
      let st = STATE[e.state] || ['s-info', '—'];
      if (e.state === 'ok' && e.stale_days === null) st = ['s-info', '確認用'];
      const age = isNum(e.age_days) ? (e.age_days < 1 ? Math.round(e.age_days * 24) + '時間前' : e.age_days.toFixed(1) + '日前') : '—';
      const warn = e.state === 'stale' || e.state === 'empty' || e.state === 'missing';
      const rule = e.stale_days ? e.stale_days + '日以上たつと警告' : '';
      return h('tr', { class: warn ? 'warnrow' : null },
        h('td', null, h('strong', { text: 'inbox/' + e.name }), h('div', { class: 'hint', style: 'margin:0', text: e.desc + (e.has_example ? '（記入例が残っています）' : '') })),
        h('td', { class: 'num', text: e.mtime || '—' }), h('td', { class: 'num', text: age }),
        h('td', null, h('span', { class: 'state ' + st[0], text: st[1] }), rule ? h('div', { class: 'hint', style: 'margin:0', text: rule }) : null));
    });
    card.appendChild(h('div', { class: 'md-table' }, h('table', null,
      h('thead', null, h('tr', null, h('th', { text: 'ファイル' }), h('th', { class: 'num', text: '最終更新' }), h('th', { class: 'num', text: '経過' }), h('th', { text: '状態' }))),
      h('tbody', null, rows))));
    return card;
  }

  // ================================================================ タブ2：成果
  function computeKpis() {
    const rows = (DATA.metrics || []).slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    if (!rows.length) return null;
    const L = dayNum(rows[rows.length - 1].date);
    const fAt = n => { let v = null; rows.forEach(r => { if (dayNum(r.date) <= n && isNum(r.followers)) v = r.followers; }); return v; };
    const sumK = (a, b, k) => { let s = 0, c = 0; rows.forEach(r => { const n = dayNum(r.date); if (n >= a && n <= b && isNum(r[k])) { s += r[k]; c++; } }); return c ? s : null; };
    const erMetrics = (a, b) => {
      const imp = sumK(a, b, 'impressions'); if (!imp) return null;
      let e = 0, c = 0; ['likes', 'reposts', 'replies', 'bookmarks'].forEach(k => { const s = sumK(a, b, k); if (s !== null) { e += s; c++; } });
      return c ? e / imp : null;
    };
    const erPosts = (a, b) => {
      const v = (DATA.performance || []).filter(p => p.date && dayNum(p.date) >= a && dayNum(p.date) <= b && isNum(p.engagement_rate)).map(p => p.engagement_rate);
      return v.length ? v.reduce((x, y) => x + y, 0) / v.length : null;
    };
    const er = (a, b) => { const m = erMetrics(a, b); return m !== null ? m : erPosts(a, b); };
    const f0 = fAt(L), f7 = fAt(L - 7), f14 = fAt(L - 14);
    const ch = f0 !== null && f7 !== null ? f0 - f7 : null;
    const chPrev = f7 !== null && f14 !== null ? f7 - f14 : null;
    const pc = sumK(L - 6, L, 'profile_clicks'), pcPrev = sumK(L - 13, L - 7, 'profile_clicks');
    return {
      start: numToDate(L - 6), end: numToDate(L), f0, f7, ch, chPrev,
      imp: sumK(L - 6, L, 'impressions'), impPrev: sumK(L - 13, L - 7, 'impressions'),
      er: er(L - 6, L), erPrev: er(L - 13, L - 7), pc, pcPrev,
      fr: ch !== null && pc ? ch / pc : null, frPrev: chPrev !== null && pcPrev ? chPrev / pcPrev : null,
      line: sumK(L - 6, L, 'line_signups'), linePrev: sumK(L - 13, L - 7, 'line_signups')
    };
  }
  function deltaDiff(cur, prev, unit) {
    if (!isNum(cur) || !isNum(prev)) return { text: '前週比 不明', good: null };
    const d = cur - prev;
    return { text: (d > 0 ? '▲ +' : d < 0 ? '▼ −' : '± ') + nf.format(Math.abs(Math.round(d))) + (unit || '') + '（前週比）', good: d > 0 ? true : d < 0 ? false : null };
  }
  function deltaPct(cur, prev) {
    if (!isNum(cur) || !isNum(prev) || prev <= 0) return { text: '前週比 不明', good: null };
    const d = (cur - prev) / prev;
    return { text: (d > 0 ? '▲ +' : d < 0 ? '▼ −' : '± ') + Math.abs(d * 100).toFixed(1) + '%（前週比）', good: d > 0 ? true : d < 0 ? false : null };
  }
  function deltaPt(cur, prev) {
    if (!isNum(cur) || !isNum(prev)) return { text: '前週比 不明', good: null };
    const d = (cur - prev) * 100;
    return { text: (d > 0 ? '▲ +' : d < 0 ? '▼ −' : '± ') + Math.abs(d).toFixed(1) + 'pt（前週比）', good: d > 0.05 ? true : d < -0.05 ? false : null };
  }
  function tile(label, value, delta, note) {
    return h('div', { class: 'kpi card' }, h('div', { class: 'label', text: label }), h('div', { class: 'value', text: value }),
      delta ? h('div', { class: 'delta' + (delta.good === true ? ' up' : delta.good === false ? ' down' : ''), text: delta.text }) : null,
      note ? h('div', { class: 'note', text: note }) : null);
  }
  const NO_STATS = 'データがありません：X のアナリティクスの数字（フォロワー数・表示回数など）を inbox/stats/ に貼って /x-weekly を実行してください';
  const NO_PERF = 'データがありません：投稿ごとの数字（表示回数・いいねなど）を inbox/stats/ に貼って /x-weekly を実行してください';
  const NO_POSTED = 'データがありません：投稿したら /x-log で記録してください';

  function renderResults(root) {
    const k = computeKpis();
    const monet = S.mode === '収益化';
    const kc = h('div', { class: 'card' }, h('h2', null, '今週の数字', h('span', { class: 'count', text: k ? '集計期間 ' + k.start + '〜' + k.end + '（metrics.csv の最新日まで）' : '' })));
    if (DATA.errors && DATA.errors.metrics) kc.appendChild(notice('warn', DATA.errors.metrics));
    if (!k) kc.appendChild(empty(NO_STATS));
    else {
      const tiles = [
        tile('フォロワー数', fmtNum(k.f0), deltaDiff(k.f0, k.f7, '人')),
        tile('増減（7日間）', isNum(k.ch) ? (k.ch > 0 ? '+' : '') + fmtNum(k.ch) : '不明', deltaDiff(k.ch, k.chPrev, '人')),
        tile('インプレッション（7日間）', compact(k.imp), deltaPct(k.imp, k.impPrev)),
        tile('エンゲージメント率（7日平均）', fmtPct(k.er, 2), deltaPt(k.er, k.erPrev)),
        tile('プロフィールクリック（7日間）', fmtNum(k.pc), deltaPct(k.pc, k.pcPrev))
      ];
      if (monet) tiles.push(tile('LINE登録数（7日間）', fmtNum(k.line), deltaDiff(k.line, k.linePrev, '人')));
      else tiles.push(tile('フォロー率（7日間）', fmtPct(k.fr, 1), deltaPt(k.fr, k.frPrev), 'フォロワー増 ÷ プロフィールクリック'));
      kc.appendChild(h('div', { class: 'kpis' }, tiles));
    }
    root.appendChild(kc);

    // 期間フィルター（下のグラフすべてに効く）
    let range = sget('xmc:range', 30);
    if ([30, 90, 0].indexOf(range) < 0) range = 30;
    const filters = h('div', { class: 'filters', role: 'group', 'aria-label': 'グラフの期間' }, h('span', { class: 'lbl2', text: 'グラフの期間' }));
    const opts = [[30, '30日'], [90, '90日'], [0, 'すべて']];
    const chipEls = opts.map(([v, label]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(range === v), text: label, onclick: () => { range = v; sset('xmc:range', v); chipEls.forEach((c, i) => c.setAttribute('aria-pressed', String(opts[i][0] === v))); draw(); } }));
    chipEls.forEach(c => filters.appendChild(c));
    root.appendChild(filters);
    const area = h('div');
    root.appendChild(area);

    function draw() {
      area.textContent = '';
      const end = dayNum(DATA.today);
      const inR = d => d && (range === 0 || (dayNum(d) > end - range && dayNum(d) <= end));
      const g1 = h('div', { class: 'grid' });
      area.appendChild(g1);

      const fc = h('div', { class: 'card' }, h('h2', { text: 'フォロワー推移' }));
      const fpts = (DATA.metrics || []).filter(r => inR(r.date) && isNum(r.followers)).map(r => ({ d: r.date, v: r.followers }));
      if (fpts.length) lineChart(fc, fpts, { label: 'フォロワー推移', series: 'フォロワー数', integer: true, fmt: v => fmtNum(v) + '人' });
      else fc.appendChild(empty(NO_STATS));
      g1.appendChild(fc);

      const g2 = h('div', { class: 'grid cols-2' });
      area.appendChild(h('div', { style: 'height:16px' }));
      area.appendChild(g2);
      const perf = (DATA.performance || []).filter(p => range === 0 || inR(p.date));

      const tc = h('div', { class: 'card' }, h('h2', { text: '型別の平均エンゲージメント率' }), h('p', { class: 'hint', text: '(いいね＋リポスト＋返信＋ブックマーク) ÷ 表示回数' }));
      const byType = {};
      perf.forEach(p => { if (!isNum(p.engagement_rate)) return; const t = p.type || '不明'; (byType[t] = byType[t] || []).push(p.engagement_rate); });
      const tRows = Object.keys(byType).map(t => ({ label: t, v: byType[t].reduce((a, b) => a + b, 0) / byType[t].length, n: byType[t].length, sub: byType[t].length + '本' })).sort((a, b) => b.v - a.v);
      if (tRows.length) hBarChart(tc, tRows, { label: '型別の平均エンゲージメント率', series: '平均エンゲージメント率', catName: '型', fmt: v => fmtPct(v, 2) });
      else tc.appendChild(empty(NO_PERF));
      g2.appendChild(tc);

      const sc = h('div', { class: 'card' }, h('h2', { text: '時間帯別の平均インプレッション' }), h('p', { class: 'hint', text: '朝5〜9時／昼10〜14時／夕方15〜18時／夜19〜23時／深夜0〜4時' }));
      const bySlot = {};
      perf.forEach(p => { if (!isNum(p.impressions)) return; const s = p.time_slot || '不明'; (bySlot[s] = bySlot[s] || []).push(p.impressions); });
      const ORDER = ['朝', '昼', '夕方', '夜', '深夜', '不明'];
      const sRows = Object.keys(bySlot).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).map(s => ({ label: s, v: bySlot[s].reduce((a, b) => a + b, 0) / bySlot[s].length, n: bySlot[s].length, sub: bySlot[s].length + '本' }));
      if (sRows.length) hBarChart(sc, sRows, { label: '時間帯別の平均インプレッション', series: '平均インプレッション', catName: '時間帯', fmt: v => fmtNum(v) });
      else sc.appendChild(empty(NO_PERF));
      g2.appendChild(sc);

      const topc = h('div', { class: 'card' }, h('h2', { text: '伸びた投稿 TOP5' }), h('p', { class: 'hint', text: '表示回数の多い順（post_performance.csv）' }));
      const top = perf.filter(p => isNum(p.impressions)).sort((a, b) => b.impressions - a.impressions).slice(0, 5);
      if (top.length) {
        topc.appendChild(h('div', { class: 'md-table' }, h('table', null,
          h('thead', null, h('tr', null, ['#', '投稿日時', '型', '本文', '表示回数', 'いいね', 'ER'].map((x, i) => h('th', { class: i >= 4 || i === 0 ? 'num' : null, text: x })))),
          h('tbody', null, top.map((p, i) => h('tr', null,
            h('td', { class: 'num', text: String(i + 1) }), h('td', { class: 'nowrap', text: p.posted_at || '不明' }), h('td', { class: 'nowrap', text: p.type || (KL[p.kind] || '不明') }),
            h('td', null, safeUrl(p.url) ? h('a', { href: safeUrl(p.url), target: '_blank', rel: 'noopener noreferrer', text: (p.text || '本文不明').split('\n')[0].slice(0, 40) }) : (p.text || '本文不明').split('\n')[0].slice(0, 40)),
            h('td', { class: 'num', text: fmtNum(p.impressions) }), h('td', { class: 'num', text: fmtNum(p.likes) }), h('td', { class: 'num', text: fmtPct(p.engagement_rate, 2) })))))));
      } else topc.appendChild(empty(NO_PERF));
      area.appendChild(h('div', { style: 'height:16px' }));
      area.appendChild(topc);

      const pc = h('div', { class: 'card' }, h('h2', { text: '投稿数の推移' }), h('p', { class: 'hint', text: '/x-log で記録した投稿の数（日別）' }));
      const posted = (DATA.posted || []).filter(p => p.date);
      if (posted.length) {
        const counts = {};
        posted.forEach(p => { counts[p.date] = (counts[p.date] || 0) + 1; });
        const first = range === 0 ? Math.min.apply(null, posted.map(p => dayNum(p.date))) : end - range + 1;
        const rows = [];
        for (let n = first; n <= end; n++) { const d = numToDate(n); rows.push({ d, v: counts[d] || 0 }); }
        if (rows.some(r => r.v > 0)) colChart(pc, rows, { label: '投稿数の推移', series: '投稿数', unit: '件' });
        else pc.appendChild(empty('この期間の投稿記録はありません'));
      } else pc.appendChild(empty(NO_POSTED));
      area.appendChild(h('div', { style: 'height:16px' }));
      area.appendChild(pc);
    }
    draw();
  }

  // ================================================================ タブ3：履歴
  function renderHistory(root) {
    const dates = Object.keys(DATA.days || {}).sort().reverse();
    const ac = h('div', { class: 'card' }, h('h2', { text: '採用率の推移' }), h('p', { class: 'hint', text: 'その日の案（いいねを除く）のうち、/x-log で投稿を記録した割合' }));
    const pts = (DATA.adoption || []).filter(a => isNum(a.rate)).map(a => ({ d: a.date, v: a.rate, extra: [a.posted + ' / ' + a.total + '件'] }));
    if (pts.length) lineChart(ac, pts, { label: '採用率の推移', series: '採用率', yMin: 0, yMax: 1, fmt: v => fmtPct(v, 0), tickFmt: v => Math.round(v * 100) + '%', extraHeads: ['投稿 / 案'] });
    else ac.appendChild(empty('データがありません：/x-morning で案を作り、投稿したら /x-log で記録すると採用率が出ます'));
    root.appendChild(ac);

    const dc = h('div', { class: 'card' }, h('h2', { text: '日付を選んで振り返る' }));
    root.appendChild(dc);
    if (!dates.length) { dc.appendChild(empty('データがありません：/x-morning を実行すると、毎日の記録がここにたまります')); return; }
    const sel = h('select', { 'aria-label': '日付' }, dates.map(d => h('option', { value: d, text: d + '（' + wd(d) + '）' })));
    const body = h('div');
    dc.appendChild(h('div', { class: 'filters' }, h('span', { class: 'lbl2', text: '日付' }), sel));
    dc.appendChild(body);
    const draw = () => {
      body.textContent = '';
      const day = DATA.days[sel.value] || {};
      const st = day.status, ap = day.approval;
      if (day.status_error) body.appendChild(notice('error', 'status.json を読めませんでした（' + day.status_error + '）'));
      if (day.approval_error) body.appendChild(notice('error', 'approval.json を読めませんでした（' + day.approval_error + '）'));
      body.appendChild(h('h3', { text: 'テーマ方針' }));
      body.appendChild(st && st.theme ? h('p', { text: st.theme }) : empty('status.json がありません'));
      body.appendChild(h('h3', { text: 'チームの状況' }));
      const teams = st && Array.isArray(st.teams) ? st.teams : [];
      if (teams.length) {
        body.appendChild(h('div', { class: 'md-table' }, h('table', null,
          h('thead', null, h('tr', null, ['チーム', '状態', '件数', 'NG', 'メモ'].map((x, i) => h('th', { class: i === 2 || i === 3 ? 'num' : null, text: x })))),
          h('tbody', null, teams.map(t => { const meta = STATUS_META[t.status]; const lab = (DATA.teams.find(x => x.name === t.name) || {}).label || t.name; return h('tr', null, h('td', { class: 'nowrap', text: lab }), h('td', { class: 'nowrap' }, meta ? badge(meta) : String(t.status)), h('td', { class: 'num', text: isNum(t.items) ? String(t.items) : '—' }), h('td', { class: 'num', text: isNum(t.ng) ? String(t.ng) : '—' }), h('td', { text: t.note || '' })); })))));
      } else body.appendChild(empty('データがありません'));
      body.appendChild(h('h3', { text: '案の一覧（approval.json）' }));
      const items = ap && Array.isArray(ap.items) ? ap.items.filter(i => i.kind !== 'like') : [];
      const likeN = ap && Array.isArray(ap.items) ? ap.items.filter(i => i.kind === 'like').length : 0;
      if (items.length) {
        body.appendChild(h('div', { class: 'md-table' }, h('table', null,
          h('thead', null, h('tr', null, ['時間', '種類', '型', 'チェック', 'おすすめ', '投稿', '本文（1行目）'].map(x => h('th', { text: x })))),
          h('tbody', null, items.map(it => h('tr', null, h('td', { class: 'nowrap', text: it.time || '—' }), h('td', { class: 'nowrap', text: KL[it.kind] || it.kind }), h('td', { text: it.type || '' }),
            h('td', null, CHECK_META[it.check] ? badge(CHECK_META[it.check]) : String(it.check || '')), h('td', { text: it.recommended ? '★' : '' }),
            h('td', { text: it._logged ? '記録済み' : '' }), h('td', { text: (it.text || '（返信しない推奨）').split('\n')[0].slice(0, 40) })))))));
        if (likeN) body.appendChild(h('p', { class: 'hint', style: 'margin-top:8px', text: 'このほかに、いいねリスト ' + likeN + '件' }));
      } else body.appendChild(empty('データがありません'));
    };
    sel.addEventListener('change', draw);
    draw();
  }

  // ================================================================ タブ4：学び
  function renderLearn(root) {
    const lc = h('div', { class: 'card' }, h('h2', null, '学び', h('span', { class: 'count', text: 'knowledge/learnings.md の最新10件（取り消し線の学びはグレー）' })));
    const ls = DATA.learnings || [];
    if (ls.length) {
      lc.appendChild(h('ul', { class: 'learn' }, ls.map(l => h('li', { class: l.struck ? 'struck' : null }, l.date ? h('span', { class: 'd', text: l.date + (l.struck ? '（取り消し）' : '') }) : null, h('span', { html: l.html })))));
    } else lc.appendChild(empty('データがありません：inbox/stats/ に数字を貼って /x-weekly を実行すると、学びがたまります'));
    root.appendChild(lc);
    const wc = h('div', { class: 'card md' });
    const w = DATA.weekly;
    wc.appendChild(h('h2', null, '来週の提案', w ? h('span', { class: 'count', text: 'logs/' + w.date + '/weekly-review.md より' }) : null));
    if (w && w.found) wc.appendChild(h('div', { html: w.html }));
    else if (w) wc.appendChild(empty('weekly-review.md に「来週の提案」の見出しが見つかりません'));
    else wc.appendChild(empty('データがありません：inbox/stats/ に数字を貼って /x-weekly を実行してください'));
    root.appendChild(wc);
  }

  // ---------- タブの切り替え ----------
  const RENDER = { today: renderToday, results: renderResults, history: renderHistory, learn: renderLearn };
  const TABS = Object.keys(RENDER);
  const done = {};
  function showTab(name, focus) {
    TABS.forEach(t => {
      const on = t === name;
      const b = document.getElementById('tab-' + t);
      b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1;
      document.getElementById('panel-' + t).hidden = !on;
      if (on && focus) b.focus();
    });
    if (!done[name]) {
      done[name] = true;
      try { RENDER[name](document.getElementById('panel-' + name)); }
      catch (e) { document.getElementById('panel-' + name).appendChild(notice('error', 'このタブの表示中にエラーが起きました：' + e.message)); }
    }
    sset('xmc:tab', name);
  }
  TABS.forEach((t, i) => {
    const b = document.getElementById('tab-' + t);
    b.addEventListener('click', () => showTab(t));
    b.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight') { showTab(TABS[(i + 1) % TABS.length], true); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { showTab(TABS[(i + TABS.length - 1) % TABS.length], true); e.preventDefault(); }
    });
  });
  const first = sget('xmc:tab', 'today');
  showTab(TABS.indexOf(first) >= 0 ? first : 'today');
})();
</script>
</body>
</html>
"""


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except BrokenPipeError:
        # 出力の途中でパイプが閉じられた（| head など）。ファイルの書き込みは終わっているので静かに終わる
        try:
            sys.stdout.close()
        except Exception:
            pass
        sys.exit(0)
