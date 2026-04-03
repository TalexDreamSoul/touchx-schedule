#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from parse_schedule_pdf import parse_schedule


JOIN_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


@dataclass
class UserSpec:
    name: str
    student_no: str
    class_label: str
    pdf_path: Path


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def normalize_text(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_course_name(name: Any) -> str:
    value = normalize_text(name)
    if not value:
        return ""
    if value == "据科学与大数据技术毛泽东思想和中国特色社会主义理论体系概论":
        return "毛泽东思想和中国特色社会主义理论体系概论"
    if value == "械设计制造及其自动化软件工程":
        return "软件工程"
    if value.startswith("据科学与大数据技术") and "毛泽东思想和中国特色社会主义理论体系概论" in value:
        return "毛泽东思想和中国特色社会主义理论体系概论"
    if value.startswith("械设计制造及其自动化") and value.endswith("软件工程"):
        return "软件工程"
    return value


def normalize_parity(value: Any) -> str:
    text = normalize_text(value).lower()
    if text in {"all", "odd", "even"}:
        return text
    return "all"


def to_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def random_code_by_student_no(student_no: str) -> str:
    digits = re.sub(r"\D+", "", student_no)
    if digits:
        return digits[-4:].rjust(4, "0")[:4]
    return "0000"


def deterministic_join_code(seed: str) -> str:
    digest = hashlib.sha256(seed.encode("utf-8")).digest()
    return "".join(JOIN_CODE_CHARS[b % len(JOIN_CODE_CHARS)] for b in digest[:8])


def escape_sql_string(value: str) -> str:
    return value.replace("'", "''")


def parse_user_spec(raw: str) -> UserSpec:
    parts = raw.split("|")
    if len(parts) != 4:
        raise ValueError(f"--user 参数格式错误: {raw}")
    name, student_no, class_label, pdf_path = (item.strip() for item in parts)
    if not name or not student_no or not class_label or not pdf_path:
        raise ValueError(f"--user 参数字段不能为空: {raw}")
    if not re.fullmatch(r"\d{6,32}", student_no):
        raise ValueError(f"学号格式非法: {student_no}")
    path = Path(pdf_path)
    if not path.exists():
        raise ValueError(f"PDF 不存在: {pdf_path}")
    return UserSpec(name=name, student_no=student_no, class_label=class_label, pdf_path=path)


def load_state(path: Path) -> tuple[int, dict[str, Any]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, dict) and "revision" in raw and "payload" in raw:
        revision = to_int(raw.get("revision"), 0)
        payload = raw.get("payload")
        if isinstance(payload, str):
            payload = json.loads(payload)
        if not isinstance(payload, dict):
            raise ValueError("payload 必须是对象")
        return revision, payload

    if isinstance(raw, list) and raw and isinstance(raw[0], dict):
        first = raw[0]
        results = first.get("results")
        if isinstance(results, list) and results and isinstance(results[0], dict):
            row = results[0]
            revision = to_int(row.get("revision"), 0)
            payload = row.get("payload")
            if isinstance(payload, str):
                payload = json.loads(payload)
            if not isinstance(payload, dict):
                raise ValueError("payload 必须是对象")
            return revision, payload

    raise ValueError("无法识别的 state JSON 结构")


def ensure_list(container: dict[str, Any], key: str) -> list[Any]:
    value = container.get(key)
    if isinstance(value, list):
        return value
    container[key] = []
    return container[key]


def ensure_dict(container: dict[str, Any], key: str) -> dict[str, Any]:
    value = container.get(key)
    if isinstance(value, dict):
        return value
    container[key] = {}
    return container[key]


def dedup_entries(raw_courses: list[dict[str, Any]], student_no: str) -> list[dict[str, Any]]:
    unique: dict[str, dict[str, Any]] = {}
    for item in raw_courses:
        day = to_int(item.get("day"), 0)
        start = to_int(item.get("startSection"), 0)
        end = to_int(item.get("endSection"), 0)
        course_name = normalize_course_name(item.get("name"))
        week_expr = normalize_text(item.get("weekExpr")) or "1-20"
        parity = normalize_parity(item.get("parity"))
        classroom = normalize_text(item.get("classroom"))
        teacher = normalize_text(item.get("teacher"))
        if day < 1 or day > 7 or start <= 0 or end < start or not course_name:
            continue
        dedup_key = "|".join(
            [str(day), str(start), str(end), week_expr, parity, course_name, classroom, teacher],
        )
        if dedup_key in unique:
            continue
        unique[dedup_key] = {
            "day": day,
            "startSection": start,
            "endSection": end,
            "weekExpr": week_expr,
            "parity": parity,
            "courseName": course_name,
            "classroom": classroom,
            "teacher": teacher,
        }

    sorted_entries = sorted(
        unique.values(),
        key=lambda e: (to_int(e.get("day")), to_int(e.get("startSection")), to_int(e.get("endSection")), normalize_text(e.get("courseName"))),
    )
    for idx, item in enumerate(sorted_entries, start=1):
        item["id"] = f"entry_touchx_{student_no}_{idx:03d}"
    return sorted_entries


def remove_schedule_related(store: dict[str, Any], schedule_id: str) -> None:
    schedule_versions = ensure_list(store, "scheduleVersions")
    schedule_versions[:] = [item for item in schedule_versions if normalize_text(item.get("scheduleId")) != schedule_id]

    subscriptions = ensure_list(store, "scheduleSubscriptions")
    removed_subscription_ids = {
        normalize_text(item.get("id"))
        for item in subscriptions
        if normalize_text(item.get("sourceScheduleId")) == schedule_id
    }
    subscriptions[:] = [item for item in subscriptions if normalize_text(item.get("sourceScheduleId")) != schedule_id]

    if removed_subscription_ids:
        schedule_patches = ensure_list(store, "schedulePatches")
        schedule_patches[:] = [
            item for item in schedule_patches if normalize_text(item.get("subscriptionId")) not in removed_subscription_ids
        ]
        schedule_conflicts = ensure_list(store, "scheduleConflicts")
        schedule_conflicts[:] = [
            item
            for item in schedule_conflicts
            if normalize_text(item.get("subscriptionId")) not in removed_subscription_ids
        ]

    schedules = ensure_list(store, "schedules")
    schedules[:] = [item for item in schedules if normalize_text(item.get("id")) != schedule_id]


def upsert_personal_schedule(
    payload: dict[str, Any],
    user_spec: UserSpec,
    term: str,
    now: str,
) -> dict[str, Any]:
    store = ensure_dict(payload, "store")
    users = ensure_list(store, "users")
    classes = ensure_list(store, "classes")
    class_members = ensure_list(store, "classMembers")
    schedules = ensure_list(store, "schedules")
    schedule_versions = ensure_list(store, "scheduleVersions")
    subscriptions = ensure_list(store, "scheduleSubscriptions")

    parsed = parse_schedule(user_spec.pdf_path)
    raw_courses = parsed.get("courses")
    if not isinstance(raw_courses, list):
        raw_courses = []
    entries = dedup_entries(raw_courses, user_spec.student_no)

    user = next((item for item in users if normalize_text(item.get("studentNo")) == user_spec.student_no), None)
    is_new_user = user is None
    user_id = f"user_touchx_{user_spec.student_no}"
    if user is None:
        user = {
            "userId": user_id,
            "studentNo": user_spec.student_no,
            "studentId": user_spec.student_no,
            "name": user_spec.name,
            "classLabel": user_spec.class_label,
            "nickname": user_spec.name,
            "avatarUrl": "",
            "wallpaperUrl": "",
            "classIds": [],
            "adminRole": "none",
            "reminderEnabled": True,
            "reminderWindowMinutes": [30, 15],
            "createdAt": now,
            "updatedAt": now,
        }
        users.append(user)
    else:
        user_id = normalize_text(user.get("userId")) or user_id
        user["studentNo"] = user_spec.student_no
        user["studentId"] = normalize_text(user.get("studentId")) or user_spec.student_no
        user["name"] = user_spec.name
        user["nickname"] = user_spec.name
        user["classLabel"] = user_spec.class_label
        user["avatarUrl"] = normalize_text(user.get("avatarUrl"))
        user["wallpaperUrl"] = normalize_text(user.get("wallpaperUrl"))
        user["adminRole"] = normalize_text(user.get("adminRole")) or "none"
        user["reminderEnabled"] = bool(user.get("reminderEnabled", True))
        windows = user.get("reminderWindowMinutes")
        user["reminderWindowMinutes"] = windows if isinstance(windows, list) and windows else [30, 15]
        user["updatedAt"] = now

    class_id = f"class_touchx_{user_spec.student_no}"
    schedule_id = f"schedule_touchx_{user_spec.student_no}"
    schedule_version_id = f"schedule_version_touchx_{user_spec.student_no}_v1"
    class_member_id = f"class_member_touchx_{user_spec.student_no}"
    subscription_id = f"schedule_sub_touchx_{user_spec.student_no}"

    user["classIds"] = [class_id]

    class_item = next((item for item in classes if normalize_text(item.get("id")) == class_id), None)
    class_name = f"{user_spec.class_label}（{user_spec.name}）"
    if class_item is None:
        class_item = {
            "id": class_id,
            "name": class_name,
            "ownerUserId": user_id,
            "timezone": "Asia/Shanghai",
            "status": "active",
            "activeJoinCode": deterministic_join_code(user_spec.student_no),
            "createdAt": now,
            "updatedAt": now,
        }
        classes.append(class_item)
    else:
        class_item["name"] = class_name
        class_item["ownerUserId"] = user_id
        class_item["timezone"] = "Asia/Shanghai"
        class_item["status"] = "active"
        class_item["activeJoinCode"] = normalize_text(class_item.get("activeJoinCode")) or deterministic_join_code(user_spec.student_no)
        class_item["updatedAt"] = now

    class_members[:] = [item for item in class_members if normalize_text(item.get("classId")) != class_id]
    class_members.append(
        {
            "id": class_member_id,
            "classId": class_id,
            "userId": user_id,
            "classRole": "class_owner",
            "joinedAt": now,
        },
    )

    extra_schedule_ids = [
        normalize_text(item.get("id"))
        for item in schedules
        if normalize_text(item.get("classId")) == class_id and normalize_text(item.get("id")) != schedule_id
    ]
    for old_schedule_id in extra_schedule_ids:
        if old_schedule_id:
            remove_schedule_related(store, old_schedule_id)
    remove_schedule_related(store, schedule_id)

    schedules.append(
        {
            "id": schedule_id,
            "classId": class_id,
            "title": f"{user_spec.name}课表",
            "description": f"{term} PDF 导入",
            "publishedVersionNo": 1,
            "createdByUserId": user_id,
            "createdAt": now,
            "updatedAt": now,
        },
    )

    schedule_versions.append(
        {
            "id": schedule_version_id,
            "scheduleId": schedule_id,
            "versionNo": 1,
            "status": "published",
            "entries": entries,
            "createdByUserId": user_id,
            "createdAt": now,
        },
    )

    subscriptions[:] = [
        item
        for item in subscriptions
        if not (
            normalize_text(item.get("id")) == subscription_id
            or (
                normalize_text(item.get("subscriberUserId")) == user_id
                and normalize_text(item.get("sourceScheduleId")) == schedule_id
            )
        )
    ]
    subscriptions.append(
        {
            "id": subscription_id,
            "subscriberUserId": user_id,
            "sourceScheduleId": schedule_id,
            "baseVersionNo": 1,
            "followMode": "following",
            "createdAt": now,
        },
    )

    legacy_state = payload.get("legacyCompatState")
    if not isinstance(legacy_state, dict):
        legacy_state = {}
        payload["legacyCompatState"] = legacy_state
    random_codes = ensure_dict(legacy_state, "randomCodeByUserId")
    random_codes[user_id] = random_code_by_student_no(user_spec.student_no)
    binding_targets = ensure_dict(legacy_state, "bindingTargetUserIdByUserId")
    binding_targets[user_id] = user_id
    practice = ensure_dict(legacy_state, "practiceCourseKeysByUserId")
    if not isinstance(practice.get(user_id), list):
        practice[user_id] = []
    target_map = ensure_dict(legacy_state, "subscriptionTargetsByUserId")
    if not isinstance(target_map.get(user_id), list):
        target_map[user_id] = []
    notify_bound = ensure_list(legacy_state, "notifyBoundUserIds")
    student_id = normalize_text(user.get("studentId"))
    if student_id and user_id not in notify_bound:
        notify_bound.append(user_id)

    return {
        "name": user_spec.name,
        "studentNo": user_spec.student_no,
        "userId": user_id,
        "classId": class_id,
        "scheduleId": schedule_id,
        "entryCount": len(entries),
        "newUser": is_new_user,
        "pdfPath": str(user_spec.pdf_path),
    }


def build_sql(
    current_revision: int,
    next_revision: int,
    payload: dict[str, Any],
    timestamp: str,
) -> tuple[str, str]:
    payload_text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    payload_sql = escape_sql_string(payload_text)
    remote_sql = (
        f"UPDATE nexus_state SET revision = {next_revision}, payload = '{payload_sql}', updated_at = '{timestamp}' "
        f"WHERE id = 1 AND revision = {current_revision};\n"
        "SELECT changes() AS changed_rows;\n"
    )
    local_sql = (
        "INSERT INTO nexus_state (id, revision, payload, updated_at) "
        f"VALUES (1, {next_revision}, '{payload_sql}', '{timestamp}') "
        "ON CONFLICT(id) DO UPDATE SET revision = excluded.revision, payload = excluded.payload, updated_at = excluded.updated_at;\n"
        "SELECT changes() AS changed_rows;\n"
    )
    return remote_sql, local_sql


def main() -> None:
    parser = argparse.ArgumentParser(description="将 PDF 课表写入 nexus_state，并生成远程/本地 SQL")
    parser.add_argument("--state-json", required=True, type=Path, help="当前 state JSON（支持 wrangler --json 原始输出）")
    parser.add_argument(
        "--user",
        action="append",
        required=True,
        help="格式：姓名|学号|班级标签|PDF绝对路径，可重复传入",
    )
    parser.add_argument("--term", default="2025-2026-2", help="课表学期文案")
    parser.add_argument("--out-state-json", required=True, type=Path, help="输出更新后的 state JSON")
    parser.add_argument("--out-summary-json", required=True, type=Path, help="输出更新摘要 JSON")
    parser.add_argument("--out-remote-sql", required=True, type=Path, help="输出远程更新 SQL")
    parser.add_argument("--out-local-sql", required=True, type=Path, help="输出本地 upsert SQL")
    args = parser.parse_args()

    user_specs = [parse_user_spec(item) for item in args.user]
    current_revision, payload = load_state(args.state_json)
    if payload.get("version") != 1:
        raise ValueError("payload.version 必须为 1")

    timestamp = now_iso()
    summaries: list[dict[str, Any]] = []
    for spec in user_specs:
        summaries.append(upsert_personal_schedule(payload, spec, args.term, timestamp))

    next_revision = current_revision + 1
    remote_sql, local_sql = build_sql(current_revision, next_revision, payload, timestamp)

    args.out_state_json.write_text(
        json.dumps({"revision": next_revision, "payload": payload}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    args.out_summary_json.write_text(
        json.dumps(
            {
                "fromRevision": current_revision,
                "toRevision": next_revision,
                "updatedAt": timestamp,
                "users": summaries,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    args.out_remote_sql.write_text(remote_sql, encoding="utf-8")
    args.out_local_sql.write_text(local_sql, encoding="utf-8")


if __name__ == "__main__":
    main()
