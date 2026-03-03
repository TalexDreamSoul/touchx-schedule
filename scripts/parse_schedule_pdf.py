#!/usr/bin/env python3
"""从教务 PDF 课表中提取基础课程信息（星期、节次、周次）。"""

from __future__ import annotations

import argparse
import json
import re
import zlib
from pathlib import Path
from typing import Any

COLUMN_X = [104.08, 207.92, 311.77, 415.62, 519.46, 623.31, 727.15]


def day_for_x(x: float) -> int | None:
    nearest = min(range(len(COLUMN_X)), key=lambda idx: abs(COLUMN_X[idx] - x))
    if abs(COLUMN_X[nearest] - x) <= 4:
        return nearest + 1
    return None


def unescape_pdf_literal(raw: bytes) -> bytes:
    output = bytearray()
    idx = 0
    while idx < len(raw):
        current = raw[idx]
        if current != 92:
            output.append(current)
            idx += 1
            continue

        idx += 1
        if idx >= len(raw):
            break

        escaped = raw[idx]
        if escaped in b"nrtbf":
            output.append({110: 10, 114: 13, 116: 9, 98: 8, 102: 12}[escaped])
            idx += 1
            continue
        if escaped in b"()\\":
            output.append(escaped)
            idx += 1
            continue
        if 48 <= escaped <= 55:
            oct_digits = [escaped]
            idx += 1
            for _ in range(2):
                if idx < len(raw) and 48 <= raw[idx] <= 55:
                    oct_digits.append(raw[idx])
                    idx += 1
                else:
                    break
            output.append(int(bytes(oct_digits), 8))
            continue
        if escaped in (10, 13):
            if escaped == 13 and idx + 1 < len(raw) and raw[idx + 1] == 10:
                idx += 2
            else:
                idx += 1
            continue

        output.append(escaped)
        idx += 1

    return bytes(output)


def decode_text(raw: bytes) -> str:
    if not raw:
        return ""
    if len(raw) % 2 == 0:
        try:
            return raw.decode("utf-16-be")
        except UnicodeDecodeError:
            pass
    for encoding in ("utf-8", "gb18030", "latin1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return ""


def looks_like_title(text: str) -> bool:
    if not text or len(text) > 40:
        return False
    if text in {"上午", "下午", "晚上", "理论", "实验", "实践"}:
        return False
    if re.fullmatch(r"\d{1,2}", text):
        return False
    if text.startswith(":"):
        return False
    if any(key in text for key in ("校区", "场地", "教师", "教学班", "周学时", "组成", "打印时间", "学号", "学期", "课表")):
        return False
    if any(char in text for char in ("/", ":", ";")):
        return False
    if re.search(r"20\d{2}|\d+\)|\(\d+\)", text):
        return False
    return bool(re.search(r"[A-Za-z\u4e00-\u9fff\+]", text))


def extract_tokens(pdf_path: Path) -> list[dict[str, Any]]:
    content = pdf_path.read_bytes()
    tokens: list[dict[str, Any]] = []
    order = 0

    for stream_start in re.finditer(rb"stream\r?\n", content):
        body_start = stream_start.end()
        body_end = content.find(b"endstream", body_start)
        if body_end < 0:
            continue

        compressed = content[body_start:body_end].rstrip(b"\r\n")
        try:
            stream = zlib.decompress(compressed)
        except zlib.error:
            continue

        x = 0.0
        y = 0.0
        for line in stream.splitlines():
            position_match = re.search(rb"1 0 0 1 ([0-9.]+) ([0-9.]+) Tm", line)
            if position_match:
                x = float(position_match.group(1))
                y = float(position_match.group(2))

            for text_match in re.finditer(rb"\((.*?)\)\s*Tj", line):
                raw_text = unescape_pdf_literal(text_match.group(1))
                text = decode_text(raw_text).replace("\x00", "").replace("\r", "").replace("\n", "").strip()
                if text:
                    tokens.append({"order": order, "x": x, "y": y, "text": text})
                    order += 1

    return tokens


def parse_schedule(pdf_path: Path) -> dict[str, Any]:
    tokens = extract_tokens(pdf_path)

    owner = ""
    for token in tokens:
        if token["text"].endswith("课表") and len(token["text"]) <= 20:
            owner = token["text"].replace("课表", "")
            break

    by_day: dict[int, list[dict[str, Any]]] = {day: [] for day in range(1, 8)}
    for token in tokens:
        day = day_for_x(token["x"])
        if day is None:
            continue
        if not (10 < token["y"] < 580):
            continue
        by_day[day].append(token)

    courses: list[dict[str, Any]] = []
    detail_pattern = re.compile(r"^\((\d+)-(\d+)节\)([^/]*?)周(?:\((单|双)\))?")

    for day in range(1, 8):
        day_tokens = sorted(by_day[day], key=lambda item: item["order"])
        title_lines: list[str] = []
        index = 0

        while index < len(day_tokens):
            text = day_tokens[index]["text"]
            detail_match = detail_pattern.search(text)
            if not detail_match:
                if looks_like_title(text):
                    title_lines.append(text)
                index += 1
                continue

            title = "".join(title_lines).strip()
            title_lines = []
            if not title:
                index += 1
                continue

            detail_blob = text
            next_index = index + 1
            while next_index < len(day_tokens):
                candidate = day_tokens[next_index]["text"]
                if detail_pattern.search(candidate) or looks_like_title(candidate):
                    break
                detail_blob += candidate
                if "周学时" in detail_blob:
                    next_index += 1
                    break
                next_index += 1

            parity_map = {"单": "odd", "双": "even"}
            course = {
                "name": title,
                "day": day,
                "startSection": int(detail_match.group(1)),
                "endSection": int(detail_match.group(2)),
                "weekExpr": detail_match.group(3).strip(),
            }
            parity = parity_map.get(detail_match.group(4) or "")
            if parity:
                course["parity"] = parity

            classroom_match = re.search(r"场地:([^/]+)", detail_blob)
            if classroom_match:
                course["classroom"] = classroom_match.group(1).strip()

            teacher_match = re.search(r"教师:([^/]+)", detail_blob)
            if teacher_match:
                course["teacher"] = teacher_match.group(1).strip()

            teaching_classes_match = re.search(r"教学班组成:([^/]+)", detail_blob)
            if teaching_classes_match:
                course["teachingClasses"] = teaching_classes_match.group(1).strip()

            courses.append(course)
            index = next_index

    return {
        "name": owner,
        "courses": courses,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="解析 PDF 课表到 JSON")
    parser.add_argument("pdf", nargs="+", type=Path, help="一个或多个 PDF 路径")
    args = parser.parse_args()

    result = [parse_schedule(path) for path in args.pdf]
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
