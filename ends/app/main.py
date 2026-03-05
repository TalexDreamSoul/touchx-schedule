from __future__ import annotations

import asyncio
import base64
import copy
import csv
import hashlib
import hmac
import io
import json
import os
import re
import secrets
import sqlite3
import struct
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, PlainTextResponse, RedirectResponse
from pydantic import BaseModel, Field

try:
    from Crypto.Cipher import AES
except ImportError:  # pragma: no cover
    AES = None

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("TOUCHX_DB_PATH", str(BASE_DIR / "touchx.db")))
TERM_WEEK1_MONDAY = os.getenv("TERM_WEEK1_MONDAY", "2026-03-02")
TIMEZONE_NAME = os.getenv("TOUCHX_TIMEZONE", "Asia/Shanghai")
REMINDER_OFFSETS = [30, 15]
REMINDER_TRIGGER_WINDOW_SECONDS = int(os.getenv("REMINDER_TRIGGER_WINDOW_SECONDS", "120"))
SCAN_INTERVAL_SECONDS = int(os.getenv("REMINDER_SCAN_INTERVAL_SECONDS", "60"))
ENABLE_REMINDER_WORKER = os.getenv("ENABLE_REMINDER_WORKER", "1") == "1"
PUSH_MODE = os.getenv("PUSH_MODE", "wecom")  # wecom | mock
ADMIN_WEB_AUTH_TOKEN = os.getenv("ADMIN_WEB_AUTH_TOKEN", "").strip()
ADMIN_WEB_SESSION_TTL_SECONDS = int(os.getenv("ADMIN_WEB_SESSION_TTL_SECONDS", str(12 * 60 * 60)))
ADMIN_WEB_SESSION_COOKIE = "touchx_admin_session"
WECOM_API_BASE = os.getenv("WECOM_API_BASE", "https://qyapi.weixin.qq.com").rstrip("/")
WECOM_CORP_ID = os.getenv("WECOM_CORP_ID", "").strip()
WECOM_AGENT_ID = os.getenv("WECOM_AGENT_ID", "").strip()
WECOM_CORP_SECRET = os.getenv("WECOM_CORP_SECRET", "").strip()
WECOM_DEFAULT_TOUSER = os.getenv("WECOM_DEFAULT_TOUSER", "").strip()
WECOM_CALLBACK_TOKEN = os.getenv("WECOM_CALLBACK_TOKEN", "").strip()
WECOM_CALLBACK_AES_KEY = os.getenv("WECOM_CALLBACK_AES_KEY", "").strip()
CORS_ALLOW_ORIGINS = os.getenv("CORS_ALLOW_ORIGINS", "*")
COURSE_CSV_PATH = Path(os.getenv("COURSE_CSV_PATH", str(BASE_DIR.parent.parent / "src/data/normalized/courses.normalized.csv")))
USER_CSV_PATH = Path(os.getenv("USER_CSV_PATH", str(BASE_DIR.parent.parent / "src/data/normalized/users.normalized.csv")))
MP_WECHAT_APPID = os.getenv("MP_WECHAT_APPID", "").strip()
MP_WECHAT_SECRET = os.getenv("MP_WECHAT_SECRET", "").strip()
AUTH_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
MEDIA_STORAGE_DIR = Path(os.getenv("MEDIA_STORAGE_DIR", str(BASE_DIR / "media_temp")))
MEDIA_BASE_PATH = "/api/media"
MAX_AVATAR_UPLOAD_BYTES = int(os.getenv("MAX_AVATAR_UPLOAD_BYTES", str(2 * 1024 * 1024)))
MAX_WALLPAPER_UPLOAD_BYTES = int(os.getenv("MAX_WALLPAPER_UPLOAD_BYTES", str(5 * 1024 * 1024)))
ALLOWED_IMAGE_TYPES = {"jpg", "png", "gif", "webp"}
RANDOM_CODE_LENGTH = 4
RANDOM_CODE_SPACE_SIZE = 10 ** RANDOM_CODE_LENGTH
RANDOM_CODE_MAX_ATTEMPTS = max(64, RANDOM_CODE_SPACE_SIZE // 2)
SENSITIVE_MASK_TEXT = "已隐藏"
DEFAULT_ADMIN_STUDENT_ID = "tangzixian"
ADMIN_SECOND_LEVEL_TABS = ("wecom", "users", "themes", "templates")
THEME_KEYS = ("black", "purple", "green", "pink", "blue", "yellow", "orange")
DEFAULT_THEME_IMAGE_CANDIDATES = (
    BASE_DIR.parent.parent / "src/static/theme/purple.png",
    BASE_DIR / "theme/purple.png",
)
DEFAULT_THEME_PURPLE_FILE_NAME = "theme-purple-default.png"
USER_CSV_HEADERS = ["student_id", "name", "student_no", "class_label", "course_source_student_id", "built_in"]
COURSE_CSV_REQUIRED_HEADERS = [
    "term",
    "student_id",
    "student_name",
    "student_no",
    "course_id",
    "course_name",
    "day",
    "day_label",
    "start_section",
    "end_section",
    "start_time",
    "end_time",
    "week_expr",
    "parity",
    "classroom",
    "teacher",
    "teaching_classes",
]
USER_STUDENT_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{1,31}$")
PRACTICE_COURSE_KEY_PATTERN = re.compile(r"^[^|]+\|\d+\|\d+-\d+\|[^|]+\|(all|odd|even)$")

SECTION_TIMES: Dict[int, Dict[str, str]] = {
    1: {"start": "08:30", "end": "09:15", "part": "上午"},
    2: {"start": "09:20", "end": "10:05", "part": "上午"},
    3: {"start": "10:25", "end": "11:10", "part": "上午"},
    4: {"start": "11:15", "end": "12:00", "part": "上午"},
    5: {"start": "14:30", "end": "15:15", "part": "下午"},
    6: {"start": "15:20", "end": "16:05", "part": "下午"},
    7: {"start": "16:25", "end": "17:10", "part": "下午"},
    8: {"start": "17:15", "end": "18:00", "part": "下午"},
    9: {"start": "19:00", "end": "19:45", "part": "晚上"},
    10: {"start": "19:50", "end": "20:35", "part": "晚上"},
    11: {"start": "20:40", "end": "21:25", "part": "晚上"},
}

CAIZILING_COURSES: List[Dict[str, Any]] = [
    {"id": "czl-01", "name": "人工智能导论", "day": 1, "startSection": 1, "endSection": 2, "weekExpr": "1-17"},
    {"id": "czl-02", "name": "游戏建模", "day": 1, "startSection": 3, "endSection": 4, "weekExpr": "1-8"},
    {"id": "czl-03", "name": "Unity 3D 引擎技术应用", "day": 1, "startSection": 5, "endSection": 7, "weekExpr": "9-16"},
    {"id": "czl-04", "name": "Unity 3D 引擎技术应用", "day": 2, "startSection": 2, "endSection": 4, "weekExpr": "9-16"},
    {"id": "czl-05", "name": "软件质量保证与测试", "day": 2, "startSection": 5, "endSection": 6, "weekExpr": "1-17"},
    {"id": "czl-06", "name": "软件质量保证与测试", "day": 2, "startSection": 7, "endSection": 8, "weekExpr": "9-16"},
    {"id": "czl-07", "name": "大学生职业发展与就业指导-2", "day": 2, "startSection": 9, "endSection": 10, "weekExpr": "1-4"},
    {"id": "czl-08", "name": "游戏建模", "day": 3, "startSection": 2, "endSection": 4, "weekExpr": "1-8"},
    {"id": "czl-09", "name": "游戏运营管理", "day": 3, "startSection": 2, "endSection": 4, "weekExpr": "9-16"},
    {"id": "czl-10", "name": "C++程序设计", "day": 4, "startSection": 3, "endSection": 4, "weekExpr": "1-16"},
    {"id": "czl-11", "name": "游戏建模", "day": 4, "startSection": 5, "endSection": 6, "weekExpr": "1-4"},
    {"id": "czl-12", "name": "人工智能导论", "day": 4, "startSection": 5, "endSection": 6, "weekExpr": "9-16"},
    {"id": "czl-13", "name": "C++程序设计", "day": 4, "startSection": 7, "endSection": 8, "weekExpr": "9-16"},
    {"id": "czl-14", "name": "形势与政策-6", "day": 5, "startSection": 1, "endSection": 2, "weekExpr": "6-12", "parity": "even"},
    {
        "id": "czl-15",
        "name": "软硬件安装、配置、升级和网络支持(Linux 操作环境)",
        "day": 5,
        "startSection": 3,
        "endSection": 4,
        "weekExpr": "1-16",
    },
    {"id": "czl-16", "name": "游戏运营管理", "day": 5, "startSection": 5, "endSection": 7, "weekExpr": "9-16"},
]

GOUJIAXIANG_COURSES: List[Dict[str, Any]] = [
    {"id": "gjx-01", "name": "人工智能导论", "day": 1, "startSection": 3, "endSection": 4, "weekExpr": "1-17"},
    {"id": "gjx-02", "name": "开发和实现 Web 数据库", "day": 1, "startSection": 5, "endSection": 7, "weekExpr": "1-8"},
    {"id": "gjx-03", "name": "移动设备和操作系统", "day": 1, "startSection": 9, "endSection": 11, "weekExpr": "1-8"},
    {"id": "gjx-04", "name": "移动应用测试", "day": 1, "startSection": 9, "endSection": 11, "weekExpr": "9-16"},
    {"id": "gjx-05", "name": "软件质量保证与测试", "day": 2, "startSection": 1, "endSection": 2, "weekExpr": "1-17"},
    {"id": "gjx-06", "name": "大学生职业发展与就业指导-2", "day": 2, "startSection": 9, "endSection": 10, "weekExpr": "13-16"},
    {"id": "gjx-07", "name": "移动设备和操作系统", "day": 3, "startSection": 2, "endSection": 4, "weekExpr": "1-8"},
    {"id": "gjx-08", "name": "移动应用测试", "day": 3, "startSection": 2, "endSection": 4, "weekExpr": "9-16"},
    {"id": "gjx-09", "name": "智能制造数字化工艺仿真", "day": 3, "startSection": 5, "endSection": 6, "weekExpr": "2-17"},
    {"id": "gjx-10", "name": "智能运维与管理", "day": 3, "startSection": 7, "endSection": 8, "weekExpr": "2-17"},
    {"id": "gjx-11", "name": "软件质量保证与测试", "day": 4, "startSection": 1, "endSection": 2, "weekExpr": "9-16"},
    {"id": "gjx-12", "name": "开发和实现 Web 数据库", "day": 4, "startSection": 2, "endSection": 4, "weekExpr": "1-8"},
    {"id": "gjx-13", "name": "人工智能导论", "day": 4, "startSection": 9, "endSection": 10, "weekExpr": "9-16"},
    {"id": "gjx-14", "name": "形势与政策-6", "day": 5, "startSection": 1, "endSection": 2, "weekExpr": "6-12", "parity": "even"},
]

SCHEDULES: Dict[str, Dict[str, Any]] = {
    "caiziling": {
        "name": "蔡子菱",
        "studentNo": "2305200101",
        "classLabel": "软件工程23(5)班",
        "courses": CAIZILING_COURSES,
    },
    "linfeng": {
        "name": "林峰",
        "studentNo": "2305200109",
        "classLabel": "软件工程23(5)班",
        "courses": CAIZILING_COURSES,
    },
    "panxiaofeng": {
        "name": "潘晓峰",
        "studentNo": "2305200133",
        "classLabel": "软件工程23(5)班",
        "courses": CAIZILING_COURSES,
    },
    "liuxinrong": {
        "name": "刘欣荣",
        "studentNo": "2305200106",
        "classLabel": "软件工程23(5)班",
        "courses": CAIZILING_COURSES,
    },
    "mawanqing": {
        "name": "马晚晴",
        "studentNo": "239610012",
        "classLabel": "体育教育23(2)班",
        "courses": [
            {"id": "mwq-01", "name": "认知见习", "day": 1, "startSection": 1, "endSection": 8, "weekExpr": "17"},
            {"id": "mwq-02", "name": "认知见习", "day": 2, "startSection": 1, "endSection": 8, "weekExpr": "17"},
            {"id": "mwq-03", "name": "现代教育技术应用", "day": 2, "startSection": 3, "endSection": 4, "weekExpr": "1-16"},
            {"id": "mwq-04", "name": "运动表演专项理论与实践-4", "day": 2, "startSection": 7, "endSection": 8, "weekExpr": "1-16"},
            {"id": "mwq-05", "name": "大学生职业发展与就业指导-2", "day": 2, "startSection": 9, "endSection": 10, "weekExpr": "9-12"},
            {"id": "mwq-06", "name": "体育社会学", "day": 3, "startSection": 3, "endSection": 4, "weekExpr": "1-16"},
            {"id": "mwq-07", "name": "体育与健康课程标准解读", "day": 3, "startSection": 9, "endSection": 10, "weekExpr": "1-8"},
            {"id": "mwq-08", "name": "班级管理", "day": 4, "startSection": 1, "endSection": 2, "weekExpr": "1-16"},
            {"id": "mwq-09", "name": "形势与政策-6", "day": 4, "startSection": 9, "endSection": 10, "weekExpr": "6-12", "parity": "even"},
        ],
    },
    "tangzixian": {
        "name": "唐子贤",
        "studentNo": "2305100613",
        "classLabel": "计算机科学与技术23(3)班",
        "courses": [
            {"id": "tzx-01", "name": "并行与分布式计算", "day": 1, "startSection": 1, "endSection": 2, "weekExpr": "1-17"},
            {"id": "tzx-02", "name": "人工智能导论", "day": 1, "startSection": 3, "endSection": 4, "weekExpr": "1-17"},
            {"id": "tzx-03", "name": "web 应用开发-II", "day": 1, "startSection": 5, "endSection": 7, "weekExpr": "1-8"},
            {"id": "tzx-04", "name": "信息安全工程", "day": 1, "startSection": 5, "endSection": 6, "weekExpr": "9-16"},
            {"id": "tzx-05", "name": "信息安全工程", "day": 1, "startSection": 9, "endSection": 10, "weekExpr": "1-16"},
            {"id": "tzx-06", "name": "网站实现、维护和管理", "day": 2, "startSection": 2, "endSection": 4, "weekExpr": "9-16"},
            {"id": "tzx-07", "name": "人工智能导论", "day": 2, "startSection": 5, "endSection": 6, "weekExpr": "9-16"},
            {"id": "tzx-08", "name": "并行与分布式计算", "day": 3, "startSection": 3, "endSection": 4, "weekExpr": "9-16"},
            {"id": "tzx-09", "name": "大学生职业发展与就业指导-2", "day": 3, "startSection": 9, "endSection": 10, "weekExpr": "5-8"},
            {"id": "tzx-10", "name": "软件质量保证与测试", "day": 3, "startSection": 9, "endSection": 11, "weekExpr": "9-16"},
            {"id": "tzx-11", "name": "web 应用开发-II", "day": 4, "startSection": 2, "endSection": 4, "weekExpr": "1-8"},
            {"id": "tzx-12", "name": "网站实现、维护和管理", "day": 4, "startSection": 2, "endSection": 4, "weekExpr": "9-16"},
            {"id": "tzx-13", "name": "软件质量保证与测试", "day": 4, "startSection": 5, "endSection": 7, "weekExpr": "9-16"},
            {"id": "tzx-14", "name": "形势与政策-6", "day": 4, "startSection": 9, "endSection": 10, "weekExpr": "7-13"},
            {"id": "tzx-15", "name": "IT 领域社会与职业问题", "day": 5, "startSection": 7, "endSection": 8, "weekExpr": "1-16"},
        ],
    },
    "wuxinyu": {
        "name": "伍鑫宇",
        "studentNo": "2305200112",
        "classLabel": "软件工程23(5)班",
        "courses": CAIZILING_COURSES,
    },
    "goujiaxiang": {
        "name": "苟家祥",
        "studentNo": "2305200330",
        "classLabel": "软件工程23(1)班",
        "courses": GOUJIAXIANG_COURSES,
    },
    "yanying": {
        "name": "严盈",
        "studentNo": "2307300134",
        "classLabel": "广播电视编导23(1)班",
        "courses": [
            {"id": "yy-01", "name": "纪录片创作", "day": 1, "startSection": 1, "endSection": 4, "weekExpr": "1-12"},
            {"id": "yy-02", "name": "大学生职业发展与就业指导-2", "day": 1, "startSection": 9, "endSection": 10, "weekExpr": "1-4"},
            {"id": "yy-03", "name": "影视短片创作", "day": 2, "startSection": 3, "endSection": 4, "weekExpr": "12-15"},
            {"id": "yy-04", "name": "全媒体节目策划与制作", "day": 2, "startSection": 5, "endSection": 8, "weekExpr": "1-8"},
            {"id": "yy-05", "name": "影视短片创作", "day": 2, "startSection": 9, "endSection": 10, "weekExpr": "12-15"},
            {"id": "yy-06", "name": "影视制片管理", "day": 3, "startSection": 1, "endSection": 4, "weekExpr": "1-8"},
            {"id": "yy-07", "name": "文艺节目策划", "day": 3, "startSection": 1, "endSection": 4, "weekExpr": "9-16"},
            {"id": "yy-08", "name": "影视短片创作", "day": 4, "startSection": 5, "endSection": 8, "weekExpr": "1-8"},
            {"id": "yy-09", "name": "形势与政策-6", "day": 4, "startSection": 9, "endSection": 10, "weekExpr": "6-12", "parity": "even"},
        ],
    },
}

DEFAULT_COURSE_OVERRIDE_ALIAS_MAP: Dict[str, str] = {
    "wuxinyu": "caiziling",
    "linfeng": "caiziling",
    "panxiaofeng": "caiziling",
    "liuxinrong": "caiziling",
}

DEFAULT_NAME_ALIASES: Dict[str, str] = {
    "蔡子菱": "caiziling",
    "林峰": "linfeng",
    "潘晓峰": "panxiaofeng",
    "刘欣荣": "liuxinrong",
    "马晚晴": "mawanqing",
    "唐子贤": "tangzixian",
    "伍鑫宇": "wuxinyu",
    "苟家祥": "goujiaxiang",
    "严盈": "yanying",
    "caiziling": "caiziling",
    "linfeng": "linfeng",
    "panxiaofeng": "panxiaofeng",
    "liuxinrong": "liuxinrong",
    "mawanqing": "mawanqing",
    "tangzixian": "tangzixian",
    "wuxinyu": "wuxinyu",
    "goujiaxiang": "goujiaxiang",
    "yanying": "yanying",
}

COURSE_OVERRIDE_ALIAS_MAP: Dict[str, str] = dict(DEFAULT_COURSE_OVERRIDE_ALIAS_MAP)
NAME_ALIASES: Dict[str, str] = dict(DEFAULT_NAME_ALIASES)
BUILTIN_SCHEDULES: Dict[str, Dict[str, Any]] = copy.deepcopy(SCHEDULES)
USER_REGISTRY_MAP: Dict[str, Dict[str, Any]] = {}


def normalize_student_id(value: str) -> str:
    return re.sub(r"\s+", "", str(value or "")).strip().lower()


def ensure_valid_student_id(student_id: str) -> str:
    normalized = normalize_student_id(student_id)
    if not USER_STUDENT_ID_PATTERN.fullmatch(normalized):
        raise HTTPException(status_code=400, detail="student_id 格式非法，仅支持小写字母/数字/下划线/中划线，长度 2-32")
    return normalized


def bool_from_text(value: Any) -> bool:
    text = str(value or "").strip().lower()
    return text in {"1", "true", "yes", "y", "on"}


def build_default_user_registry_rows() -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    for student_id, schedule in BUILTIN_SCHEDULES.items():
        rows.append(
            {
                "student_id": student_id,
                "name": str(schedule.get("name", student_id)).strip(),
                "student_no": trim_profile_text(str(schedule.get("studentNo", "")), max_length=32),
                "class_label": trim_profile_text(str(schedule.get("classLabel", "")), max_length=120),
                "course_source_student_id": DEFAULT_COURSE_OVERRIDE_ALIAS_MAP.get(student_id, student_id),
                "built_in": "1",
            }
        )
    return rows


def write_user_registry_rows(path: Path, rows: List[Dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=USER_CSV_HEADERS)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: str(row.get(key, "") or "").strip() for key in USER_CSV_HEADERS})


def parse_user_registry_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    parsed: List[Dict[str, str]] = []
    seen_ids: set[str] = set()
    for source in rows:
        student_id = normalize_student_id(source.get("student_id", ""))
        if not student_id or student_id in seen_ids:
            continue
        if not USER_STUDENT_ID_PATTERN.fullmatch(student_id):
            continue
        seen_ids.add(student_id)
        built_in = bool_from_text(source.get("built_in"))
        if student_id in BUILTIN_SCHEDULES:
            built_in = True
        parsed.append(
            {
                "student_id": student_id,
                "name": trim_profile_text(source.get("name"), max_length=40) or student_id,
                "student_no": trim_profile_text(source.get("student_no"), max_length=32),
                "class_label": trim_profile_text(source.get("class_label"), max_length=120),
                "course_source_student_id": normalize_student_id(source.get("course_source_student_id", "")),
                "built_in": "1" if built_in else "0",
            }
        )
    return parsed


def read_user_registry_rows(path: Path) -> List[Dict[str, str]]:
    if not path.exists():
        defaults = build_default_user_registry_rows()
        write_user_registry_rows(path, defaults)
        return defaults
    with path.open("r", encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        rows = parse_user_registry_rows(list(reader))
    missing = [row for row in build_default_user_registry_rows() if row["student_id"] not in {item["student_id"] for item in rows}]
    if missing:
        rows.extend(missing)
        write_user_registry_rows(path, rows)
    return rows


def resolve_courses_from_source(student_id: str, source_id: str) -> List[Dict[str, Any]]:
    if student_id in BUILTIN_SCHEDULES:
        return copy.deepcopy(BUILTIN_SCHEDULES[student_id].get("courses", []))
    source = normalize_student_id(source_id)
    if source in BUILTIN_SCHEDULES:
        return copy.deepcopy(BUILTIN_SCHEDULES[source].get("courses", []))
    return []


def rebuild_runtime_schedule_registry(rows: List[Dict[str, str]]) -> None:
    runtime_schedules: Dict[str, Dict[str, Any]] = {}
    runtime_aliases: Dict[str, str] = {}
    runtime_override_alias: Dict[str, str] = {}
    runtime_registry: Dict[str, Dict[str, Any]] = {}

    for row in rows:
        student_id = row["student_id"]
        source_id = normalize_student_id(row.get("course_source_student_id", ""))
        courses = resolve_courses_from_source(student_id, source_id)
        runtime_schedules[student_id] = {
            "name": row["name"],
            "studentNo": row.get("student_no", ""),
            "classLabel": row.get("class_label", ""),
            "courses": courses,
        }
        if source_id and source_id != student_id:
            runtime_override_alias[student_id] = source_id
        runtime_registry[student_id] = {
            "student_id": student_id,
            "name": row["name"],
            "student_no": row.get("student_no", ""),
            "class_label": row.get("class_label", ""),
            "course_source_student_id": source_id,
            "built_in": bool_from_text(row.get("built_in")),
        }

    for student_id, schedule in runtime_schedules.items():
        runtime_aliases[student_id] = student_id
        display_name = normalize_name(str(schedule.get("name", "")))
        if display_name:
            runtime_aliases[display_name] = student_id
        raw_name = str(schedule.get("name", "")).strip()
        if raw_name:
            runtime_aliases[raw_name] = student_id

    SCHEDULES.clear()
    SCHEDULES.update(runtime_schedules)
    NAME_ALIASES.clear()
    NAME_ALIASES.update(runtime_aliases)
    COURSE_OVERRIDE_ALIAS_MAP.clear()
    COURSE_OVERRIDE_ALIAS_MAP.update(runtime_override_alias)
    USER_REGISTRY_MAP.clear()
    USER_REGISTRY_MAP.update(runtime_registry)

    apply_course_overrides_to_schedules(load_course_overrides_from_csv(COURSE_CSV_PATH))


def reload_user_registry_from_csv() -> None:
    rows = read_user_registry_rows(USER_CSV_PATH)
    rebuild_runtime_schedule_registry(rows)


def normalize_course_name(name: str) -> str:
    return re.sub(r"\s+", "", (name or "")).strip().lower()


def normalize_course_parity(parity: Any) -> str:
    value = str(parity or "all").strip().lower()
    if value in {"odd", "even"}:
        return value
    return "all"


def build_course_practice_key(course: Dict[str, Any]) -> str:
    course_id = str(course.get("id", "")).strip()
    day = int(course.get("day", 0) or 0)
    start_section = int(course.get("startSection", 0) or 0)
    end_section = int(course.get("endSection", 0) or 0)
    week_expr = str(course.get("weekExpr", "")).strip()
    parity = normalize_course_parity(course.get("parity"))
    if not course_id or day <= 0 or start_section <= 0 or end_section <= 0 or not week_expr:
        return ""
    return f"{course_id}|{day}|{start_section}-{end_section}|{week_expr}|{parity}"


def normalize_practice_course_key(raw: Any) -> str:
    value = str(raw or "").strip()
    if not value:
        return ""
    if not PRACTICE_COURSE_KEY_PATTERN.fullmatch(value):
        return ""
    return value


def parse_practice_course_keys(raw: Any) -> List[str]:
    data: Any = raw
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return []
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            return []
    if not isinstance(data, list):
        return []
    result: List[str] = []
    seen: set[str] = set()
    for item in data:
        value = normalize_practice_course_key(item)
        if not value or value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def encode_practice_course_keys(keys: List[str]) -> str:
    values = parse_practice_course_keys(keys)
    return json.dumps(values, ensure_ascii=False)


def build_schedule_course_key_set(student_id: str) -> set[str]:
    schedule = SCHEDULES.get(student_id)
    if not schedule:
        return set()
    result: set[str] = set()
    for course in schedule.get("courses", []):
        value = build_course_practice_key(course)
        if value:
            result.add(value)
    return result


def load_course_overrides_from_csv(path: Path) -> Dict[str, List[Dict[str, str]]]:
    if not path.exists():
        return {}

    overrides: Dict[str, List[Dict[str, str]]] = {}
    with path.open("r", encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        for row in reader:
            student_id = (row.get("student_id") or "").strip()
            if not student_id:
                continue
            overrides.setdefault(student_id, []).append(
                {
                    "course_name": (row.get("course_name") or "").strip(),
                    "day": (row.get("day") or "").strip(),
                    "start_section": (row.get("start_section") or "").strip(),
                    "end_section": (row.get("end_section") or "").strip(),
                    "week_expr": (row.get("week_expr") or "").strip(),
                    "parity": ((row.get("parity") or "").strip() or "all"),
                    "classroom": (row.get("classroom") or "").strip(),
                    "teacher": (row.get("teacher") or "").strip(),
                    "teaching_classes": (row.get("teaching_classes") or "").strip(),
                }
            )
    return overrides


def apply_course_overrides_to_schedules(overrides: Dict[str, List[Dict[str, str]]]) -> None:
    if not overrides:
        return

    for student_id, schedule in SCHEDULES.items():
        rows = overrides.get(student_id)
        if not rows:
            alias_source_id = COURSE_OVERRIDE_ALIAS_MAP.get(student_id, "")
            if alias_source_id:
                rows = overrides.get(alias_source_id)
        if not rows:
            continue

        for course in schedule.get("courses", []):
            course_name = normalize_course_name(str(course.get("name", "")))
            day = str(course.get("day", ""))
            start_section = str(course.get("startSection", ""))
            end_section = str(course.get("endSection", ""))
            week_expr = str(course.get("weekExpr", ""))

            candidates = [
                row
                for row in rows
                if row["day"] == day
                and row["start_section"] == start_section
                and row["end_section"] == end_section
                and row["week_expr"] == week_expr
                and normalize_course_name(row["course_name"]) == course_name
            ]
            if not candidates:
                candidates = [
                    row
                    for row in rows
                    if row["day"] == day and row["start_section"] == start_section and row["end_section"] == end_section and row["week_expr"] == week_expr
                ]

            if len(candidates) != 1:
                continue

            override = candidates[0]
            classroom = override.get("classroom")
            if classroom:
                course["classroom"] = classroom
            teacher = override.get("teacher")
            if teacher:
                course["teacher"] = teacher
            else:
                course.pop("teacher", None)
            teaching_classes = override.get("teaching_classes")
            if teaching_classes:
                course["teachingClasses"] = teaching_classes
            else:
                course.pop("teachingClasses", None)
            parity = override.get("parity", "all")
            if parity in {"odd", "even"}:
                course["parity"] = parity
            else:
                course.pop("parity", None)


DAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
SUPPORTED_REMINDER_OFFSETS = [60, 30, 15, 5]
DEFAULT_ENABLED_REMINDER_OFFSETS = [30, 15]
DAILY_OVERVIEW_ADVANCE_MINUTES = 30

DEFAULT_TITLE_TEMPLATE = "{display_name}提醒您，{offset} 分钟后即将上课"
OLD_DEFAULT_CONTENT_TEMPLATE = "\n".join(
    [
        "课程：{course_name}",
        "时间：第{week_no}周 {day_label} 第{start_section}-{end_section}节（{start_time}-{end_time}）",
        "时段：{part}",
        "提醒：请提前准备课本和设备，避免迟到。",
    ]
)
DEFAULT_CONTENT_TEMPLATE = "\n".join(
    [
        "课程：{course_name}{classroom_suffix}",
        "时间：第{week_no}周 {day_label} 第{start_section}-{end_section}节（{start_time}-{end_time}）",
        "时段：{part}",
        "提醒：请提前准备课本和设备，避免迟到。",
    ]
)
DEFAULT_TEST_TITLE_TEMPLATE = "{display_name}提醒您，这是一条测试消息"
DEFAULT_TEST_CONTENT_TEMPLATE = "\n".join(
    [
        "课程：{course_name}",
        "时间：{lesson_time}",
        "提示：测试推送正常后，系统会在上课前 30 分钟和 15 分钟自动提醒。",
        "发送时间：{now_text}",
    ]
)
WECOM_CHANNEL_PREFIX = "wecom://"
WECOM_HELP_TEXT = "\n".join(
    [
        "课表提醒菜单：",
        "1) help - 查看菜单",
        "2) bind 姓名 - 绑定课表（例：bind 唐子贤）",
        "3) sub 姓名 - 追加订阅他人课表",
        "4) unsub 姓名 - 取消订阅",
        "5) subs - 查看当前订阅",
        "6) offsets - 查看提醒档位",
        "7) offset 分钟 on|off - 设置提醒档位（60/30/15/5）",
        "8) digest on|off - 开关每日总览",
        "9) test [姓名] - 测试推送",
    ]
)


class RegisterSubscriberRequest(BaseModel):
    name: str = Field(..., min_length=1)
    channel_url: Optional[str] = None
    channel_token: Optional[str] = None
    subscriber_key: Optional[str] = None
    display_name: Optional[str] = None
    disabled_days: Optional[List[int]] = None


class UpdateSubscriberRequest(BaseModel):
    subscriber_key: str = Field(..., min_length=1)
    active: bool


class TestPushRequest(BaseModel):
    subscriber_key: str = Field(..., min_length=1)


class SaveTemplatesRequest(BaseModel):
    title_template: str = Field(..., min_length=1)
    content_template: str = Field(..., min_length=1)
    test_title_template: str = Field(..., min_length=1)
    test_content_template: str = Field(..., min_length=1)


class SaveWecomConfigRequest(BaseModel):
    corp_id: str = Field(..., min_length=1)
    agent_id: str = Field(..., min_length=1)
    corp_secret: Optional[str] = None
    default_touser: Optional[str] = None
    callback_token: Optional[str] = None
    callback_aes_key: Optional[str] = None
    api_base: Optional[str] = None


class SaveMiniProgramConfigRequest(BaseModel):
    app_id: str = Field(..., min_length=1)
    app_secret: Optional[str] = None


class TestMiniProgramConfigRequest(BaseModel):
    app_id: Optional[str] = None
    app_secret: Optional[str] = None


class MiniProgramAuthLoginRequest(BaseModel):
    code: str = Field(..., min_length=1)
    student_id: Optional[str] = None
    student_no: Optional[str] = None
    nickname: Optional[str] = None
    avatar_url: Optional[str] = None
    client_platform: Optional[str] = None


class SocialBindNotifyRequest(BaseModel):
    channel_token: Optional[str] = None
    channel_url: Optional[str] = None
    display_name: Optional[str] = None


class SocialBindStudentRequest(BaseModel):
    target_student_id: str = Field(..., min_length=1)
    target_random_code: Optional[str] = None


class SocialUnsubscribeRequest(BaseModel):
    target_student_id: str = Field(..., min_length=1)


class SocialSubscribeRequest(BaseModel):
    target_student_id: str = Field(..., min_length=1)
    target_random_code: Optional[str] = None


class SocialSaveProfileRequest(BaseModel):
    student_no: Optional[str] = None
    avatar_url: Optional[str] = None
    wallpaper_url: Optional[str] = None


class SocialUpdateRandomCodeRequest(BaseModel):
    random_code: str = Field(..., min_length=1)


class SocialTogglePracticeCourseRequest(BaseModel):
    course_key: str = Field(..., min_length=1)
    enabled: bool


class AdminCreateUserRequest(BaseModel):
    student_id: str = Field(..., min_length=2)
    name: str = Field(..., min_length=1)
    class_label: Optional[str] = None
    student_no: Optional[str] = None
    course_source_student_id: Optional[str] = None
    is_admin: Optional[bool] = None
    random_code: Optional[str] = None


class AdminUpdateUserRequest(BaseModel):
    name: Optional[str] = None
    class_label: Optional[str] = None
    student_no: Optional[str] = None
    course_source_student_id: Optional[str] = None
    is_admin: Optional[bool] = None
    random_code: Optional[str] = None


class AdminUpdateUsersCsvRequest(BaseModel):
    csv_content: str = Field(..., min_length=1)


class AdminUpdateCoursesCsvRequest(BaseModel):
    student_id: str = Field(..., min_length=1)
    csv_content: str = Field(..., min_length=1)


class AdminLoginRequest(BaseModel):
    token: str = Field(..., min_length=1)


class SaveThemeImageRequest(BaseModel):
    theme_key: str = Field(..., min_length=1)
    image_url: Optional[str] = None


app = FastAPI(title="touchx-third-party-reminder", version="0.3.0")
app.state.worker_task = None
app.state.wecom_token = None
app.state.wecom_token_expire_at = 0

allow_origins = [item.strip() for item in CORS_ALLOW_ORIGINS.split(",") if item.strip()]
if not allow_origins:
    allow_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


def validate_admin_web_config() -> None:
    if not ADMIN_WEB_AUTH_TOKEN:
        raise RuntimeError("ADMIN_WEB_AUTH_TOKEN 未配置，无法启用云端网页管理登录")


def _admin_session_sign(payload: str) -> str:
    secret = ADMIN_WEB_AUTH_TOKEN.encode("utf-8")
    return hmac.new(secret, payload.encode("utf-8"), hashlib.sha256).hexdigest()


def create_admin_session() -> Tuple[str, int]:
    expires_at = int(time.time()) + max(600, ADMIN_WEB_SESSION_TTL_SECONDS)
    nonce = secrets.token_urlsafe(12)
    payload = f"{expires_at}.{nonce}"
    signature = _admin_session_sign(payload)
    return f"{payload}.{signature}", expires_at


def is_admin_session_valid(session_value: str) -> bool:
    value = str(session_value or "").strip()
    if not value:
        return False
    parts = value.split(".", 2)
    if len(parts) != 3:
        return False
    exp_text, nonce, got_signature = parts
    if not nonce or not got_signature:
        return False
    try:
        expires_at = int(exp_text)
    except (TypeError, ValueError):
        return False
    if expires_at <= int(time.time()):
        return False
    expected_signature = _admin_session_sign(f"{exp_text}.{nonce}")
    return hmac.compare_digest(got_signature, expected_signature)


def extract_admin_token_from_request(request: Request) -> str:
    authorization = str(request.headers.get("authorization", "")).strip()
    matched = re.match(r"^Bearer\s+(.+)$", authorization, flags=re.IGNORECASE)
    if matched:
        return str(matched.group(1)).strip()
    return str(request.headers.get("x-admin-token", "")).strip()


def extract_admin_session_from_request(request: Request) -> str:
    session_from_header = str(request.headers.get("x-admin-session", "")).strip()
    if session_from_header:
        return session_from_header
    return str(request.cookies.get(ADMIN_WEB_SESSION_COOKIE, "")).strip()


def verify_admin_token(token: str) -> bool:
    value = str(token or "").strip()
    return bool(value and ADMIN_WEB_AUTH_TOKEN and hmac.compare_digest(value, ADMIN_WEB_AUTH_TOKEN))


def is_admin_authenticated(request: Request) -> bool:
    request_token = extract_admin_token_from_request(request)
    if verify_admin_token(request_token):
        return True
    return is_admin_session_valid(extract_admin_session_from_request(request))


def is_admin_protected_path(path: str) -> bool:
    if path == "/admin" or path.startswith("/admin/"):
        return True
    if path in {"/api/admin/login", "/api/admin/logout"}:
        return False
    protected_prefixes = (
        "/api/settings/",
        "/api/admin/",
        "/api/wecom/bindings",
        "/api/subscribers",
    )
    return any(path.startswith(prefix) for prefix in protected_prefixes)


@app.middleware("http")
async def admin_auth_middleware(request: Request, call_next):
    path = request.url.path
    if not is_admin_protected_path(path):
        return await call_next(request)
    if is_admin_authenticated(request):
        return await call_next(request)
    if path == "/admin" or path.startswith("/admin/"):
        return RedirectResponse(url="/login", status_code=302)
    return JSONResponse(status_code=401, content={"detail": "未登录或登录已过期"})


def get_timezone() -> timezone:
    if TIMEZONE_NAME == "Asia/Shanghai":
        return timezone(timedelta(hours=8))
    return timezone.utc


def get_now() -> datetime:
    return datetime.now(get_timezone())


def parse_term_start_date() -> datetime:
    year, month, day = [int(x) for x in TERM_WEEK1_MONDAY.split("-")]
    return datetime(year, month, day, tzinfo=get_timezone())


def normalize_name(name: str) -> str:
    return re.sub(r"\s+", "", name).strip()


def resolve_student_id_by_name(name: str) -> Optional[str]:
    return NAME_ALIASES.get(normalize_name(name))


def resolve_student_id_by_student_no(student_no: Optional[str]) -> Optional[str]:
    normalized = (student_no or "").strip()
    if not normalized:
        return None
    for student_id, schedule in SCHEDULES.items():
        if str(schedule.get("studentNo", "")).strip() == normalized:
            return student_id
    with db_connection() as conn:
        row = conn.execute(
            """
            SELECT student_id
            FROM user_profiles
            WHERE student_no=?
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            (normalized,),
        ).fetchone()
    if not row:
        return None
    candidate = str(row["student_id"] or "").strip()
    if candidate in SCHEDULES:
        return candidate
    return None


def ensure_channel_url(channel_url: Optional[str]) -> str:
    value = (channel_url or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="请输入企业微信用户 ID 或 wecom://用户ID")
    if value.startswith("http://") or value.startswith("https://"):
        raise HTTPException(status_code=400, detail="已移除 xizhi 通道，请使用企业微信用户 ID")
    user_id = parse_wecom_userid(value)
    if not user_id:
        raise HTTPException(status_code=400, detail="企业微信用户 ID 不能为空")
    return build_wecom_channel(user_id)


def build_channel_url_from_token(channel_token: Optional[str]) -> Optional[str]:
    token = (channel_token or "").strip()
    if not token:
        return None
    if token.startswith("http://") or token.startswith("https://"):
        return token
    if token.startswith(WECOM_CHANNEL_PREFIX):
        return token
    return build_wecom_channel(token)


def make_subscriber_key(student_id: str, channel_url: str) -> str:
    source = f"{student_id}::{channel_url}".encode("utf-8")
    return hashlib.sha1(source).hexdigest()[:20]


def build_wecom_channel(user_id: str) -> str:
    return f"{WECOM_CHANNEL_PREFIX}{user_id.strip()}"


def is_wecom_channel_url(channel_url: str) -> bool:
    return (channel_url or "").strip().startswith(WECOM_CHANNEL_PREFIX)


def parse_wecom_userid(channel_url: str) -> str:
    value = (channel_url or "").strip()
    if value.startswith(WECOM_CHANNEL_PREFIX):
        return value[len(WECOM_CHANNEL_PREFIX) :].strip()
    if value.startswith("http://") or value.startswith("https://"):
        return ""
    return value


def normalize_display_name(display_name: Optional[str], fallback: str) -> str:
    value = (display_name or "").strip()
    return value or fallback


def build_absolute_url(request: Request, path: str) -> str:
    base = str(request.base_url).rstrip("/")
    return f"{base}{path}"


def parse_image_extension(data: bytes) -> str:
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "gif"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    raise HTTPException(status_code=400, detail="仅支持 jpg/png/gif/webp 图片")


def save_uploaded_image(request: Request, upload: UploadFile, usage: str, max_bytes: int) -> str:
    content = upload.file.read(max_bytes + 1)
    if not content:
        raise HTTPException(status_code=400, detail="上传文件为空")
    if len(content) > max_bytes:
        size_mb = max_bytes / 1024 / 1024
        raise HTTPException(status_code=400, detail=f"图片过大，限制 {size_mb:.1f}MB")
    extension = parse_image_extension(content)
    file_name = f"{usage}-{int(time.time())}-{secrets.token_hex(8)}.{extension}"
    target_path = MEDIA_STORAGE_DIR / file_name
    target_path.write_bytes(content)
    return build_absolute_url(request, f"{MEDIA_BASE_PATH}/{file_name}")


def resolve_media_file_path(file_name: str) -> Path:
    normalized = (file_name or "").strip()
    if not re.fullmatch(r"[A-Za-z0-9._-]{6,120}", normalized):
        raise HTTPException(status_code=404, detail="资源不存在")
    target = (MEDIA_STORAGE_DIR / normalized).resolve()
    try:
        target.relative_to(MEDIA_STORAGE_DIR.resolve())
    except ValueError as error:
        raise HTTPException(status_code=404, detail="资源不存在") from error
    if not target.exists() or not target.is_file():
        raise HTTPException(status_code=404, detail="资源不存在")
    return target


def normalize_disabled_days(days: Optional[List[int]]) -> List[int]:
    if days is None:
        return []
    normalized: List[int] = []
    for day in days:
        day_no = int(day)
        if day_no < 1 or day_no > 7:
            raise HTTPException(status_code=400, detail="disabled_days 仅支持 1-7（周一到周日）")
        if day_no not in normalized:
            normalized.append(day_no)
    return sorted(normalized)


def parse_disabled_days(raw: Any) -> List[int]:
    if raw is None:
        return []
    if isinstance(raw, list):
        data = raw
    else:
        text = str(raw).strip()
        if not text:
            return []
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            return []
    if not isinstance(data, list):
        return []
    cleaned: List[int] = []
    for item in data:
        try:
            day_no = int(item)
        except (TypeError, ValueError):
            continue
        if 1 <= day_no <= 7 and day_no not in cleaned:
            cleaned.append(day_no)
    return sorted(cleaned)


def encode_disabled_days(days: List[int]) -> str:
    return json.dumps(sorted(days), ensure_ascii=False)


def normalize_reminder_offsets(offsets: Optional[List[int]]) -> List[int]:
    if offsets is None:
        return list(DEFAULT_ENABLED_REMINDER_OFFSETS)
    normalized: List[int] = []
    for item in offsets:
        value = int(item)
        if value not in SUPPORTED_REMINDER_OFFSETS:
            raise HTTPException(status_code=400, detail=f"reminder_offsets 仅支持 {SUPPORTED_REMINDER_OFFSETS}")
        if value not in normalized:
            normalized.append(value)
    if not normalized:
        raise HTTPException(status_code=400, detail="reminder_offsets 不能为空")
    return sorted(normalized, reverse=True)


def parse_reminder_offsets(raw: Any) -> List[int]:
    if raw is None:
        return list(DEFAULT_ENABLED_REMINDER_OFFSETS)
    if isinstance(raw, list):
        data = raw
    else:
        text = str(raw).strip()
        if not text:
            return list(DEFAULT_ENABLED_REMINDER_OFFSETS)
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            return list(DEFAULT_ENABLED_REMINDER_OFFSETS)
    if not isinstance(data, list):
        return list(DEFAULT_ENABLED_REMINDER_OFFSETS)
    result: List[int] = []
    for item in data:
        try:
            value = int(item)
        except (TypeError, ValueError):
            continue
        if value in SUPPORTED_REMINDER_OFFSETS and value not in result:
            result.append(value)
    if not result:
        return list(DEFAULT_ENABLED_REMINDER_OFFSETS)
    return sorted(result, reverse=True)


def encode_reminder_offsets(offsets: List[int]) -> str:
    return json.dumps(sorted(offsets, reverse=True), ensure_ascii=False)


def serialize_subscriber_row(row: sqlite3.Row) -> Dict[str, Any]:
    item = dict(row)
    item["active"] = bool(item.get("active", 0))
    item["disabled_days"] = parse_disabled_days(item.get("disabled_days"))
    item["reminder_offsets"] = parse_reminder_offsets(item.get("reminder_offsets"))
    item["daily_overview"] = bool(item.get("daily_overview", 0))
    return item


def get_setting_values(keys: List[str]) -> Dict[str, str]:
    if not keys:
        return {}
    placeholders = ",".join("?" for _ in keys)
    with db_connection() as conn:
        rows = conn.execute(f"SELECT key, value FROM app_settings WHERE key IN ({placeholders})", tuple(keys)).fetchall()
    return {row["key"]: row["value"] for row in rows}


def set_setting_values(data: Dict[str, str]) -> None:
    now_ts = int(time.time())
    with db_connection() as conn:
        for key, value in data.items():
            conn.execute(
                """
                INSERT INTO app_settings (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                  value=excluded.value,
                  updated_at=excluded.updated_at
                """,
                (key, value, now_ts),
            )


def normalize_theme_key(value: str) -> str:
    key = str(value or "").strip().lower()
    if key not in THEME_KEYS:
        raise HTTPException(status_code=400, detail=f"theme_key 仅支持 {', '.join(THEME_KEYS)}")
    return key


def normalize_theme_image_url(url: Optional[str]) -> str:
    normalized = normalize_media_url(url, max_length=500)
    if not normalized:
        return ""
    if normalized.startswith("/"):
        return normalized
    parsed = urllib.parse.urlparse(normalized)
    path = str(parsed.path or "").strip()
    if path.startswith(f"{MEDIA_BASE_PATH}/"):
        return path
    return normalized


def parse_theme_image_map(raw: Any) -> Dict[str, str]:
    if raw is None:
        return {}
    data: Any = raw
    if isinstance(raw, str):
        text = raw.strip()
        if not text:
            return {}
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            return {}
    if not isinstance(data, dict):
        return {}
    images: Dict[str, str] = {}
    for key, value in data.items():
        try:
            theme_key = normalize_theme_key(str(key))
        except HTTPException:
            continue
        image_url = normalize_theme_image_url(str(value or ""))
        if image_url:
            images[theme_key] = image_url
    return images


def get_theme_image_settings() -> Tuple[Dict[str, str], int]:
    with db_connection() as conn:
        row = conn.execute(
            """
            SELECT value, updated_at
            FROM app_settings
            WHERE key='theme_image_map'
            LIMIT 1
            """
        ).fetchone()
    if not row:
        return {}, 0
    return parse_theme_image_map(row["value"]), int(row["updated_at"] or 0)


def save_theme_image_settings(images: Dict[str, str]) -> Dict[str, Any]:
    normalized: Dict[str, str] = {}
    for key, value in images.items():
        theme_key = normalize_theme_key(key)
        image_url = normalize_theme_image_url(value)
        if image_url:
            normalized[theme_key] = image_url
    set_setting_values({"theme_image_map": json.dumps(normalized, ensure_ascii=False)})
    current_images, updated_at = get_theme_image_settings()
    return {"images": current_images, "updatedAt": updated_at}


def update_single_theme_image(theme_key: str, image_url: Optional[str]) -> Dict[str, Any]:
    normalized_theme_key = normalize_theme_key(theme_key)
    normalized_url = normalize_theme_image_url(image_url)
    images, _ = get_theme_image_settings()
    if normalized_url:
        images[normalized_theme_key] = normalized_url
    else:
        images.pop(normalized_theme_key, None)
    result = save_theme_image_settings(images)
    result["themeKey"] = normalized_theme_key
    result["imageUrl"] = normalized_url
    return result


def ensure_default_theme_image_seed() -> None:
    images, _ = get_theme_image_settings()
    if images.get("purple"):
        return
    for candidate in DEFAULT_THEME_IMAGE_CANDIDATES:
        if not candidate.exists() or not candidate.is_file():
            continue
        try:
            content = candidate.read_bytes()
            parse_image_extension(content)
            target = MEDIA_STORAGE_DIR / DEFAULT_THEME_PURPLE_FILE_NAME
            if not target.exists():
                target.write_bytes(content)
            images["purple"] = f"{MEDIA_BASE_PATH}/{target.name}"
            save_theme_image_settings(images)
            return
        except Exception:
            continue


def get_push_templates() -> Dict[str, str]:
    defaults = {
        "title_template": DEFAULT_TITLE_TEMPLATE,
        "content_template": DEFAULT_CONTENT_TEMPLATE,
        "test_title_template": DEFAULT_TEST_TITLE_TEMPLATE,
        "test_content_template": DEFAULT_TEST_CONTENT_TEMPLATE,
    }
    result = dict(defaults)
    result.update(get_setting_values(list(defaults.keys())))
    return result


def save_push_templates(payload: SaveTemplatesRequest) -> None:
    entries = {
        "title_template": payload.title_template.strip(),
        "content_template": payload.content_template.strip(),
        "test_title_template": payload.test_title_template.strip(),
        "test_content_template": payload.test_content_template.strip(),
    }
    if not all(entries.values()):
        raise HTTPException(status_code=400, detail="模板内容不能为空")
    set_setting_values(entries)


def get_wecom_config() -> Dict[str, str]:
    defaults = {
        "api_base": WECOM_API_BASE,
        "corp_id": WECOM_CORP_ID,
        "agent_id": WECOM_AGENT_ID,
        "corp_secret": WECOM_CORP_SECRET,
        "default_touser": WECOM_DEFAULT_TOUSER,
        "callback_token": WECOM_CALLBACK_TOKEN,
        "callback_aes_key": WECOM_CALLBACK_AES_KEY,
    }
    saved = get_setting_values(
        [
            "wecom_api_base",
            "wecom_corp_id",
            "wecom_agent_id",
            "wecom_corp_secret",
            "wecom_default_touser",
            "wecom_callback_token",
            "wecom_callback_aes_key",
        ]
    )
    return {
        "api_base": saved.get("wecom_api_base", defaults["api_base"]).strip().rstrip("/"),
        "corp_id": saved.get("wecom_corp_id", defaults["corp_id"]).strip(),
        "agent_id": saved.get("wecom_agent_id", defaults["agent_id"]).strip(),
        "corp_secret": saved.get("wecom_corp_secret", defaults["corp_secret"]).strip(),
        "default_touser": saved.get("wecom_default_touser", defaults["default_touser"]).strip(),
        "callback_token": saved.get("wecom_callback_token", defaults["callback_token"]).strip(),
        "callback_aes_key": saved.get("wecom_callback_aes_key", defaults["callback_aes_key"]).strip(),
    }


def save_wecom_config(payload: SaveWecomConfigRequest) -> Dict[str, str]:
    existing = get_wecom_config()
    api_base = (payload.api_base or "").strip().rstrip("/") or existing.get("api_base") or WECOM_API_BASE
    if not api_base.startswith("http://") and not api_base.startswith("https://"):
        raise HTTPException(status_code=400, detail="api_base 必须是 http(s) 地址")

    callback_aes_key = (payload.callback_aes_key or "").strip() or existing.get("callback_aes_key", "")
    if callback_aes_key and len(callback_aes_key) != 43:
        raise HTTPException(status_code=400, detail="callback_aes_key 长度必须是 43")

    values = {
        "api_base": api_base,
        "corp_id": payload.corp_id.strip(),
        "agent_id": payload.agent_id.strip(),
        "corp_secret": (payload.corp_secret or "").strip() or existing.get("corp_secret", ""),
        "default_touser": (payload.default_touser or "").strip() or existing.get("default_touser", ""),
        "callback_token": (payload.callback_token or "").strip() or existing.get("callback_token", ""),
        "callback_aes_key": callback_aes_key,
    }
    for key in ["api_base", "corp_id", "agent_id", "corp_secret", "default_touser"]:
        if not values[key]:
            raise HTTPException(status_code=400, detail=f"企业微信配置不完整：{key} 不能为空")
    if bool(values["callback_token"]) != bool(values["callback_aes_key"]):
        raise HTTPException(status_code=400, detail="callback_token 和 callback_aes_key 需同时配置")
    set_setting_values(
        {
            "wecom_api_base": values["api_base"],
            "wecom_corp_id": values["corp_id"],
            "wecom_agent_id": values["agent_id"],
            "wecom_corp_secret": values["corp_secret"],
            "wecom_default_touser": values["default_touser"],
            "wecom_callback_token": values["callback_token"],
            "wecom_callback_aes_key": values["callback_aes_key"],
        }
    )
    app.state.wecom_token = None
    app.state.wecom_token_expire_at = 0
    return values


def mask_secret(value: str, prefix: int = 4, suffix: int = 4) -> str:
    if not value:
        return ""
    if len(value) <= prefix + suffix:
        return "*" * len(value)
    return f"{value[:prefix]}****{value[-suffix:]}"


def get_wecom_config_public() -> Dict[str, Any]:
    config = get_wecom_config()
    return {
        "api_base": config["api_base"],
        "corp_id": config["corp_id"],
        "agent_id": config["agent_id"],
        "default_touser": config["default_touser"],
        "corp_secret_masked": mask_secret(config["corp_secret"]),
        "callback_token_masked": mask_secret(config["callback_token"]),
        "callback_aes_key_masked": mask_secret(config["callback_aes_key"], prefix=6, suffix=6),
        "configured": bool(config["corp_id"] and config["agent_id"] and config["corp_secret"] and config["default_touser"]),
        "callback_configured": bool(config["callback_token"] and config["callback_aes_key"]),
    }


def get_mini_program_config() -> Dict[str, str]:
    defaults = {
        "app_id": MP_WECHAT_APPID,
        "app_secret": MP_WECHAT_SECRET,
    }
    saved = get_setting_values(["mp_wechat_appid", "mp_wechat_secret"])
    return {
        "app_id": saved.get("mp_wechat_appid", defaults["app_id"]).strip(),
        "app_secret": saved.get("mp_wechat_secret", defaults["app_secret"]).strip(),
    }


def resolve_mini_program_credentials(app_id_input: Optional[str] = None, app_secret_input: Optional[str] = None) -> Dict[str, str]:
    existing = get_mini_program_config()
    app_id = (app_id_input or "").strip() or existing.get("app_id", "")
    app_secret = (app_secret_input or "").strip() or existing.get("app_secret", "")
    if not app_id or not app_secret:
        raise RuntimeError("小程序登录配置不完整：app_id/app_secret 不能为空")
    return {"app_id": app_id, "app_secret": app_secret}


def save_mini_program_config(payload: SaveMiniProgramConfigRequest) -> Dict[str, str]:
    try:
        values = resolve_mini_program_credentials(payload.app_id, payload.app_secret)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    set_setting_values(
        {
            "mp_wechat_appid": values["app_id"],
            "mp_wechat_secret": values["app_secret"],
        }
    )
    return values


def get_mini_program_config_public() -> Dict[str, Any]:
    config = get_mini_program_config()
    return {
        "app_id": config["app_id"],
        "app_secret_masked": mask_secret(config["app_secret"], prefix=6, suffix=6),
        "configured": bool(config["app_id"] and config["app_secret"]),
    }


def test_mini_program_connection(app_id_input: Optional[str] = None, app_secret_input: Optional[str] = None) -> Dict[str, Any]:
    creds = resolve_mini_program_credentials(app_id_input, app_secret_input)
    app_id = creds["app_id"]
    app_secret = creds["app_secret"]
    payload = {
        "grant_type": "client_credential",
        "appid": app_id,
        "secret": app_secret,
        "force_refresh": False,
    }
    request = urllib.request.Request(
        url="https://api.weixin.qq.com/cgi-bin/stable_token",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            body = response.read().decode("utf-8", "ignore")
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"小程序鉴权网关错误: HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"小程序鉴权网络错误: {exc.reason}") from exc

    try:
        parsed = json.loads(body or "{}")
    except json.JSONDecodeError as exc:
        raise RuntimeError("小程序鉴权返回格式异常") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError("小程序鉴权返回格式异常")

    errcode = int(parsed.get("errcode") or 0)
    if errcode != 0:
        errmsg = str(parsed.get("errmsg") or "unknown")
        raise RuntimeError(f"小程序鉴权失败: {errmsg}({errcode})")

    access_token = str(parsed.get("access_token") or "").strip()
    if not access_token:
        raise RuntimeError("小程序鉴权成功但 access_token 为空")
    expires_in = int(parsed.get("expires_in") or 0)
    return {
        "ok": True,
        "access_token_preview": f"{access_token[:8]}...",
        "expires_in": expires_in,
    }


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    MEDIA_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS subscribers (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              subscriber_key TEXT NOT NULL UNIQUE,
              name TEXT NOT NULL,
              student_id TEXT NOT NULL,
              channel_url TEXT NOT NULL,
              display_name TEXT NOT NULL DEFAULT '',
              disabled_days TEXT NOT NULL DEFAULT '[]',
              reminder_offsets TEXT NOT NULL DEFAULT '[30, 15]',
              daily_overview INTEGER NOT NULL DEFAULT 0,
              active INTEGER NOT NULL DEFAULT 1,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sent_notifications (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              subscriber_key TEXT NOT NULL,
              student_id TEXT NOT NULL,
              week_no INTEGER NOT NULL,
              day_no INTEGER NOT NULL,
              start_section INTEGER NOT NULL,
              reminder_minutes INTEGER NOT NULL,
              lesson_start_ts INTEGER NOT NULL,
              created_at INTEGER NOT NULL,
              UNIQUE(subscriber_key, week_no, day_no, start_section, reminder_minutes)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS daily_overview_notifications (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              channel_url TEXT NOT NULL,
              date_key TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              UNIQUE(channel_url, date_key)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS app_settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL,
              updated_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS auth_sessions (
              token TEXT PRIMARY KEY,
              open_id TEXT NOT NULL,
              auth_mode TEXT NOT NULL,
              student_id TEXT NOT NULL,
              nickname TEXT NOT NULL DEFAULT '',
              avatar_url TEXT NOT NULL DEFAULT '',
              expires_at INTEGER NOT NULL,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS auth_bindings (
              open_id TEXT PRIMARY KEY,
              student_id TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_profiles (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              student_id TEXT NOT NULL UNIQUE,
              random_code TEXT NOT NULL UNIQUE,
              is_admin INTEGER NOT NULL DEFAULT 0,
              student_no TEXT NOT NULL DEFAULT '',
              notify_channel_url TEXT NOT NULL DEFAULT '',
              avatar_url TEXT NOT NULL DEFAULT '',
              wallpaper_url TEXT NOT NULL DEFAULT '',
              practice_course_keys TEXT NOT NULL DEFAULT '[]',
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_subscriptions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              subscriber_student_id TEXT NOT NULL,
              target_student_id TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              UNIQUE(subscriber_student_id, target_student_id)
            )
            """
        )

        columns = {row[1] for row in conn.execute("PRAGMA table_info(subscribers)").fetchall()}
        if "display_name" not in columns:
            conn.execute("ALTER TABLE subscribers ADD COLUMN display_name TEXT NOT NULL DEFAULT ''")
        if "disabled_days" not in columns:
            conn.execute("ALTER TABLE subscribers ADD COLUMN disabled_days TEXT NOT NULL DEFAULT '[]'")
        if "reminder_offsets" not in columns:
            conn.execute("ALTER TABLE subscribers ADD COLUMN reminder_offsets TEXT NOT NULL DEFAULT '[30, 15]'")
        if "daily_overview" not in columns:
            conn.execute("ALTER TABLE subscribers ADD COLUMN daily_overview INTEGER NOT NULL DEFAULT 0")

        user_profile_columns = {row[1] for row in conn.execute("PRAGMA table_info(user_profiles)").fetchall()}
        if "student_no" not in user_profile_columns:
            conn.execute("ALTER TABLE user_profiles ADD COLUMN student_no TEXT NOT NULL DEFAULT ''")
        if "avatar_url" not in user_profile_columns:
            conn.execute("ALTER TABLE user_profiles ADD COLUMN avatar_url TEXT NOT NULL DEFAULT ''")
        if "wallpaper_url" not in user_profile_columns:
            conn.execute("ALTER TABLE user_profiles ADD COLUMN wallpaper_url TEXT NOT NULL DEFAULT ''")
        if "practice_course_keys" not in user_profile_columns:
            conn.execute("ALTER TABLE user_profiles ADD COLUMN practice_course_keys TEXT NOT NULL DEFAULT '[]'")
        normalize_user_profile_random_codes(conn)

        now_ts = int(time.time())
        for key, default_value in {
            "title_template": DEFAULT_TITLE_TEMPLATE,
            "content_template": DEFAULT_CONTENT_TEMPLATE,
            "test_title_template": DEFAULT_TEST_TITLE_TEMPLATE,
            "test_content_template": DEFAULT_TEST_CONTENT_TEMPLATE,
        }.items():
            conn.execute(
                """
                INSERT OR IGNORE INTO app_settings (key, value, updated_at)
                VALUES (?, ?, ?)
                """,
                (key, default_value, now_ts),
            )
        row = conn.execute("SELECT value FROM app_settings WHERE key='content_template' LIMIT 1").fetchone()
        if row and row[0] == OLD_DEFAULT_CONTENT_TEMPLATE:
            conn.execute(
                "UPDATE app_settings SET value=?, updated_at=? WHERE key='content_template'",
                (DEFAULT_CONTENT_TEMPLATE, now_ts),
            )

        for key, value in {
            "wecom_api_base": WECOM_API_BASE,
            "wecom_corp_id": WECOM_CORP_ID,
            "wecom_agent_id": WECOM_AGENT_ID,
            "wecom_corp_secret": WECOM_CORP_SECRET,
            "wecom_default_touser": WECOM_DEFAULT_TOUSER,
            "wecom_callback_token": WECOM_CALLBACK_TOKEN,
            "wecom_callback_aes_key": WECOM_CALLBACK_AES_KEY,
            "mp_wechat_appid": MP_WECHAT_APPID,
            "mp_wechat_secret": MP_WECHAT_SECRET,
        }.items():
            if not value:
                continue
            conn.execute(
                """
                INSERT OR IGNORE INTO app_settings (key, value, updated_at)
                VALUES (?, ?, ?)
                """,
                (key, value, now_ts),
            )


def db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_student_exists(student_id: str) -> None:
    if student_id not in SCHEDULES:
        raise HTTPException(status_code=404, detail="student_id 不存在")


def trim_profile_text(value: Optional[str], max_length: int) -> str:
    text = (value or "").strip()
    if not text:
        return ""
    return text[:max_length]


def mask_student_no(value: str) -> str:
    student_no = trim_profile_text(value, max_length=32)
    length = len(student_no)
    if length <= 0:
        return ""
    if length == 1:
        return "*"
    if length == 2:
        return f"{student_no[0]}*"
    if length == 3:
        return f"{student_no[0]}*{student_no[-1]}"
    if length == 4:
        return f"{student_no[:1]}**{student_no[-1:]}"
    return f"{student_no[:2]}{'*' * (length - 4)}{student_no[-2:]}"


def cleanup_expired_auth_sessions() -> None:
    now_ts = int(time.time())
    with db_connection() as conn:
        conn.execute("DELETE FROM auth_sessions WHERE expires_at<=?", (now_ts,))


def get_auth_binding_student(open_id: str) -> str:
    normalized_open_id = (open_id or "").strip()
    if not normalized_open_id:
        return ""
    with db_connection() as conn:
        row = conn.execute(
            """
            SELECT student_id
            FROM auth_bindings
            WHERE open_id=?
            LIMIT 1
            """,
            (normalized_open_id,),
        ).fetchone()
    return str(row["student_id"] if row else "").strip()


def get_auth_binding_open_id(student_id: str) -> str:
    normalized_student_id = (student_id or "").strip()
    if not normalized_student_id:
        return ""
    with db_connection() as conn:
        row = conn.execute(
            """
            SELECT open_id
            FROM auth_bindings
            WHERE student_id=?
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            (normalized_student_id,),
        ).fetchone()
    return str(row["open_id"] if row else "").strip()


def ensure_auth_binding_allowed(open_id: str, student_id: str) -> None:
    normalized_open_id = (open_id or "").strip()
    normalized_student_id = (student_id or "").strip()
    if not normalized_open_id or not normalized_student_id:
        return
    ensure_student_exists(normalized_student_id)
    bound_student_id = get_auth_binding_student(normalized_open_id)
    if bound_student_id and bound_student_id != normalized_student_id:
        raise HTTPException(status_code=403, detail="当前微信已绑定其他课表账号，请先手动解除授权")
    bound_open_id = get_auth_binding_open_id(normalized_student_id)
    if bound_open_id and bound_open_id != normalized_open_id:
        raise HTTPException(status_code=403, detail="该课表账号已绑定其他微信，请先由原微信手动解除授权")


def set_auth_binding(open_id: str, student_id: str) -> None:
    normalized_open_id = (open_id or "").strip()
    normalized_student_id = (student_id or "").strip()
    if not normalized_open_id or not normalized_student_id:
        return
    ensure_student_exists(normalized_student_id)
    now_ts = int(time.time())
    with db_connection() as conn:
        conn.execute(
            """
            DELETE FROM auth_bindings
            WHERE student_id=? AND open_id<>?
            """,
            (normalized_student_id, normalized_open_id),
        )
        conn.execute(
            """
            INSERT INTO auth_bindings (open_id, student_id, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(open_id) DO UPDATE SET
              student_id=excluded.student_id,
              updated_at=excluded.updated_at
            """,
            (normalized_open_id, normalized_student_id, now_ts, now_ts),
        )


def remove_auth_binding(open_id: str) -> None:
    normalized_open_id = (open_id or "").strip()
    if not normalized_open_id:
        return
    with db_connection() as conn:
        conn.execute("DELETE FROM auth_bindings WHERE open_id=?", (normalized_open_id,))


def remove_auth_binding_by_student(student_id: str) -> None:
    normalized_student_id = (student_id or "").strip()
    if not normalized_student_id:
        return
    with db_connection() as conn:
        conn.execute("DELETE FROM auth_bindings WHERE student_id=?", (normalized_student_id,))


def resolve_wechat_openid(code: str) -> Tuple[str, str]:
    mini_program = get_mini_program_config()
    app_id = mini_program.get("app_id", "")
    app_secret = mini_program.get("app_secret", "")
    if not app_id or not app_secret:
        raise HTTPException(status_code=503, detail="微信登录未配置，请先设置 MP_WECHAT_APPID 与 MP_WECHAT_SECRET")
    query = urllib.parse.urlencode(
        {
            "appid": app_id,
            "secret": app_secret,
            "js_code": code,
            "grant_type": "authorization_code",
        }
    )
    url = f"https://api.weixin.qq.com/sns/jscode2session?{query}"
    request = urllib.request.Request(url=url, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            body = response.read().decode("utf-8", "ignore")
    except urllib.error.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"微信登录网关错误: HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise HTTPException(status_code=502, detail=f"微信登录网络错误: {exc.reason}") from exc

    try:
        parsed = json.loads(body or "{}")
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=502, detail="微信登录返回格式异常") from exc

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=502, detail="微信登录返回格式异常")

    errcode = int(parsed.get("errcode") or 0)
    if errcode != 0:
        errmsg = str(parsed.get("errmsg") or "unknown error")
        raise HTTPException(status_code=400, detail=f"微信授权失败: {errmsg}({errcode})")

    open_id = str(parsed.get("openid") or "").strip()
    if not open_id:
        raise HTTPException(status_code=502, detail="微信授权成功但 openid 为空")
    return open_id, "wechat"


def build_auth_response_row(row: sqlite3.Row) -> Dict[str, Any]:
    student_id = str(row["student_id"] or "").strip()
    nickname = str(row["nickname"] or "").strip()
    schedule_name = str(SCHEDULES.get(student_id, {}).get("name") or "")
    class_label = str(SCHEDULES.get(student_id, {}).get("classLabel") or "")
    return {
        "openId": row["open_id"],
        "studentId": student_id,
        "studentName": schedule_name,
        "classLabel": class_label,
        "nickname": nickname or schedule_name or "未绑定账号",
        "avatarUrl": row["avatar_url"] or "",
        "mode": row["auth_mode"] or "mock",
        "token": row["token"],
        "expiresAt": int(row["expires_at"]),
        "isBound": bool(student_id),
    }


def create_auth_session(open_id: str, auth_mode: str, student_id: str, nickname: str, avatar_url: str) -> Dict[str, Any]:
    cleanup_expired_auth_sessions()
    now_ts = int(time.time())
    expires_at = now_ts + max(1800, AUTH_SESSION_TTL_SECONDS)
    token = secrets.token_urlsafe(32)
    with db_connection() as conn:
        conn.execute(
            """
            INSERT INTO auth_sessions (token, open_id, auth_mode, student_id, nickname, avatar_url, expires_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (token, open_id, auth_mode, student_id, nickname, avatar_url, expires_at, now_ts, now_ts),
        )
        row = conn.execute("SELECT * FROM auth_sessions WHERE token=? LIMIT 1", (token,)).fetchone()
    if not row:
        raise HTTPException(status_code=500, detail="创建登录会话失败")
    return build_auth_response_row(row)


def get_auth_session_by_token(token: str) -> Optional[Dict[str, Any]]:
    if not token:
        return None
    cleanup_expired_auth_sessions()
    with db_connection() as conn:
        row = conn.execute(
            """
            SELECT token, open_id, auth_mode, student_id, nickname, avatar_url, expires_at
            FROM auth_sessions
            WHERE token=?
            LIMIT 1
            """,
            (token,),
        ).fetchone()
    if not row:
        return None
    return build_auth_response_row(row)


def update_auth_session_avatar(token: str, avatar_url: str) -> None:
    normalized = normalize_media_url(avatar_url, max_length=300)
    if not token:
        return
    with db_connection() as conn:
        conn.execute(
            """
            UPDATE auth_sessions
            SET avatar_url=?, updated_at=?
            WHERE token=?
            """,
            (normalized, int(time.time()), token),
        )


def update_auth_session_student(token: str, student_id: str) -> None:
    normalized_student_id = student_id.strip()
    ensure_student_exists(normalized_student_id)
    with db_connection() as conn:
        conn.execute(
            """
            UPDATE auth_sessions
            SET student_id=?, updated_at=?
            WHERE token=?
            """,
            (normalized_student_id, int(time.time()), token),
        )


def parse_auth_token_from_request(request: Request) -> str:
    authorization = str(request.headers.get("authorization", "")).strip()
    match = re.match(r"^Bearer\s+(.+)$", authorization, flags=re.IGNORECASE)
    if match:
        return match.group(1).strip()
    return str(request.headers.get("x-auth-token", "")).strip()


def require_auth_session(request: Request) -> Dict[str, Any]:
    token = parse_auth_token_from_request(request)
    if not token:
        raise HTTPException(status_code=401, detail="未登录或登录已失效")
    session = get_auth_session_by_token(token)
    if not session:
        raise HTTPException(status_code=401, detail="未登录或登录已失效")
    return session


def require_bound_student_id(session: Dict[str, Any]) -> str:
    student_id = str(session.get("studentId") or "").strip()
    if not student_id:
        raise HTTPException(status_code=400, detail="请先绑定课表账号")
    ensure_student_exists(student_id)
    return student_id


def require_admin_session(request: Request) -> Dict[str, Any]:
    if not is_admin_authenticated(request):
        raise HTTPException(status_code=401, detail="未登录或登录已过期")
    return {"ok": True}


def revoke_auth_session(token: str) -> None:
    if not token:
        return
    with db_connection() as conn:
        conn.execute("DELETE FROM auth_sessions WHERE token=?", (token,))


def revoke_auth_sessions_by_open_id(open_id: str) -> None:
    normalized_open_id = (open_id or "").strip()
    if not normalized_open_id:
        return
    with db_connection() as conn:
        conn.execute("DELETE FROM auth_sessions WHERE open_id=?", (normalized_open_id,))


def normalize_random_code(value: str) -> str:
    return re.sub(r"\D+", "", str(value or "")).strip()[:RANDOM_CODE_LENGTH]


def generate_random_code() -> str:
    return f"{secrets.randbelow(RANDOM_CODE_SPACE_SIZE):0{RANDOM_CODE_LENGTH}d}"


def is_valid_random_code(code: str) -> bool:
    return bool(re.fullmatch(rf"\d{{{RANDOM_CODE_LENGTH}}}", code or ""))


def random_code_exists(conn: sqlite3.Connection, code: str, exclude_student_id: str = "") -> bool:
    normalized_code = normalize_random_code(code)
    if not is_valid_random_code(normalized_code):
        return True
    sql = "SELECT 1 FROM user_profiles WHERE random_code=?"
    params: List[Any] = [normalized_code]
    if exclude_student_id:
        sql += " AND student_id<>?"
        params.append(exclude_student_id)
    row = conn.execute(f"{sql} LIMIT 1", tuple(params)).fetchone()
    return bool(row)


def generate_unique_random_code(conn: sqlite3.Connection, exclude_student_id: str = "") -> str:
    for _ in range(RANDOM_CODE_MAX_ATTEMPTS):
        candidate = generate_random_code()
        if not random_code_exists(conn, candidate, exclude_student_id=exclude_student_id):
            return candidate
    for value in range(RANDOM_CODE_SPACE_SIZE):
        candidate = f"{value:0{RANDOM_CODE_LENGTH}d}"
        if not random_code_exists(conn, candidate, exclude_student_id=exclude_student_id):
            return candidate
    raise RuntimeError("随机验证码已耗尽")


def normalize_user_profile_random_codes(conn: sqlite3.Connection) -> None:
    rows = conn.execute(
        """
        SELECT student_id, random_code
        FROM user_profiles
        ORDER BY id ASC
        """
    ).fetchall()
    if not rows:
        return
    now_ts = int(time.time())
    for row in rows:
        student_id = str(row[0] or "").strip()
        raw_code = str(row[1] or "").strip()
        normalized_code = normalize_random_code(raw_code)
        if (
            student_id
            and is_valid_random_code(normalized_code)
            and not random_code_exists(conn, normalized_code, exclude_student_id=student_id)
        ):
            if raw_code != normalized_code:
                conn.execute(
                    """
                    UPDATE user_profiles
                    SET random_code=?, updated_at=?
                    WHERE student_id=?
                    """,
                    (normalized_code, now_ts, student_id),
                )
            continue
        replacement = generate_unique_random_code(conn, exclude_student_id=student_id)
        conn.execute(
            """
            UPDATE user_profiles
            SET random_code=?, updated_at=?
            WHERE student_id=?
            """,
            (replacement, now_ts, student_id),
        )


def count_admin_users() -> int:
    with db_connection() as conn:
        row = conn.execute("SELECT COUNT(1) AS c FROM user_profiles WHERE is_admin=1").fetchone()
    return int(row["c"] if row else 0)


def normalize_media_url(url: Optional[str], max_length: int = 500) -> str:
    value = trim_profile_text(url, max_length=max_length)
    if not value:
        return ""
    if value.startswith("/") or value.startswith("http://") or value.startswith("https://"):
        return value
    return ""


def get_user_profile_optional(student_id: str) -> Optional[Dict[str, Any]]:
    with db_connection() as conn:
        row = conn.execute(
            """
            SELECT
              student_id,
              random_code,
              is_admin,
              student_no,
              notify_channel_url,
              avatar_url,
              wallpaper_url,
              practice_course_keys,
              created_at,
              updated_at
            FROM user_profiles
            WHERE student_id=?
            LIMIT 1
            """,
            (student_id,),
        ).fetchone()
    return dict(row) if row else None


def ensure_user_profile(student_id: str) -> Dict[str, Any]:
    ensure_student_exists(student_id)
    existing = get_user_profile_optional(student_id)
    if existing:
        if student_id == DEFAULT_ADMIN_STUDENT_ID and not bool(existing.get("is_admin")):
            now_ts = int(time.time())
            with db_connection() as conn:
                conn.execute(
                    """
                    UPDATE user_profiles
                    SET is_admin=1, updated_at=?
                    WHERE student_id=?
                    """,
                    (now_ts, student_id),
                )
            existing["is_admin"] = 1
            existing["updated_at"] = now_ts
        return existing

    now_ts = int(time.time())
    schedule_student_no = trim_profile_text(str(SCHEDULES.get(student_id, {}).get("studentNo", "")), max_length=32)
    with db_connection() as conn:
        code = generate_unique_random_code(conn)
        is_admin = 1 if student_id == DEFAULT_ADMIN_STUDENT_ID else 0
        conn.execute(
            """
            INSERT INTO user_profiles
            (
              student_id,
              random_code,
              is_admin,
              student_no,
              notify_channel_url,
              avatar_url,
              wallpaper_url,
              practice_course_keys,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, '', '', '', '[]', ?, ?)
            """,
            (student_id, code, is_admin, schedule_student_no, now_ts, now_ts),
        )
    created = get_user_profile_optional(student_id)
    return created if created else {
        "student_id": student_id,
        "random_code": "",
        "is_admin": 0,
        "student_no": schedule_student_no,
        "notify_channel_url": "",
        "avatar_url": "",
        "wallpaper_url": "",
        "practice_course_keys": "[]",
        "created_at": now_ts,
        "updated_at": now_ts,
    }


def get_user_profile(student_id: str) -> Dict[str, Any]:
    return ensure_user_profile(student_id)


def require_target_random_code_if_needed(
    current_student_id: str,
    target_student_id: str,
    provided_random_code: Optional[str],
) -> None:
    normalized_target_student_id = (target_student_id or "").strip()
    ensure_student_exists(normalized_target_student_id)

    normalized_current_student_id = (current_student_id or "").strip()
    if normalized_current_student_id:
        ensure_student_exists(normalized_current_student_id)
    if normalized_current_student_id and normalized_current_student_id == normalized_target_student_id:
        return
    if normalized_current_student_id and is_user_admin(normalized_current_student_id):
        return

    normalized_code = normalize_random_code(str(provided_random_code or ""))
    if not normalized_code:
        raise HTTPException(status_code=400, detail=f"请输入对方 {RANDOM_CODE_LENGTH} 位验证码")
    if not is_valid_random_code(normalized_code):
        raise HTTPException(status_code=400, detail=f"验证码必须是 {RANDOM_CODE_LENGTH} 位数字")

    target_profile = ensure_user_profile(normalized_target_student_id)
    expected_code = normalize_random_code(str(target_profile.get("random_code", "")))
    if not is_valid_random_code(expected_code):
        raise HTTPException(status_code=500, detail="对方验证码异常，请联系管理员重置")
    if normalized_code != expected_code:
        raise HTTPException(status_code=403, detail="验证码错误")


def require_schedule_read_permission(current_student_id: str, target_student_id: str) -> None:
    normalized_current_student_id = (current_student_id or "").strip()
    normalized_target_student_id = (target_student_id or "").strip()
    ensure_student_exists(normalized_current_student_id)
    ensure_student_exists(normalized_target_student_id)
    if normalized_current_student_id == normalized_target_student_id:
        return
    if is_user_admin(normalized_current_student_id):
        return
    subscriptions = set(get_user_subscriptions(normalized_current_student_id))
    if normalized_target_student_id in subscriptions:
        return
    raise HTTPException(status_code=403, detail="无权查看该课表，请先通过验证码完成订阅或绑定")


def set_user_notify_channel(student_id: str, channel_url: str) -> None:
    ensure_user_profile(student_id)
    now_ts = int(time.time())
    with db_connection() as conn:
        conn.execute(
            """
            UPDATE user_profiles
            SET notify_channel_url=?, updated_at=?
            WHERE student_id=?
            """,
            (channel_url, now_ts, student_id),
        )


def set_user_media(student_id: str, avatar_url: Optional[str] = None, wallpaper_url: Optional[str] = None) -> None:
    ensure_user_profile(student_id)
    updates: Dict[str, Any] = {}
    if avatar_url is not None:
        updates["avatar_url"] = normalize_media_url(avatar_url)
    if wallpaper_url is not None:
        updates["wallpaper_url"] = normalize_media_url(wallpaper_url)
    if not updates:
        return
    updates["updated_at"] = int(time.time())
    fields = ", ".join(f"{key}=?" for key in updates.keys())
    with db_connection() as conn:
        conn.execute(
            f"UPDATE user_profiles SET {fields} WHERE student_id=?",
            tuple(updates.values()) + (student_id,),
        )


def get_user_practice_course_keys(student_id: str) -> List[str]:
    profile = get_user_profile_optional(student_id)
    if not profile:
        return []
    return parse_practice_course_keys(profile.get("practice_course_keys"))


def get_user_practice_course_key_set(student_id: str) -> set[str]:
    return set(get_user_practice_course_keys(student_id))


def set_user_practice_course_keys(student_id: str, practice_course_keys: List[str]) -> List[str]:
    ensure_user_profile(student_id)
    normalized = parse_practice_course_keys(practice_course_keys)
    with db_connection() as conn:
        conn.execute(
            """
            UPDATE user_profiles
            SET practice_course_keys=?, updated_at=?
            WHERE student_id=?
            """,
            (encode_practice_course_keys(normalized), int(time.time()), student_id),
        )
    return normalized


def ensure_practice_course_key_belongs_to_student(student_id: str, course_key: str) -> str:
    normalized = normalize_practice_course_key(course_key)
    if not normalized:
        raise HTTPException(status_code=400, detail="course_key 格式非法")
    valid_course_keys = build_schedule_course_key_set(student_id)
    if normalized not in valid_course_keys:
        raise HTTPException(status_code=400, detail="仅可标记当前账号的课程")
    return normalized


def toggle_user_practice_course(student_id: str, course_key: str, enabled: bool) -> Tuple[str, List[str]]:
    normalized_key = ensure_practice_course_key_belongs_to_student(student_id, course_key)
    current = get_user_practice_course_keys(student_id)
    values = set(current)
    if enabled:
        values.add(normalized_key)
    else:
        values.discard(normalized_key)
    next_values = [item for item in current if item in values]
    if enabled and normalized_key not in next_values:
        next_values.append(normalized_key)
    return normalized_key, set_user_practice_course_keys(student_id, next_values)


def list_registered_student_ids() -> List[str]:
    with db_connection() as conn:
        rows = conn.execute(
            """
            SELECT student_id
            FROM user_profiles
            ORDER BY updated_at DESC, created_at DESC
            """
        ).fetchall()
    registered: List[str] = []
    for row in rows:
        student_id = str(row["student_id"] or "").strip()
        if not student_id or student_id not in SCHEDULES:
            continue
        if student_id in registered:
            continue
        registered.append(student_id)
    return registered


def get_user_subscriptions(student_id: str) -> List[str]:
    with db_connection() as conn:
        rows = conn.execute(
            """
            SELECT target_student_id
            FROM user_subscriptions
            WHERE subscriber_student_id=?
            ORDER BY created_at DESC
            """,
            (student_id,),
        ).fetchall()
    return [str(row["target_student_id"]) for row in rows]


def get_user_subscribers(student_id: str) -> List[str]:
    with db_connection() as conn:
        rows = conn.execute(
            """
            SELECT subscriber_student_id
            FROM user_subscriptions
            WHERE target_student_id=?
            ORDER BY created_at DESC
            """,
            (student_id,),
        ).fetchall()
    return [str(row["subscriber_student_id"]) for row in rows]


def subscribe_student(subscriber_student_id: str, target_student_id: str) -> None:
    ensure_student_exists(subscriber_student_id)
    ensure_student_exists(target_student_id)
    if subscriber_student_id == target_student_id:
        raise HTTPException(status_code=400, detail="不能订阅自己")
    ensure_user_profile(subscriber_student_id)
    if not get_user_profile_optional(target_student_id):
        raise HTTPException(status_code=400, detail="对方尚未注册账号")
    with db_connection() as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO user_subscriptions (subscriber_student_id, target_student_id, created_at)
            VALUES (?, ?, ?)
            """,
            (subscriber_student_id, target_student_id, int(time.time())),
        )


def unsubscribe_student(subscriber_student_id: str, target_student_id: str) -> None:
    with db_connection() as conn:
        conn.execute(
            """
            DELETE FROM user_subscriptions
            WHERE subscriber_student_id=? AND target_student_id=?
            """,
            (subscriber_student_id, target_student_id),
        )


def get_subscriber_key_for_student_notify(student_id: str) -> str:
    return f"mini-notify::{student_id}"


def bind_notify_channel(student_id: str, channel_url_or_token: str, display_name: Optional[str] = None) -> None:
    ensure_student_exists(student_id)
    ensure_user_profile(student_id)
    canonical_name = SCHEDULES[student_id]["name"]
    channel_url = ensure_channel_url(build_channel_url_from_token(channel_url_or_token) or channel_url_or_token)
    upsert_subscriber(
        subscriber_key=get_subscriber_key_for_student_notify(student_id),
        name=canonical_name,
        student_id=student_id,
        channel_url=channel_url,
        display_name=normalize_display_name(display_name, canonical_name),
        disabled_days=[],
        reminder_offsets=list(DEFAULT_ENABLED_REMINDER_OFFSETS),
        daily_overview=False,
    )
    set_user_notify_channel(student_id, channel_url)


def unbind_notify_channel(student_id: str) -> None:
    subscriber_key = get_subscriber_key_for_student_notify(student_id)
    set_subscriber_active(subscriber_key, False)
    set_user_notify_channel(student_id, "")


def is_user_admin(student_id: str) -> bool:
    profile = ensure_user_profile(student_id)
    return bool(profile.get("is_admin"))


def set_user_admin(student_id: str, is_admin: bool) -> None:
    ensure_user_profile(student_id)
    if not is_admin and count_admin_users() <= 1 and is_user_admin(student_id):
        raise HTTPException(status_code=400, detail="至少保留一个管理员")
    with db_connection() as conn:
        conn.execute(
            """
            UPDATE user_profiles
            SET is_admin=?, updated_at=?
            WHERE student_id=?
            """,
            (1 if is_admin else 0, int(time.time()), student_id),
        )


def normalize_user_registry_rows_with_defaults(rows: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    parsed = parse_user_registry_rows(rows)
    existing_ids = {row["student_id"] for row in parsed}
    for default_row in build_default_user_registry_rows():
        if default_row["student_id"] in existing_ids:
            continue
        parsed.append(default_row)
    return parsed


def list_user_registry_rows() -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    for student_id, schedule in SCHEDULES.items():
        registry = USER_REGISTRY_MAP.get(student_id, {})
        source_id = normalize_student_id(registry.get("course_source_student_id", ""))
        rows.append(
            {
                "student_id": student_id,
                "name": str(schedule.get("name", student_id)),
                "student_no": trim_profile_text(str(schedule.get("studentNo", "")), max_length=32),
                "class_label": trim_profile_text(str(schedule.get("classLabel", "")), max_length=120),
                "course_source_student_id": source_id or student_id,
                "built_in": "1" if bool(registry.get("built_in")) or student_id in BUILTIN_SCHEDULES else "0",
            }
        )
    return rows


def save_user_registry_rows_and_reload(rows: List[Dict[str, Any]]) -> None:
    normalized_rows = normalize_user_registry_rows_with_defaults(rows)
    write_user_registry_rows(USER_CSV_PATH, normalized_rows)
    rebuild_runtime_schedule_registry(normalized_rows)


def upsert_user_registry_row(
    student_id: str,
    name: Optional[str] = None,
    class_label: Optional[str] = None,
    student_no: Optional[str] = None,
    course_source_student_id: Optional[str] = None,
    built_in: Optional[bool] = None,
) -> Dict[str, str]:
    target_id = ensure_valid_student_id(student_id)
    rows = list_user_registry_rows()
    row_by_id = {row["student_id"]: row for row in rows}
    current = row_by_id.get(target_id)
    if current is None:
        current = {
            "student_id": target_id,
            "name": target_id,
            "student_no": "",
            "class_label": "",
            "course_source_student_id": target_id,
            "built_in": "0",
        }
        rows.append(current)

    if name is not None:
        current["name"] = trim_profile_text(name, max_length=40) or target_id
    if class_label is not None:
        current["class_label"] = trim_profile_text(class_label, max_length=120)
    if student_no is not None:
        current["student_no"] = trim_profile_text(student_no, max_length=32)
    if course_source_student_id is not None:
        source_id = normalize_student_id(course_source_student_id)
        if source_id and source_id not in BUILTIN_SCHEDULES and source_id != target_id:
            raise HTTPException(status_code=400, detail="course_source_student_id 仅支持内置课表ID")
        current["course_source_student_id"] = source_id or target_id
    if built_in is not None:
        current["built_in"] = "1" if built_in else "0"
    if target_id in BUILTIN_SCHEDULES:
        current["built_in"] = "1"

    save_user_registry_rows_and_reload(rows)
    return current


def delete_user_related_data(student_id: str) -> None:
    with db_connection() as conn:
        conn.execute("DELETE FROM user_profiles WHERE student_id=?", (student_id,))
        conn.execute("DELETE FROM user_subscriptions WHERE subscriber_student_id=? OR target_student_id=?", (student_id, student_id))
        conn.execute("DELETE FROM auth_bindings WHERE student_id=?", (student_id,))
        conn.execute("DELETE FROM auth_sessions WHERE student_id=?", (student_id,))
        conn.execute("DELETE FROM subscribers WHERE student_id=? OR subscriber_key=?", (student_id, get_subscriber_key_for_student_notify(student_id)))
        conn.execute("DELETE FROM sent_notifications WHERE student_id=?", (student_id,))


def delete_user_registry_row(student_id: str) -> None:
    target_id = normalize_student_id(student_id)
    if not target_id:
        raise HTTPException(status_code=400, detail="student_id 不能为空")
    rows = list_user_registry_rows()
    target_row = None
    next_rows: List[Dict[str, str]] = []
    for row in rows:
        if row["student_id"] == target_id:
            target_row = row
            continue
        next_rows.append(row)
    if target_row is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if bool_from_text(target_row.get("built_in")):
        raise HTTPException(status_code=400, detail="内置用户不允许删除")
    if is_user_admin(target_id) and count_admin_users() <= 1:
        raise HTTPException(status_code=400, detail="至少保留一个管理员")
    save_user_registry_rows_and_reload(next_rows)
    delete_user_related_data(target_id)


def parse_user_registry_csv_content(csv_content: str) -> List[Dict[str, str]]:
    text = str(csv_content or "").lstrip("\ufeff").strip()
    if not text:
        raise HTTPException(status_code=400, detail="CSV 内容不能为空")
    reader = csv.DictReader(io.StringIO(text))
    headers = [str(item or "").strip() for item in (reader.fieldnames or [])]
    if not headers or "student_id" not in headers or "name" not in headers:
        raise HTTPException(status_code=400, detail="CSV 缺少必填列：student_id,name")
    return parse_user_registry_rows(list(reader))


def build_user_registry_csv_text(rows: List[Dict[str, Any]]) -> str:
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=USER_CSV_HEADERS)
    writer.writeheader()
    for row in rows:
        writer.writerow({key: str((row or {}).get(key, "") or "").strip() for key in USER_CSV_HEADERS})
    return output.getvalue()


def get_user_registry_csv_rows(student_id: Optional[str] = None) -> List[Dict[str, str]]:
    rows = read_user_registry_rows(USER_CSV_PATH)
    target_id = normalize_student_id(student_id or "")
    if not target_id:
        return rows
    filtered = [row for row in rows if normalize_student_id(row.get("student_id", "")) == target_id]
    if not filtered:
        raise HTTPException(status_code=404, detail="用户不存在")
    return filtered


def merge_course_csv_headers(headers: List[str]) -> List[str]:
    merged: List[str] = []
    for header in headers:
        value = str(header or "").strip()
        if not value or value in merged:
            continue
        merged.append(value)
    for required in COURSE_CSV_REQUIRED_HEADERS:
        if required not in merged:
            merged.append(required)
    return merged


def read_course_csv_table(path: Path) -> Tuple[List[str], List[Dict[str, str]]]:
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8", newline="") as file:
            writer = csv.DictWriter(file, fieldnames=COURSE_CSV_REQUIRED_HEADERS)
            writer.writeheader()
        return list(COURSE_CSV_REQUIRED_HEADERS), []

    with path.open("r", encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        headers = merge_course_csv_headers(list(reader.fieldnames or []))
        rows = [{key: str((row or {}).get(key, "") or "").strip() for key in headers} for row in reader]
    return headers, rows


def write_course_csv_table(path: Path, headers: List[str], rows: List[Dict[str, str]]) -> None:
    merged_headers = merge_course_csv_headers(headers)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=merged_headers)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: str((row or {}).get(key, "") or "").strip() for key in merged_headers})


def build_course_csv_text(headers: List[str], rows: List[Dict[str, str]]) -> str:
    output = io.StringIO()
    merged_headers = merge_course_csv_headers(headers)
    writer = csv.DictWriter(output, fieldnames=merged_headers)
    writer.writeheader()
    for row in rows:
        writer.writerow({key: str((row or {}).get(key, "") or "").strip() for key in merged_headers})
    return output.getvalue()


def infer_default_term_from_course_rows(rows: List[Dict[str, str]]) -> str:
    for row in rows:
        value = str((row or {}).get("term", "")).strip()
        if value:
            return value
    return "2025-2026-2"


def build_course_rows_from_schedule(student_id: str, term: str) -> List[Dict[str, str]]:
    ensure_student_exists(student_id)
    schedule = SCHEDULES[student_id]
    student_name = str(schedule.get("name", student_id)).strip()
    student_no = trim_profile_text(str(schedule.get("studentNo", "")), max_length=32)
    rows: List[Dict[str, str]] = []
    for course in schedule.get("courses", []):
        day = int(course.get("day", 0) or 0)
        start_section = int(course.get("startSection", 0) or 0)
        end_section = int(course.get("endSection", 0) or 0)
        start_time = str((SECTION_TIMES.get(start_section) or {}).get("start", ""))
        end_time = str((SECTION_TIMES.get(end_section) or {}).get("end", ""))
        day_label = DAY_LABELS[day - 1] if 1 <= day <= len(DAY_LABELS) else ""
        rows.append(
            {
                "term": term,
                "student_id": student_id,
                "student_name": student_name,
                "student_no": student_no,
                "course_id": str(course.get("id", "")),
                "course_name": str(course.get("name", "")),
                "day": str(day or ""),
                "day_label": day_label,
                "start_section": str(start_section or ""),
                "end_section": str(end_section or ""),
                "start_time": start_time,
                "end_time": end_time,
                "week_expr": str(course.get("weekExpr", "")),
                "parity": str(course.get("parity", "all") or "all"),
                "classroom": str(course.get("classroom", "") or ""),
                "teacher": str(course.get("teacher", "") or ""),
                "teaching_classes": str(course.get("teachingClasses", "") or ""),
            }
        )
    return rows


def normalize_course_row_for_student(student_id: str, row: Dict[str, Any], default_term: str) -> Dict[str, str]:
    schedule = SCHEDULES.get(student_id, {})
    student_name = trim_profile_text(str(schedule.get("name", student_id)), max_length=40)
    student_no = trim_profile_text(str(schedule.get("studentNo", "")), max_length=32)
    parity = str(row.get("parity", "") or "").strip().lower() or "all"
    if parity not in {"all", "odd", "even"}:
        parity = "all"
    normalized: Dict[str, str] = {}
    for key in COURSE_CSV_REQUIRED_HEADERS:
        normalized[key] = str(row.get(key, "") or "").strip()
    normalized["student_id"] = student_id
    normalized["student_name"] = normalized["student_name"] or student_name
    normalized["student_no"] = normalized["student_no"] or student_no
    normalized["term"] = normalized["term"] or default_term
    normalized["parity"] = parity
    return normalized


def parse_course_csv_content_for_student(student_id: str, csv_content: str, default_term: str) -> Tuple[List[str], List[Dict[str, str]]]:
    text = str(csv_content or "").lstrip("\ufeff").strip()
    if not text:
        raise HTTPException(status_code=400, detail="课程 CSV 内容不能为空")
    reader = csv.DictReader(io.StringIO(text))
    input_headers = [str(item or "").strip() for item in (reader.fieldnames or [])]
    if not input_headers:
        raise HTTPException(status_code=400, detail="课程 CSV 头部不能为空")
    missing_headers = [key for key in COURSE_CSV_REQUIRED_HEADERS if key not in input_headers]
    if missing_headers:
        raise HTTPException(status_code=400, detail=f"课程 CSV 缺少列：{','.join(missing_headers)}")

    rows: List[Dict[str, str]] = []
    for source_row in reader:
        raw = {key: str((source_row or {}).get(key, "") or "").strip() for key in input_headers}
        if not any(raw.values()):
            continue
        normalized = normalize_course_row_for_student(student_id, raw, default_term=default_term)
        if not normalized.get("course_name"):
            continue
        rows.append(normalized)
    return merge_course_csv_headers(input_headers), rows


def replace_course_rows_for_student(student_id: str, course_rows: List[Dict[str, str]], preferred_headers: Optional[List[str]] = None) -> None:
    target_id = normalize_student_id(student_id)
    ensure_student_exists(target_id)
    existing_headers, existing_rows = read_course_csv_table(COURSE_CSV_PATH)
    next_rows = [row for row in existing_rows if normalize_student_id(row.get("student_id", "")) != target_id]
    next_rows.extend(course_rows)
    headers = merge_course_csv_headers(list(preferred_headers or []) + existing_headers)
    write_course_csv_table(COURSE_CSV_PATH, headers, next_rows)
    rebuild_runtime_schedule_registry(list_user_registry_rows())


def get_course_rows_for_student(student_id: str) -> Tuple[List[str], List[Dict[str, str]], str]:
    target_id = normalize_student_id(student_id)
    ensure_student_exists(target_id)
    headers, rows = read_course_csv_table(COURSE_CSV_PATH)
    course_rows = [row for row in rows if normalize_student_id(row.get("student_id", "")) == target_id]
    if not course_rows:
        term = infer_default_term_from_course_rows(rows)
        course_rows = build_course_rows_from_schedule(target_id, term=term)
    text = build_course_csv_text(headers, course_rows)
    return headers, course_rows, text


def set_user_student_no(student_id: str, student_no: str) -> None:
    ensure_user_profile(student_id)
    normalized = trim_profile_text(student_no, max_length=32)
    with db_connection() as conn:
        conn.execute(
            """
            UPDATE user_profiles
            SET student_no=?, updated_at=?
            WHERE student_id=?
            """,
            (normalized, int(time.time()), student_id),
        )


def set_user_random_code(student_id: str, random_code: str) -> Dict[str, Any]:
    ensure_user_profile(student_id)
    normalized_code = normalize_random_code(random_code)
    if not is_valid_random_code(normalized_code):
        raise HTTPException(status_code=400, detail=f"验证码必须是 {RANDOM_CODE_LENGTH} 位数字")
    now_ts = int(time.time())
    with db_connection() as conn:
        row = conn.execute(
            """
            SELECT random_code
            FROM user_profiles
            WHERE student_id=?
            LIMIT 1
            """,
            (student_id,),
        ).fetchone()
        current_code = normalize_random_code(str(row["random_code"] if row else ""))
        if current_code == normalized_code:
            return {"changed": False, "random_code": normalized_code, "removed_subscribers": 0}
        if random_code_exists(conn, normalized_code, exclude_student_id=student_id):
            raise HTTPException(status_code=400, detail=f"验证码已被占用，请更换其他 {RANDOM_CODE_LENGTH} 位数字")
        removable_row = conn.execute(
            """
            SELECT COUNT(1) AS c
            FROM user_subscriptions
            WHERE target_student_id=?
              AND subscriber_student_id NOT IN (
                SELECT student_id
                FROM user_profiles
                WHERE is_admin=1
              )
            """,
            (student_id,),
        ).fetchone()
        removed_subscribers = int(removable_row["c"] if removable_row else 0)
        conn.execute(
            """
            UPDATE user_profiles
            SET random_code=?, updated_at=?
            WHERE student_id=?
            """,
            (normalized_code, now_ts, student_id),
        )
        if removed_subscribers > 0:
            conn.execute(
                """
                DELETE FROM user_subscriptions
                WHERE target_student_id=?
                  AND subscriber_student_id NOT IN (
                    SELECT student_id
                    FROM user_profiles
                    WHERE is_admin=1
                  )
                """,
                (student_id,),
            )
    return {"changed": True, "random_code": normalized_code, "removed_subscribers": removed_subscribers}


def build_social_user_payload(
    student_id: str,
    include_random_code: bool = False,
    reveal_sensitive: bool = False,
    include_practice_course_keys: bool = False,
) -> Dict[str, Any]:
    ensure_student_exists(student_id)
    profile = ensure_user_profile(student_id)
    schedule = SCHEDULES.get(student_id, {})
    class_label = str(schedule.get("classLabel", ""))
    student_no = trim_profile_text(str(profile.get("student_no", "")), max_length=32)
    if not student_no:
        student_no = trim_profile_text(str(schedule.get("studentNo", "")), max_length=32)
    if not reveal_sensitive:
        if class_label:
            class_label = SENSITIVE_MASK_TEXT
        if student_no:
            student_no = mask_student_no(student_no)
    practice_course_keys: List[str] = []
    if include_practice_course_keys and reveal_sensitive:
        practice_course_keys = parse_practice_course_keys(profile.get("practice_course_keys"))
    return {
        "studentId": student_id,
        "name": schedule.get("name", student_id),
        "classLabel": class_label,
        "studentNo": student_no,
        "randomCode": str(profile.get("random_code", "")) if include_random_code else "",
        "avatarUrl": normalize_media_url(str(profile.get("avatar_url", ""))),
        "wallpaperUrl": normalize_media_url(str(profile.get("wallpaper_url", ""))),
        "isAdmin": bool(profile.get("is_admin")),
        "notifyBound": bool(str(profile.get("notify_channel_url", "")).strip()),
        "practiceCourseKeys": practice_course_keys,
    }


def build_social_dashboard_payload(student_id: str) -> Dict[str, Any]:
    viewer_is_admin = is_user_admin(student_id)
    subscribed_ids = get_user_subscriptions(student_id)
    subscribed_set = set(subscribed_ids)

    def can_reveal_sensitive(target_student_id: str) -> bool:
        if viewer_is_admin:
            return True
        if target_student_id == student_id:
            return True
        return target_student_id in subscribed_set

    me = build_social_user_payload(
        student_id,
        include_random_code=True,
        reveal_sensitive=True,
        include_practice_course_keys=True,
    )
    subscriptions = [
        build_social_user_payload(target_id, include_random_code=False, reveal_sensitive=True)
        for target_id in subscribed_ids
        if get_user_profile_optional(target_id)
    ]
    subscriber_ids = get_user_subscribers(student_id)
    subscribers = [
        build_social_user_payload(
            subscriber_id,
            include_random_code=False,
            reveal_sensitive=can_reveal_sensitive(subscriber_id),
        )
        for subscriber_id in subscriber_ids
        if get_user_profile_optional(subscriber_id)
    ]
    candidates = [
        build_social_user_payload(
            other_id,
            include_random_code=False,
            reveal_sensitive=can_reveal_sensitive(other_id),
        )
        for other_id in SCHEDULES.keys()
        if other_id != student_id
    ]
    return {
        "me": me,
        "subscriptions": subscriptions,
        "subscribers": subscribers,
        "candidates": candidates,
    }


def upsert_subscriber(
    subscriber_key: str,
    name: str,
    student_id: str,
    channel_url: str,
    display_name: str,
    disabled_days: List[int],
    reminder_offsets: List[int],
    daily_overview: bool,
) -> None:
    now_ts = int(time.time())
    disabled_days_json = encode_disabled_days(disabled_days)
    reminder_offsets_json = encode_reminder_offsets(reminder_offsets)
    daily_overview_value = 1 if daily_overview else 0
    with db_connection() as conn:
        conn.execute(
            """
            INSERT INTO subscribers
            (subscriber_key, name, student_id, channel_url, display_name, disabled_days, reminder_offsets, daily_overview, active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(subscriber_key) DO UPDATE SET
              name=excluded.name,
              student_id=excluded.student_id,
              channel_url=excluded.channel_url,
              display_name=excluded.display_name,
              disabled_days=excluded.disabled_days,
              reminder_offsets=excluded.reminder_offsets,
              daily_overview=excluded.daily_overview,
              active=1,
              updated_at=excluded.updated_at
            """,
            (
                subscriber_key,
                name,
                student_id,
                channel_url,
                display_name,
                disabled_days_json,
                reminder_offsets_json,
                daily_overview_value,
                now_ts,
                now_ts,
            ),
        )


def set_subscriber_active(subscriber_key: str, active: bool) -> bool:
    with db_connection() as conn:
        cur = conn.execute(
            "UPDATE subscribers SET active=?, updated_at=? WHERE subscriber_key=?",
            (1 if active else 0, int(time.time()), subscriber_key),
        )
    return cur.rowcount > 0


def list_subscribers() -> List[Dict[str, Any]]:
    sql = """
        SELECT subscriber_key, name, student_id, channel_url, display_name, disabled_days, reminder_offsets, daily_overview, active, updated_at
        FROM subscribers
        ORDER BY id DESC
    """
    with db_connection() as conn:
        rows = conn.execute(sql).fetchall()
    return [serialize_subscriber_row(row) for row in rows]


def list_active_subscribers() -> List[Dict[str, Any]]:
    with db_connection() as conn:
        rows = conn.execute(
            """
            SELECT subscriber_key, name, student_id, channel_url, display_name, disabled_days, reminder_offsets, daily_overview
            FROM subscribers
            WHERE active=1
            """
        ).fetchall()
    return [serialize_subscriber_row(row) for row in rows]


def get_subscriber_by_key(subscriber_key: str) -> Optional[Dict[str, Any]]:
    with db_connection() as conn:
        row = conn.execute(
            """
            SELECT subscriber_key, name, student_id, channel_url, display_name, disabled_days, reminder_offsets, daily_overview, active
            FROM subscribers
            WHERE subscriber_key=?
            LIMIT 1
            """,
            (subscriber_key,),
        ).fetchone()
    if row is None:
        return None
    return serialize_subscriber_row(row)


def list_wecom_bindings() -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for subscriber in list_subscribers():
        channel_url = str(subscriber.get("channel_url", ""))
        if not is_wecom_channel_url(channel_url):
            continue
        row = dict(subscriber)
        row["wecom_userid"] = parse_wecom_userid(channel_url)
        items.append(row)
    return items


def build_wecom_binding_map() -> Dict[str, Dict[str, Any]]:
    mapping: Dict[str, Dict[str, Any]] = {}
    for item in list_wecom_bindings():
        student_id = str(item.get("student_id", "")).strip()
        if not student_id:
            continue
        bucket = mapping.setdefault(
            student_id,
            {
                "user_ids": [],
                "subscriber_keys": [],
                "active_subscriber_key": "",
            },
        )
        user_id = str(item.get("wecom_userid", "")).strip()
        if user_id and user_id not in bucket["user_ids"]:
            bucket["user_ids"].append(user_id)
        subscriber_key = str(item.get("subscriber_key", "")).strip()
        if subscriber_key and subscriber_key not in bucket["subscriber_keys"]:
            bucket["subscriber_keys"].append(subscriber_key)
        if bool(item.get("active")) and subscriber_key and not bucket["active_subscriber_key"]:
            bucket["active_subscriber_key"] = subscriber_key
    return mapping


def build_admin_user_payload(student_id: str, binding_map: Optional[Dict[str, Dict[str, Any]]] = None) -> Dict[str, Any]:
    ensure_student_exists(student_id)
    payload = build_social_user_payload(student_id, include_random_code=True, reveal_sensitive=True)
    registry = USER_REGISTRY_MAP.get(student_id, {})
    bindings = (binding_map or {}).get(student_id, {})
    subscriber_keys = list(bindings.get("subscriber_keys", []))
    user_ids = list(bindings.get("user_ids", []))
    return {
        **payload,
        "builtIn": bool(registry.get("built_in")) or student_id in BUILTIN_SCHEDULES,
        "courseSourceStudentId": normalize_student_id(registry.get("course_source_student_id", "")) or student_id,
        "wecomUserIds": user_ids,
        "wecomBindingCount": len(user_ids),
        "wecomSubscriberKey": str(bindings.get("active_subscriber_key") or (subscriber_keys[0] if subscriber_keys else "")).strip(),
    }


def list_admin_user_payloads() -> List[Dict[str, Any]]:
    binding_map = build_wecom_binding_map()
    return [build_admin_user_payload(student_id, binding_map=binding_map) for student_id in SCHEDULES.keys()]


def notification_sent(subscriber_key: str, week_no: int, day_no: int, start_section: int, reminder_minutes: int) -> bool:
    with db_connection() as conn:
        row = conn.execute(
            """
            SELECT 1 FROM sent_notifications
            WHERE subscriber_key=? AND week_no=? AND day_no=? AND start_section=? AND reminder_minutes=?
            LIMIT 1
            """,
            (subscriber_key, week_no, day_no, start_section, reminder_minutes),
        ).fetchone()
    return row is not None


def mark_notification_sent(
    subscriber_key: str,
    student_id: str,
    week_no: int,
    day_no: int,
    start_section: int,
    reminder_minutes: int,
    lesson_start_ts: int,
) -> None:
    with db_connection() as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO sent_notifications
            (subscriber_key, student_id, week_no, day_no, start_section, reminder_minutes, lesson_start_ts, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                subscriber_key,
                student_id,
                week_no,
                day_no,
                start_section,
                reminder_minutes,
                lesson_start_ts,
                int(time.time()),
            ),
        )


def daily_overview_sent(channel_url: str, date_key: str) -> bool:
    with db_connection() as conn:
        row = conn.execute(
            """
            SELECT 1 FROM daily_overview_notifications
            WHERE channel_url=? AND date_key=?
            LIMIT 1
            """,
            (channel_url, date_key),
        ).fetchone()
    return row is not None


def mark_daily_overview_sent(channel_url: str, date_key: str) -> None:
    with db_connection() as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO daily_overview_notifications (channel_url, date_key, created_at)
            VALUES (?, ?, ?)
            """,
            (channel_url, date_key, int(time.time())),
        )


def parse_week_expr(week_expr: str) -> List[Tuple[int, int]]:
    ranges: List[Tuple[int, int]] = []
    for match in re.finditer(r"(\d+)(?:-(\d+))?", week_expr):
        start = int(match.group(1))
        end = int(match.group(2) or match.group(1))
        ranges.append((start, end))
    return ranges


def is_course_in_week(course: Dict[str, Any], week: int) -> bool:
    in_range = False
    for start, end in parse_week_expr(str(course.get("weekExpr", ""))):
        if start <= week <= end:
            in_range = True
            break
    if not in_range:
        return False

    parity = str(course.get("parity", "all"))
    if parity == "odd":
        return week % 2 == 1
    if parity == "even":
        return week % 2 == 0
    return True


def get_week_courses(student_id: str, week: int) -> List[Dict[str, Any]]:
    schedule = SCHEDULES.get(student_id)
    if not schedule:
        return []
    courses = [course for course in schedule["courses"] if is_course_in_week(course, week)]
    courses.sort(key=lambda item: (item["day"], item["startSection"]))
    return courses


def get_week_by_datetime(now: datetime) -> int:
    base = parse_term_start_date()
    diff_days = (datetime(now.year, now.month, now.day, tzinfo=now.tzinfo) - base).days
    if diff_days < 0:
        return 1
    return min(25, diff_days // 7 + 1)


def get_day_no_by_datetime(now: datetime) -> int:
    return now.weekday() + 1


def get_day_label(day_no: int) -> str:
    if 1 <= day_no <= 7:
        return DAY_LABELS[day_no - 1]
    return "周?"


def infer_greeting(now: datetime, display_name: str) -> str:
    hour = now.hour
    if hour < 6:
        prefix = "夜深了"
    elif hour < 12:
        prefix = "早上好"
    elif hour < 18:
        prefix = "下午好"
    else:
        prefix = "晚上好"
    return f"{prefix}，{display_name}"


def parse_building_label(classroom: Optional[str]) -> str:
    value = (classroom or "").strip()
    if not value:
        return "教学楼待定"

    compact = re.sub(r"\s+", "", value)
    if "10教" in compact or "十教" in compact:
        return "10教"
    if any(token in compact for token in ["1教", "2教", "3教", "一教", "二教", "三教"]):
        return "1-3教"
    if any(token in compact for token in ["5教", "6教", "7教", "8教", "五教", "六教", "七教", "八教"]):
        return "5-8教"
    return "教学楼"


def estimate_commute_minutes(classroom: Optional[str]) -> int:
    label = parse_building_label(classroom)
    if label == "10教":
        return 10
    if label == "1-3教":
        return 10
    if label == "5-8教":
        return 5
    return 7


def infer_prepare_items(course_name: str, start_section: int) -> List[str]:
    items = ["校园卡/门禁", "手机电量", "水杯"]
    name = course_name or ""
    if re.search(r"(程序|软件|web|计算|网络|引擎|人工智能|C\+\+|Linux)", name, re.IGNORECASE):
        items.extend(["电脑", "充电器"])
    if re.search(r"(体育|运动|表演)", name):
        items.extend(["运动鞋", "毛巾"])
    if re.search(r"(见习|管理|社会学|政策)", name):
        items.extend(["笔记本", "签字笔"])
    if start_section >= 9:
        items.append("外套")
    return list(dict.fromkeys(items))


def build_weather_payload(now: datetime) -> Dict[str, Any]:
    hour = now.hour
    if hour < 12:
        advice = "早晨温差较大，建议带一件薄外套。"
    elif hour < 18:
        advice = "下午出门注意补水，按课表预留步行时间。"
    else:
        advice = "晚课结束较晚，建议结伴返程。"
    return {
        "status": "placeholder",
        "summary": "待接入实时天气",
        "temperature": "--",
        "advice": advice,
    }


def build_today_brief(student_id: str, now: datetime) -> Dict[str, Any]:
    schedule = SCHEDULES.get(student_id)
    if not schedule:
        raise HTTPException(status_code=404, detail="student_id 不存在")

    week_no = get_week_by_datetime(now)
    day_no = get_day_no_by_datetime(now)
    today_courses = [course for course in get_week_courses(student_id, week_no) if int(course.get("day", 0)) == day_no]
    today_courses.sort(key=lambda item: (int(item["startSection"]), int(item["endSection"])))

    next_course: Optional[Dict[str, Any]] = None
    for course in today_courses:
        start_dt = lesson_start_datetime(week_no, int(course["day"]), int(course["startSection"]))
        if start_dt >= now:
            next_course = course
            break

    next_course_payload: Optional[Dict[str, Any]] = None
    tips: List[str] = []

    if next_course:
        start_dt = lesson_start_datetime(week_no, int(next_course["day"]), int(next_course["startSection"]))
        minutes_to_start = max(0, int((start_dt - now).total_seconds() // 60))
        commute_minutes = estimate_commute_minutes(next_course.get("classroom"))
        prep_minutes = 8 if commute_minutes >= 10 else 5
        leave_in_minutes = minutes_to_start - commute_minutes - prep_minutes
        prepare_items = infer_prepare_items(str(next_course.get("name", "")), int(next_course["startSection"]))
        building_label = parse_building_label(next_course.get("classroom"))

        if leave_in_minutes <= 0:
            leave_hint = "建议现在开始收拾并出发"
        else:
            leave_hint = f"预计 {leave_in_minutes} 分钟后从实验室出发"

        tips.append(f"下节课 {next_course['name']}，{minutes_to_start} 分钟后开始。")
        tips.append(f"从实验室到 {building_label} 约 {commute_minutes} 分钟，{leave_hint}。")
        tips.append(f"可提前 {prep_minutes} 分钟准备：{'、'.join(prepare_items[:4])}。")

        next_course_payload = {
            "name": next_course["name"],
            "dayNo": int(next_course["day"]),
            "dayLabel": get_day_label(int(next_course["day"])),
            "startSection": int(next_course["startSection"]),
            "endSection": int(next_course["endSection"]),
            "startTime": SECTION_TIMES[int(next_course["startSection"])]["start"],
            "endTime": SECTION_TIMES[int(next_course["endSection"])]["end"],
            "classroom": next_course.get("classroom"),
            "teacher": next_course.get("teacher"),
            "buildingLabel": building_label,
            "minutesToStart": minutes_to_start,
            "commuteMinutes": commute_minutes,
            "prepMinutes": prep_minutes,
            "leaveInMinutes": leave_in_minutes,
            "prepareItems": prepare_items,
            "from": "实验室",
        }
    else:
        if today_courses:
            tips.append("今天课程已结束，建议整理笔记并复盘重点。")
        else:
            tips.append("今天没有课程安排，可用来预习或做项目。")
        tips.append("天气信息将通过后端接口接入。")

    return {
        "studentId": student_id,
        "studentName": schedule["name"],
        "weekNo": week_no,
        "dayNo": day_no,
        "dayLabel": get_day_label(day_no),
        "greeting": infer_greeting(now, schedule["name"]),
        "weather": build_weather_payload(now),
        "nextCourse": next_course_payload,
        "tips": tips,
        "generatedAt": now.isoformat(),
    }


def lesson_start_datetime(week_no: int, day_no: int, start_section: int) -> datetime:
    base = parse_term_start_date()
    section = SECTION_TIMES[start_section]
    hh, mm = [int(x) for x in section["start"].split(":")]
    day_start = base + timedelta(days=(week_no - 1) * 7 + (day_no - 1))
    return day_start.replace(hour=hh, minute=mm, second=0, microsecond=0)


def iter_due_reminders(subscriber: Dict[str, Any], now: datetime) -> List[Dict[str, Any]]:
    student_id = subscriber["student_id"]
    disabled_days = set(parse_disabled_days(subscriber.get("disabled_days")))
    reminder_offsets = parse_reminder_offsets(subscriber.get("reminder_offsets"))
    practice_course_keys = get_user_practice_course_key_set(student_id)
    now_ts = int(now.timestamp())
    current_week = get_week_by_datetime(now)
    due_items: List[Dict[str, Any]] = []

    for week_no in range(current_week, min(current_week + 2, 25) + 1):
        for course in get_week_courses(student_id, week_no):
            if int(course["day"]) in disabled_days:
                continue
            course_key = build_course_practice_key(course)
            if course_key and course_key in practice_course_keys:
                continue
            start_dt = lesson_start_datetime(week_no, course["day"], course["startSection"])
            start_ts = int(start_dt.timestamp())

            for offset in reminder_offsets:
                target_ts = start_ts - offset * 60
                if abs(now_ts - target_ts) > REMINDER_TRIGGER_WINDOW_SECONDS:
                    continue
                if notification_sent(subscriber["subscriber_key"], week_no, course["day"], course["startSection"], offset):
                    continue
                due_items.append(
                    {
                        "subscriber_key": subscriber["subscriber_key"],
                        "channel_url": subscriber["channel_url"],
                        "name": subscriber["name"],
                        "display_name": normalize_display_name(subscriber.get("display_name"), subscriber["name"]),
                        "student_id": student_id,
                        "course": course,
                        "week_no": week_no,
                        "start_ts": start_ts,
                        "offset": offset,
                    }
                )

    due_items.sort(key=lambda item: (item["start_ts"], item["offset"]))
    return due_items


def format_course_time(week_no: int, course: Dict[str, Any]) -> str:
    section = SECTION_TIMES[course["startSection"]]
    section_end = SECTION_TIMES[course["endSection"]]
    return (
        f"第{week_no}周 {DAY_LABELS[course['day'] - 1]} "
        f"第{course['startSection']}-{course['endSection']}节 {section['start']}-{section_end['end']}"
    )


class SafeFormatDict(dict):
    def __missing__(self, key: str) -> str:
        return "{" + key + "}"


def render_template(template: str, values: Dict[str, Any]) -> str:
    return template.format_map(SafeFormatDict(values)).strip()


def build_template_context(item: Dict[str, Any], now: Optional[datetime] = None) -> Dict[str, Any]:
    course = item["course"]
    classroom = str(course.get("classroom") or "").strip()
    start_section = SECTION_TIMES[course["startSection"]]
    end_section = SECTION_TIMES[course["endSection"]]
    now_text = (now or get_now()).strftime("%Y-%m-%d %H:%M:%S")
    day_label = DAY_LABELS[course["day"] - 1]
    return {
        "name": item["name"],
        "display_name": normalize_display_name(item.get("display_name"), item["name"]),
        "offset": item.get("offset", ""),
        "course_name": course["name"],
        "classroom": classroom,
        "classroom_suffix": f"({classroom})" if classroom else "",
        "week_no": item["week_no"],
        "day_no": course["day"],
        "day_label": day_label,
        "weekday": day_label,
        "start_section": course["startSection"],
        "end_section": course["endSection"],
        "start_time": start_section["start"],
        "end_time": end_section["end"],
        "lesson_time": format_course_time(item["week_no"], course),
        "part": start_section["part"],
        "now_text": now_text,
    }


def build_push_payload(item: Dict[str, Any]) -> Tuple[str, str]:
    templates = get_push_templates()
    context = build_template_context(item)
    title = render_template(templates["title_template"], context)
    content = render_template(templates["content_template"], context)
    return title, content


def build_test_push_payload(subscriber: Dict[str, Any]) -> Tuple[str, str]:
    templates = get_push_templates()
    current_week = get_week_by_datetime(get_now())
    courses = get_week_courses(subscriber["student_id"], current_week)
    sample_course = courses[0] if courses else {"name": "课程样例", "day": 1, "startSection": 1, "endSection": 2}
    context = build_template_context(
        {
            "name": subscriber["name"],
            "display_name": normalize_display_name(subscriber.get("display_name"), subscriber["name"]),
            "offset": 30,
            "course": sample_course,
            "week_no": current_week,
        }
    )
    title = render_template(templates["test_title_template"], context)
    content = render_template(templates["test_content_template"], context)
    return title, content


def get_today_courses(student_id: str, week_no: int, day_no: int, exclude_practice: bool = False) -> List[Dict[str, Any]]:
    courses = [course for course in get_week_courses(student_id, week_no) if int(course.get("day", 0)) == day_no]
    if exclude_practice:
        practice_course_keys = get_user_practice_course_key_set(student_id)
        visible_courses: List[Dict[str, Any]] = []
        for course in courses:
            course_key = build_course_practice_key(course)
            if course_key and course_key in practice_course_keys:
                continue
            visible_courses.append(course)
        courses = visible_courses
    courses.sort(key=lambda item: (int(item["startSection"]), int(item["endSection"])))
    return courses


def build_daily_overview_payload(subscribers: List[Dict[str, Any]], week_no: int, day_no: int) -> Optional[Tuple[str, str]]:
    rows: List[Tuple[str, Dict[str, Any]]] = []
    for subscriber in subscribers:
        student_id = str(subscriber["student_id"])
        name = str(subscriber["name"])
        for course in get_today_courses(student_id, week_no, day_no, exclude_practice=True):
            rows.append((name, course))
    if not rows:
        return None

    rows.sort(key=lambda item: (int(item[1]["startSection"]), int(item[1]["endSection"]), item[0]))
    display_name = normalize_display_name(subscribers[0].get("display_name"), subscribers[0]["name"])
    title = f"{display_name}提醒您，今日课表总览"
    lines = [f"第{week_no}周 {get_day_label(day_no)} 共 {len(rows)} 节安排："]
    for owner_name, course in rows:
        start_time = SECTION_TIMES[int(course["startSection"])]["start"]
        end_time = SECTION_TIMES[int(course["endSection"])]["end"]
        classroom = str(course.get("classroom") or "").strip()
        classroom_suffix = f"({classroom})" if classroom else ""
        lines.append(
            f"- {start_time}-{end_time} 第{course['startSection']}-{course['endSection']}节 "
            f"{owner_name}·{course['name']}{classroom_suffix}"
        )
    lines.append("提醒：请提前规划路线，避免迟到。")
    return title, "\n".join(lines)


def run_daily_overview_scan(now: datetime) -> int:
    now_ts = int(now.timestamp())
    week_no = get_week_by_datetime(now)
    day_no = get_day_no_by_datetime(now)
    date_key = now.strftime("%Y-%m-%d")
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for subscriber in list_active_subscribers():
        if not bool(subscriber.get("daily_overview")):
            continue
        channel_url = str(subscriber.get("channel_url", ""))
        groups.setdefault(channel_url, []).append(subscriber)

    sent = 0
    for channel_url, subscribers in groups.items():
        if daily_overview_sent(channel_url, date_key):
            continue
        all_courses: List[Dict[str, Any]] = []
        for sub in subscribers:
            all_courses.extend(get_today_courses(sub["student_id"], week_no, day_no, exclude_practice=True))
        if not all_courses:
            continue
        first_start_section = min(int(course["startSection"]) for course in all_courses)
        first_start_dt = lesson_start_datetime(week_no, day_no, first_start_section)
        target_ts = int(first_start_dt.timestamp()) - DAILY_OVERVIEW_ADVANCE_MINUTES * 60
        if abs(now_ts - target_ts) > REMINDER_TRIGGER_WINDOW_SECONDS:
            continue

        payload = build_daily_overview_payload(subscribers, week_no, day_no)
        if not payload:
            continue
        title, content = payload
        try:
            send_message(channel_url, title, content)
            mark_daily_overview_sent(channel_url, date_key)
            sent += 1
        except Exception as exc:
            print(f"[DAILY OVERVIEW ERROR] channel={channel_url} err={exc}")
    return sent


def compute_wecom_signature(token: str, timestamp: str, nonce: str, encrypted: str) -> str:
    data = [token, timestamp, nonce, encrypted]
    data.sort()
    return hashlib.sha1("".join(data).encode("utf-8")).hexdigest()


def decode_wecom_aes_key(encoding_aes_key: str) -> bytes:
    key = encoding_aes_key.strip()
    if len(key) != 43:
        raise RuntimeError("WECOM_CALLBACK_AES_KEY 长度必须是 43 位")
    try:
        return base64.b64decode(f"{key}=")
    except Exception as exc:  # pragma: no cover
        raise RuntimeError("WECOM_CALLBACK_AES_KEY 非法，无法 base64 解码") from exc


def pkcs7_unpad(data: bytes) -> bytes:
    if not data:
        raise RuntimeError("企业微信回调解密失败：空数据")
    pad_len = data[-1]
    if pad_len < 1 or pad_len > 32:
        raise RuntimeError("企业微信回调解密失败：padding 非法")
    return data[:-pad_len]


def decrypt_wecom_echostr(echostr: str, encoding_aes_key: str) -> Tuple[str, str]:
    if AES is None:  # pragma: no cover
        raise RuntimeError("缺少 pycryptodome 依赖，请安装 requirements.txt")
    aes_key = decode_wecom_aes_key(encoding_aes_key)
    iv = aes_key[:16]
    try:
        encrypted = base64.b64decode(echostr)
    except Exception as exc:
        raise RuntimeError("echostr 非法，base64 解码失败") from exc

    cipher = AES.new(aes_key, AES.MODE_CBC, iv)
    decrypted = pkcs7_unpad(cipher.decrypt(encrypted))
    if len(decrypted) < 20:
        raise RuntimeError("企业微信回调解密失败：数据长度异常")

    msg_len = struct.unpack(">I", decrypted[16:20])[0]
    msg_start = 20
    msg_end = msg_start + msg_len
    if msg_end > len(decrypted):
        raise RuntimeError("企业微信回调解密失败：消息长度越界")

    msg = decrypted[msg_start:msg_end].decode("utf-8")
    receive_id = decrypted[msg_end:].decode("utf-8")
    return msg, receive_id


def parse_xml_message(xml_text: str) -> Dict[str, str]:
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        raise RuntimeError("企业微信消息 XML 解析失败") from exc
    data: Dict[str, str] = {}
    for child in root:
        data[child.tag] = (child.text or "").strip()
    return data


def get_wecom_user_subscribers(user_id: str, active_only: bool = True) -> List[Dict[str, Any]]:
    channel = build_wecom_channel(user_id)
    sql = """
        SELECT subscriber_key, name, student_id, channel_url, display_name, disabled_days, reminder_offsets, daily_overview, active, updated_at
        FROM subscribers
        WHERE channel_url=?
    """
    params: List[Any] = [channel]
    if active_only:
        sql += " AND active=1"
    sql += " ORDER BY student_id"
    with db_connection() as conn:
        rows = conn.execute(sql, tuple(params)).fetchall()
    return [serialize_subscriber_row(row) for row in rows]


def find_subscriber_by_wecom_userid(user_id: str) -> Optional[Dict[str, Any]]:
    subscribers = get_wecom_user_subscribers(user_id, active_only=True)
    if subscribers:
        return subscribers[0]
    subscribers = get_wecom_user_subscribers(user_id, active_only=False)
    if subscribers:
        return subscribers[0]
    return None


def get_wecom_user_preferences(user_id: str, fallback_name: str) -> Dict[str, Any]:
    subscribers = get_wecom_user_subscribers(user_id, active_only=False)
    if not subscribers:
        return {
            "display_name": fallback_name,
            "disabled_days": [],
            "reminder_offsets": list(DEFAULT_ENABLED_REMINDER_OFFSETS),
            "daily_overview": False,
        }
    first = subscribers[0]
    return {
        "display_name": normalize_display_name(first.get("display_name"), fallback_name),
        "disabled_days": parse_disabled_days(first.get("disabled_days")),
        "reminder_offsets": parse_reminder_offsets(first.get("reminder_offsets")),
        "daily_overview": bool(first.get("daily_overview", False)),
    }


def update_wecom_user_preferences(user_id: str, reminder_offsets: Optional[List[int]] = None, daily_overview: Optional[bool] = None) -> None:
    channel = build_wecom_channel(user_id)
    updates: List[str] = []
    values: List[Any] = []
    if reminder_offsets is not None:
        updates.append("reminder_offsets=?")
        values.append(encode_reminder_offsets(reminder_offsets))
    if daily_overview is not None:
        updates.append("daily_overview=?")
        values.append(1 if daily_overview else 0)
    if not updates:
        return
    updates.append("updated_at=?")
    values.append(int(time.time()))
    values.append(channel)
    with db_connection() as conn:
        conn.execute(f"UPDATE subscribers SET {', '.join(updates)} WHERE channel_url=?", tuple(values))


def clear_wecom_subscriptions(user_id: str) -> None:
    channel = build_wecom_channel(user_id)
    with db_connection() as conn:
        conn.execute("DELETE FROM subscribers WHERE channel_url=?", (channel,))


def resolve_student_by_name_or_raise(name: str) -> Tuple[str, str]:
    student_id = resolve_student_id_by_name(name)
    if not student_id:
        raise RuntimeError("未找到该姓名，请发送：蔡子菱 / 马晚晴 / 唐子贤 / 伍鑫宇")
    canonical_name = SCHEDULES[student_id]["name"]
    return student_id, canonical_name


def upsert_wecom_subscription(
    user_id: str,
    student_id: str,
    canonical_name: str,
    display_name: str,
    disabled_days: List[int],
    reminder_offsets: List[int],
    daily_overview: bool,
) -> Dict[str, Any]:
    subscriber_key = f"wecom-{user_id.strip()}-{student_id}"
    upsert_subscriber(
        subscriber_key=subscriber_key,
        name=canonical_name,
        student_id=student_id,
        channel_url=build_wecom_channel(user_id),
        display_name=display_name,
        disabled_days=disabled_days,
        reminder_offsets=reminder_offsets,
        daily_overview=daily_overview,
    )
    row = get_subscriber_by_key(subscriber_key)
    if row is None:
        raise RuntimeError("订阅保存失败，请稍后重试")
    return row


def bind_wecom_user_to_student(user_id: str, name: str) -> Dict[str, Any]:
    student_id, canonical_name = resolve_student_by_name_or_raise(name)
    prefs = get_wecom_user_preferences(user_id, canonical_name)
    clear_wecom_subscriptions(user_id)
    return upsert_wecom_subscription(
        user_id=user_id,
        student_id=student_id,
        canonical_name=canonical_name,
        display_name=prefs["display_name"],
        disabled_days=prefs["disabled_days"],
        reminder_offsets=prefs["reminder_offsets"],
        daily_overview=prefs["daily_overview"],
    )


def sub_wecom_user_to_student(user_id: str, name: str) -> Dict[str, Any]:
    student_id, canonical_name = resolve_student_by_name_or_raise(name)
    prefs = get_wecom_user_preferences(user_id, canonical_name)
    return upsert_wecom_subscription(
        user_id=user_id,
        student_id=student_id,
        canonical_name=canonical_name,
        display_name=prefs["display_name"],
        disabled_days=prefs["disabled_days"],
        reminder_offsets=prefs["reminder_offsets"],
        daily_overview=prefs["daily_overview"],
    )


def unsub_wecom_user_from_student(user_id: str, name: str) -> int:
    student_id, _ = resolve_student_by_name_or_raise(name)
    subscriber_key = f"wecom-{user_id.strip()}-{student_id}"
    with db_connection() as conn:
        conn.execute("DELETE FROM subscribers WHERE subscriber_key=?", (subscriber_key,))
    return len(get_wecom_user_subscribers(user_id, active_only=False))


def build_bound_text(subscriber: Dict[str, Any]) -> str:
    return f"{subscriber['name']}（student_id: {subscriber['student_id']}）"


def build_wecom_subscriptions_text(user_id: str) -> str:
    subscribers = get_wecom_user_subscribers(user_id, active_only=False)
    if not subscribers:
        return "当前未订阅任何课表。"
    lines = [f"{idx + 1}. {sub['name']}({sub['student_id']})" for idx, sub in enumerate(subscribers)]
    return "当前订阅：\n" + "\n".join(lines)


def build_offsets_text(offsets: List[int]) -> str:
    tokens = []
    for value in SUPPORTED_REMINDER_OFFSETS:
        state = "开" if value in offsets else "关"
        tokens.append(f"{value}分钟:{state}")
    return "提醒档位：" + " / ".join(tokens)


def set_wecom_user_offset(user_id: str, offset: int, enabled: bool) -> List[int]:
    subscribers = get_wecom_user_subscribers(user_id, active_only=False)
    if not subscribers:
        raise RuntimeError("你还没绑定课表，请先发送：bind 姓名")
    current = parse_reminder_offsets(subscribers[0].get("reminder_offsets"))
    values = set(current)
    if enabled:
        values.add(offset)
    else:
        values.discard(offset)
    normalized = sorted([value for value in values if value in SUPPORTED_REMINDER_OFFSETS], reverse=True)
    if not normalized:
        raise RuntimeError("至少保留一个提醒档位")
    update_wecom_user_preferences(user_id, reminder_offsets=normalized)
    return normalized


def set_wecom_user_daily_overview(user_id: str, enabled: bool) -> None:
    subscribers = get_wecom_user_subscribers(user_id, active_only=False)
    if not subscribers:
        raise RuntimeError("你还没绑定课表，请先发送：bind 姓名")
    update_wecom_user_preferences(user_id, daily_overview=enabled)


def handle_wecom_text_command(user_id: str, content: str) -> str:
    cmd = (content or "").strip()
    if not cmd:
        return "未识别到内容，请发送 help 查看命令。"

    lowered = cmd.lower()
    if lowered == "help":
        current = build_wecom_subscriptions_text(user_id)
        primary = find_subscriber_by_wecom_userid(user_id)
        offsets_text = build_offsets_text(parse_reminder_offsets(primary.get("reminder_offsets") if primary else None))
        digest_text = "每日总览：开" if (primary and bool(primary.get("daily_overview"))) else "每日总览：关"
        return f"{WECOM_HELP_TEXT}\n\n{current}\n{offsets_text}\n{digest_text}"

    bind_match = re.match(r"^bind\s+(.+)$", cmd, flags=re.IGNORECASE)
    if bind_match:
        target_name = bind_match.group(1).strip()
        bound = bind_wecom_user_to_student(user_id, target_name)
        return f"已绑定：{build_bound_text(bound)}\n发送 sub 姓名 可追加订阅。"

    sub_match = re.match(r"^sub\s+(.+)$", cmd, flags=re.IGNORECASE)
    if sub_match:
        target_name = sub_match.group(1).strip()
        bound = sub_wecom_user_to_student(user_id, target_name)
        return f"已追加订阅：{build_bound_text(bound)}\n{build_wecom_subscriptions_text(user_id)}"

    unsub_match = re.match(r"^unsub\s+(.+)$", cmd, flags=re.IGNORECASE)
    if unsub_match:
        target_name = unsub_match.group(1).strip()
        left = unsub_wecom_user_from_student(user_id, target_name)
        return f"已取消订阅：{target_name}\n剩余订阅 {left} 个。"

    if lowered == "subs":
        return build_wecom_subscriptions_text(user_id)

    if lowered == "offsets":
        primary = find_subscriber_by_wecom_userid(user_id)
        if not primary:
            return "你还没绑定课表，请先发送：bind 姓名"
        return build_offsets_text(parse_reminder_offsets(primary.get("reminder_offsets")))

    offset_match = re.match(r"^offset\s+(60|30|15|5)\s+(on|off)$", lowered)
    if offset_match:
        offset = int(offset_match.group(1))
        enabled = offset_match.group(2) == "on"
        values = set_wecom_user_offset(user_id, offset, enabled)
        return build_offsets_text(values)

    digest_match = re.match(r"^digest\s+(on|off)$", lowered)
    if digest_match:
        enabled = digest_match.group(1) == "on"
        set_wecom_user_daily_overview(user_id, enabled)
        return "每日总览：开" if enabled else "每日总览：关"

    test_match = re.match(r"^test(?:\s+(.+))?$", cmd, flags=re.IGNORECASE)
    if test_match:
        target_name = (test_match.group(1) or "").strip()
        subscribers = get_wecom_user_subscribers(user_id, active_only=False)
        if not subscribers:
            return "你还没绑定课表，请先发送：bind 姓名"
        target_sub = subscribers[0]
        if target_name:
            target_student_id, _ = resolve_student_by_name_or_raise(target_name)
            for sub in subscribers:
                if sub["student_id"] == target_student_id:
                    target_sub = sub
                    break
            else:
                return f"你尚未订阅 {target_name}，请先发送：sub {target_name}"
        title, msg_content = build_test_push_payload(target_sub)
        send_wecom_text(title=title, content=msg_content, touser=user_id)
        return f"测试推送已发送。\n当前目标：{build_bound_text(target_sub)}"

    return "未识别命令，请发送 help 查看菜单。"


def wecom_request_json(url: str, method: str = "GET", payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    data: Optional[bytes] = None
    headers: Dict[str, str] = {}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url=url, data=data, method=method.upper(), headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            body = response.read().decode("utf-8", "ignore")
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"wecom 请求失败: HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"wecom 网络错误: {exc.reason}") from exc

    if not body:
        return {}
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError as exc:
        raise RuntimeError("wecom 返回了非 JSON 响应") from exc
    if not isinstance(parsed, dict):
        raise RuntimeError("wecom 返回格式异常")
    return parsed


def fetch_wecom_access_token(force_refresh: bool = False) -> str:
    now_ts = int(time.time())
    cached_token = getattr(app.state, "wecom_token", None)
    cached_expire_at = int(getattr(app.state, "wecom_token_expire_at", 0))
    if cached_token and not force_refresh and cached_expire_at - now_ts > 120:
        return str(cached_token)

    config = get_wecom_config()
    api_base = config["api_base"] or WECOM_API_BASE
    corp_id = config["corp_id"]
    corp_secret = config["corp_secret"]
    if not corp_id or not corp_secret:
        raise RuntimeError("企业微信未配置 corp_id/corp_secret")

    query = urllib.parse.urlencode({"corpid": corp_id, "corpsecret": corp_secret})
    url = f"{api_base}/cgi-bin/gettoken?{query}"
    parsed = wecom_request_json(url=url, method="GET")
    errcode = int(parsed.get("errcode", -1))
    if errcode != 0:
        errmsg = parsed.get("errmsg", "unknown")
        raise RuntimeError(f"企业微信鉴权失败: errcode={errcode}, errmsg={errmsg}")

    token = str(parsed.get("access_token", "")).strip()
    expires_in = int(parsed.get("expires_in", 7200))
    if not token:
        raise RuntimeError("企业微信鉴权成功但 access_token 为空")

    app.state.wecom_token = token
    app.state.wecom_token_expire_at = now_ts + max(300, expires_in - 60)
    return token


def send_wecom_text(title: str, content: str, touser: Optional[str] = None) -> None:
    config = get_wecom_config()
    api_base = config["api_base"] or WECOM_API_BASE
    agent_id = config["agent_id"]
    if not agent_id:
        raise RuntimeError("企业微信未配置 agent_id")
    try:
        agent_id_value = int(agent_id)
    except ValueError as exc:
        raise RuntimeError("企业微信 agent_id 必须是数字") from exc

    target_user = (touser or config.get("default_touser") or WECOM_DEFAULT_TOUSER).strip()
    if not target_user:
        raise RuntimeError("企业微信接收人为空")

    message_content = f"{title}\n{content}".strip()
    payload = {
        "touser": target_user,
        "msgtype": "text",
        "agentid": agent_id_value,
        "text": {"content": message_content},
        "safe": 0,
        "enable_duplicate_check": 1,
        "duplicate_check_interval": 1800,
    }

    refresh_codes = {40014, 42001, 42007, 42009}
    last_error: Optional[RuntimeError] = None
    for force_refresh in (False, True):
        try:
            token = fetch_wecom_access_token(force_refresh=force_refresh)
            url = f"{api_base}/cgi-bin/message/send?access_token={urllib.parse.quote(token)}"
            parsed = wecom_request_json(url=url, method="POST", payload=payload)
            errcode = int(parsed.get("errcode", -1))
            if errcode == 0:
                return
            errmsg = parsed.get("errmsg", "unknown")
            if errcode in refresh_codes and not force_refresh:
                continue
            raise RuntimeError(f"企业微信发送失败: errcode={errcode}, errmsg={errmsg}")
        except RuntimeError as exc:
            last_error = exc
            if not force_refresh:
                continue
            break
    if last_error is not None:
        raise last_error
    raise RuntimeError("企业微信发送失败")


def test_wecom_connection() -> Dict[str, Any]:
    token = fetch_wecom_access_token(force_refresh=True)
    return {
        "ok": True,
        "access_token_preview": f"{token[:8]}...",
        "expire_at": int(getattr(app.state, "wecom_token_expire_at", 0)),
    }


def send_message(channel_url: str, title: str, content: str) -> None:
    if PUSH_MODE == "mock":
        print(f"[MOCK PUSH] channel={channel_url} title={title} content={content}")
        return

    if PUSH_MODE != "wecom":
        raise RuntimeError(f"不支持的 PUSH_MODE: {PUSH_MODE}（仅支持 wecom/mock）")

    channel = (channel_url or "").strip()
    if channel.startswith("http://") or channel.startswith("https://"):
        raise RuntimeError("已移除 xizhi 通道，请改用企业微信用户 ID")
    touser = parse_wecom_userid(channel)
    if not touser:
        raise RuntimeError("企业微信接收人不能为空")
    send_wecom_text(title=title, content=content, touser=touser)


def run_reminder_scan() -> int:
    now = get_now()
    sent = 0
    for subscriber in list_active_subscribers():
        due_items = iter_due_reminders(subscriber, now)
        for item in due_items:
            try:
                title, content = build_push_payload(item)
                send_message(item["channel_url"], title, content)
                mark_notification_sent(
                    subscriber_key=item["subscriber_key"],
                    student_id=item["student_id"],
                    week_no=item["week_no"],
                    day_no=item["course"]["day"],
                    start_section=item["course"]["startSection"],
                    reminder_minutes=item["offset"],
                    lesson_start_ts=item["start_ts"],
                )
                sent += 1
            except Exception as exc:
                print(f"[PUSH ERROR] subscriber={item['subscriber_key']} err={exc}")
    sent += run_daily_overview_scan(now)
    return sent


def validate_push_mode() -> None:
    if PUSH_MODE not in {"wecom", "mock"}:
        raise RuntimeError(f"PUSH_MODE={PUSH_MODE} 不支持，当前仅支持 wecom 或 mock")


async def reminder_worker() -> None:
    while True:
        try:
            count = run_reminder_scan()
            if count > 0:
                print(f"[REMINDER] sent={count}")
        except Exception as exc:
            print(f"[REMINDER WORKER ERROR] {exc}")
        await asyncio.sleep(SCAN_INTERVAL_SECONDS)


@app.on_event("startup")
async def startup_event() -> None:
    validate_push_mode()
    validate_admin_web_config()
    reload_user_registry_from_csv()
    init_db()
    ensure_default_theme_image_seed()
    for student_id in SCHEDULES.keys():
        ensure_user_profile(student_id)
    if ENABLE_REMINDER_WORKER:
        app.state.worker_task = asyncio.create_task(reminder_worker())


@app.on_event("shutdown")
async def shutdown_event() -> None:
    task = app.state.worker_task
    if task:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


def build_login_html() -> str:
    return """<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TouchX 管理后台登录</title>
  <style>
    body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; background:#f3f6fb; font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color:#1f2937; }
    .login-card { width:min(92vw, 420px); background:#fff; border:1px solid #e5e7eb; border-radius:14px; padding:22px; box-shadow:0 10px 28px rgba(15, 23, 42, 0.06); }
    .title { margin:0; font-size:28px; font-weight:700; }
    .sub { margin:8px 0 0; font-size:14px; color:#6b7280; line-height:1.5; }
    .label { display:block; margin-top:16px; margin-bottom:8px; font-size:13px; color:#374151; font-weight:600; }
    .input { width:100%; box-sizing:border-box; border:1px solid #d1d5db; border-radius:10px; padding:10px 12px; font-size:15px; }
    .actions { margin-top:14px; display:flex; gap:8px; }
    .btn { flex:1; border:0; border-radius:10px; padding:10px 12px; font-size:15px; cursor:pointer; background:#2563eb; color:#fff; }
    .btn:disabled { background:#9ca3af; cursor:not-allowed; }
    .msg { margin-top:10px; min-height:20px; font-size:13px; }
    .msg.err { color:#b91c1c; }
    .msg.ok { color:#047857; }
  </style>
</head>
<body>
  <div class="login-card">
    <h1 class="title">TouchX 管理后台</h1>
    <p class="sub">请输入管理员登录 Token。登录成功后将跳转到云端网页管理页面。</p>
    <label class="label" for="tokenInput">管理员 Token</label>
    <input id="tokenInput" class="input" type="password" autocomplete="off" placeholder="从环境变量 ADMIN_WEB_AUTH_TOKEN 对应值输入" />
    <div class="actions">
      <button id="loginBtn" class="btn" onclick="submitLogin()">登录</button>
    </div>
    <div id="loginMsg" class="msg"></div>
  </div>

  <script>
    const ADMIN_SESSION_STORAGE_KEY = "touchx_admin_session";

    async function submitLogin() {
      const btn = document.getElementById("loginBtn");
      const tokenInput = document.getElementById("tokenInput");
      const msgEl = document.getElementById("loginMsg");
      const token = String(tokenInput.value || "").trim();
      if (!token) {
        msgEl.textContent = "请输入管理员 Token";
        msgEl.className = "msg err";
        return;
      }
      btn.disabled = true;
      msgEl.textContent = "";
      try {
        const res = await fetch("/api/admin/login", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.detail || ("登录失败: " + res.status));
        }
        if (!data.sessionToken) {
          throw new Error("登录失败：缺少会话信息");
        }
        sessionStorage.setItem(ADMIN_SESSION_STORAGE_KEY, String(data.sessionToken));
        msgEl.textContent = "登录成功，正在跳转...";
        msgEl.className = "msg ok";
        window.location.href = "/admin/wecom";
      } catch (err) {
        msgEl.textContent = String(err && err.message ? err.message : err);
        msgEl.className = "msg err";
      } finally {
        btn.disabled = false;
      }
    }

    document.getElementById("tokenInput").addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submitLogin();
      }
    });
  </script>
</body>
</html>"""


def build_admin_html() -> str:
    return """<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TouchX 管理后台</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#f6f8fb; margin:0; color:#1f2937; }
    .wrap { max-width: 1180px; margin: 24px auto; padding: 0 16px; }
    .card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:16px; margin-bottom:14px; }
    .title { font-size:22px; font-weight:700; margin:0 0 8px; }
    .muted { color:#6b7280; font-size:13px; margin:0; }
    .header-card { padding:18px 20px 14px; background:linear-gradient(180deg, #ffffff 0%, #f9fbff 100%); }
    .header-top { display:flex; gap:16px; align-items:flex-start; justify-content:space-between; }
    .header-copy { min-width:280px; flex:1 1 auto; }
    .header-sub { font-size:14px; color:#6b7280; margin:0; line-height:1.5; }
    .header-right { display:flex; flex-direction:column; align-items:flex-end; gap:10px; flex:0 0 auto; }
    .status-bar { display:flex; gap:6px; align-items:center; flex-wrap:wrap; justify-content:flex-end; }
    .mode-badge { display:inline-flex; align-items:center; border-radius:999px; padding:4px 10px; font-size:12px; font-weight:600; border:1px solid #d1d5db; color:#374151; background:#f9fafb; }
    .mode-badge.mode-wecom { border-color:#bfdbfe; color:#1d4ed8; background:#eff6ff; }
    .mode-badge.mode-mock { border-color:#fde68a; color:#92400e; background:#fffbeb; }
    .mode-badge.state-on { border-color:#a7f3d0; color:#047857; background:#ecfdf5; }
    .mode-badge.state-off { border-color:#fecaca; color:#b91c1c; background:#fef2f2; }
    .header-actions { margin-top:0; }
    .header-status { margin-top:10px; min-height:20px; }
    .btn { border:0; border-radius:8px; background:#2563eb; color:#fff; padding:8px 12px; cursor:pointer; font-size:14px; }
    .btn.gray { background:#4b5563; }
    .btn.tab-btn { background:#e5e7eb; color:#1f2937; }
    .btn.tab-btn.active { background:#2563eb; color:#fff; }
    .btn:disabled { background:#9ca3af; cursor:not-allowed; }
    textarea, input[type=text] { width:100%; box-sizing:border-box; border:1px solid #d1d5db; border-radius:8px; padding:8px; font-size:14px; }
    textarea { min-height:88px; resize:vertical; line-height:1.5; }
    .form-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:12px; }
    .label { font-size:13px; color:#374151; font-weight:600; margin-bottom:6px; display:block; }
    table { width:100%; border-collapse: collapse; font-size:14px; }
    th, td { border-bottom:1px solid #e5e7eb; padding:10px 8px; text-align:left; vertical-align:middle; }
    th { color:#374151; background:#f9fafb; }
    .ok { color:#047857; font-size:13px; }
    .err { color:#b91c1c; font-size:13px; white-space: pre-wrap; }
    .top-actions { display:flex; gap:8px; margin-top:12px; }
    .tab-actions { display:flex; gap:8px; flex-wrap:wrap; margin-top:14px; padding-top:12px; border-top:1px solid #e5e7eb; }
    .tab-actions .btn.tab-btn { border-radius:999px; padding:7px 12px; font-size:13px; text-decoration:none; display:inline-flex; align-items:center; }
    .tab-panel { display:none; }
    .tab-panel.active { display:block; }
    .code-secret { display:inline-flex; align-items:center; min-width:46px; border-radius:6px; background:#f3f4f6; color:#111827; padding:3px 8px; }
    .code-secret .code-real { display:none; }
    .code-secret:hover .code-mask { display:none; }
    .code-secret:hover .code-real { display:inline; }
    .dialog-mask { position:fixed; inset:0; background:rgba(17, 24, 39, 0.55); display:none; align-items:center; justify-content:center; z-index:999; padding:18px; }
    .dialog-mask.open { display:flex; }
    .dialog-card { width:min(96vw, 760px); max-height:90vh; overflow:auto; background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:16px; }
    .dialog-title { margin:0; font-size:20px; font-weight:700; }
    .dialog-sub { margin:6px 0 0; color:#6b7280; font-size:13px; }
    .theme-image-list { margin-top:12px; display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px; }
    .theme-image-item { border:1px solid #e5e7eb; border-radius:10px; padding:10px; background:#fafcff; }
    .theme-image-title { font-size:14px; font-weight:600; color:#111827; margin-bottom:8px; }
    .theme-image-preview { width:100%; height:120px; border:1px solid #d1d5db; border-radius:8px; object-fit:cover; background:#f3f4f6; }
    .theme-image-empty { display:flex; align-items:center; justify-content:center; color:#6b7280; font-size:12px; }
    .theme-image-meta { margin-top:8px; font-size:12px; color:#6b7280; word-break:break-all; min-height:18px; }
    .theme-image-actions { margin-top:8px; display:flex; gap:8px; flex-wrap:wrap; }
    .theme-image-actions input[type=file] { flex:1 1 220px; font-size:12px; }
    @media (max-width: 960px) {
      .form-grid { grid-template-columns:1fr; }
      table { font-size:13px; }
      .header-top { flex-direction:column; }
      .header-right { width:100%; align-items:flex-start; }
      .status-bar { justify-content:flex-start; }
      .header-actions { width:100%; }
      .theme-image-list { grid-template-columns:1fr; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card header-card">
      <div class="header-top">
        <div class="header-copy">
          <h1 class="title">TouchX 管理后台</h1>
          <p class="header-sub">管理企业微信鉴权、小程序登录、用户资料与管理员权限、主题图片和推送文案模板。</p>
        </div>
        <div class="header-right">
          <div class="status-bar">
            <span id="pushModeBadge" class="mode-badge">PUSH_MODE: -</span>
            <span id="workerBadge" class="mode-badge">WORKER: -</span>
          </div>
          <div class="top-actions header-actions">
            <button class="btn gray" onclick="refreshAll()">刷新</button>
            <button class="btn gray" onclick="logoutAdmin()">退出登录</button>
          </div>
        </div>
      </div>
      <div class="tab-actions">
        <a id="tabBtn-wecom" class="btn tab-btn active" href="/admin/wecom" onclick="onTabLinkClick(event, 'wecom')">企业微信鉴权</a>
        <a id="tabBtn-users" class="btn tab-btn" href="/admin/users" onclick="onTabLinkClick(event, 'users')">用户管理</a>
        <a id="tabBtn-themes" class="btn tab-btn" href="/admin/themes" onclick="onTabLinkClick(event, 'themes')">主题图片</a>
        <a id="tabBtn-templates" class="btn tab-btn" href="/admin/templates" onclick="onTabLinkClick(event, 'templates')">文案模板</a>
      </div>
      <div id="globalMsg" class="muted header-status"></div>
    </div>

    <div id="tabPanel-wecom" class="card tab-panel active">
      <h2 style="margin:0 0 6px;">企业微信自建应用鉴权</h2>
      <p class="muted">配置会写入数据库，刷新或重启后可自动读取。敏感字段仅展示脱敏摘要。</p>
      <p class="muted">回调 URL（用于企业微信“接收消息”验证）：<code id="callbackUrlHint">/api/wecom/callback</code></p>
      <div class="form-grid">
        <div>
          <label class="label" for="wecomApiBase">API Base</label>
          <input id="wecomApiBase" type="text" placeholder="https://qyapi.weixin.qq.com" />
        </div>
        <div>
          <label class="label" for="wecomCorpId">Corp ID</label>
          <input id="wecomCorpId" type="text" placeholder="wwxxxxxxxxxxxx" />
        </div>
        <div>
          <label class="label" for="wecomAgentId">Agent ID</label>
          <input id="wecomAgentId" type="text" placeholder="1000002" />
        </div>
        <div style="grid-column:1 / -1;">
          <label class="label" for="wecomCorpSecret">Corp Secret</label>
          <input id="wecomCorpSecret" type="text" placeholder="企业微信应用 Secret（留空沿用已保存值）" />
          <p id="wecomSecretHint" class="muted" style="margin-top:6px;"></p>
        </div>
        <div>
          <label class="label" for="wecomDefaultTouser">Default Touser</label>
          <input id="wecomDefaultTouser" type="text" placeholder="zhangsan 或 @all" />
        </div>
        <div>
          <label class="label" for="wecomCallbackToken">Callback Token</label>
          <input id="wecomCallbackToken" type="text" placeholder="回调校验 token（留空沿用已保存值）" />
        </div>
        <div style="grid-column:1 / -1;">
          <label class="label" for="wecomCallbackAesKey">Callback AES Key</label>
          <input id="wecomCallbackAesKey" type="text" placeholder="43位 EncodingAESKey（留空沿用已保存值）" />
          <p id="wecomCallbackHint" class="muted" style="margin-top:6px;"></p>
        </div>
      </div>
      <div class="top-actions">
        <button class="btn" onclick="saveWecom()">保存配置</button>
        <button class="btn gray" onclick="testWecom()">测试连接</button>
      </div>
      <div id="wecomMsg" class="muted" style="margin-top:8px;"></div>

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0;" />
      <h2 style="margin:0 0 6px;">小程序微信登录配置</h2>
      <p class="muted">用于 `/api/auth/wechat-login`，保存后立即生效。敏感字段仅展示脱敏摘要。</p>
      <div class="form-grid">
        <div>
          <label class="label" for="mpWechatAppId">AppID</label>
          <input id="mpWechatAppId" type="text" placeholder="wx1234567890abcdef" />
        </div>
        <div>
          <label class="label" for="mpWechatAppSecret">AppSecret</label>
          <input id="mpWechatAppSecret" type="text" placeholder="小程序密钥（留空沿用已保存值）" />
          <p id="mpWechatSecretHint" class="muted" style="margin-top:6px;"></p>
        </div>
      </div>
      <div class="top-actions">
        <button class="btn" onclick="saveMiniProgram()">保存登录配置</button>
        <button class="btn gray" onclick="testMiniProgram()">测试配置</button>
      </div>
      <div id="miniProgramMsg" class="muted" style="margin-top:8px;"></div>
    </div>

    <div id="tabPanel-users" class="card tab-panel">
      <h2 style="margin:0 0 6px;">用户管理</h2>
      <p class="muted">统一管理用户资料、企业微信绑定和管理员权限。随机码默认隐藏，鼠标悬停后显示。</p>
      <div class="top-actions">
        <button class="btn gray" onclick="refreshUsers()">刷新用户列表</button>
        <button class="btn" onclick="openCreateUserDialog()">新增用户</button>
        <button class="btn gray" onclick="exportAllUsersCsv()">导出全部用户CSV</button>
        <button class="btn gray" onclick="exportAllCoursesCsv()">导出全部课程CSV</button>
      </div>
      <div id="userMsg" class="muted" style="margin-top:8px;"></div>
      <table style="margin-top:10px;">
        <thead>
          <tr>
            <th style="width:110px;">姓名</th>
            <th style="width:120px;">课表ID</th>
            <th style="width:110px;">学号</th>
            <th style="width:150px;">班级</th>
            <th style="width:90px;">随机码</th>
            <th style="width:150px;">企业微信绑定</th>
            <th style="width:80px;">管理员</th>
            <th style="width:80px;">内置</th>
            <th style="width:360px;">操作</th>
          </tr>
        </thead>
        <tbody id="userRows"></tbody>
      </table>
      <div class="card" style="margin-top:12px; padding:12px;">
        <h3 style="margin:0 0 8px; font-size:16px;">用户 CSV 文件</h3>
        <p class="muted" style="margin-bottom:8px;">支持直接编辑用户列表 CSV（包含内置用户兜底字段）。保存后会立即重载。</p>
        <div id="userCsvPath" class="muted" style="margin-bottom:8px;"></div>
        <textarea id="userCsvEditor" style="min-height:180px;" placeholder="点击“加载 CSV”后编辑内容"></textarea>
        <div class="top-actions">
          <button class="btn gray" onclick="loadUsersCsv()">加载 CSV</button>
          <button class="btn" onclick="saveUsersCsv()">保存 CSV</button>
          <button class="btn gray" onclick="exportCurrentUsersCsv()">导出当前用户CSV</button>
        </div>
      </div>
      <div class="card" style="margin-top:12px; padding:12px;">
        <h3 style="margin:0 0 8px; font-size:16px;">课程 CSV（按用户）</h3>
        <p class="muted" style="margin-bottom:8px;">编辑 `courses.normalized.csv` 里某个用户的课程行。保存后立即生效。</p>
        <div class="form-grid" style="margin-top:0;">
          <div>
            <label class="label" for="courseCsvStudentId">目标课表ID</label>
            <input id="courseCsvStudentId" type="text" placeholder="例如：caiziling" />
          </div>
          <div>
            <label class="label" for="courseCsvPath">课程CSV路径</label>
            <input id="courseCsvPath" type="text" disabled />
          </div>
        </div>
        <textarea id="courseCsvEditor" style="min-height:220px; margin-top:10px;" placeholder="先输入课表ID，再点击“加载课程CSV”"></textarea>
        <div class="top-actions">
          <button class="btn gray" onclick="loadCoursesCsv()">加载课程CSV</button>
          <button class="btn" onclick="saveCoursesCsv()">保存课程CSV</button>
          <button class="btn gray" onclick="exportCurrentCoursesCsv()">导出当前课程CSV</button>
        </div>
      </div>
    </div>

    <div id="userDialogMask" class="dialog-mask" onclick="closeUserDialogByMask(event)">
      <div class="dialog-card" onclick="event.stopPropagation()">
        <h3 id="userDialogTitle" class="dialog-title">新增用户</h3>
        <p id="userDialogSub" class="dialog-sub">填写用户资料并保存。</p>
        <div class="form-grid">
          <div>
            <label class="label" for="userDialogStudentId">课表ID</label>
            <input id="userDialogStudentId" type="text" placeholder="例如：zhangsan" />
          </div>
          <div>
            <label class="label" for="userDialogName">姓名</label>
            <input id="userDialogName" type="text" placeholder="用户姓名" />
          </div>
          <div>
            <label class="label" for="userDialogStudentNo">学号</label>
            <input id="userDialogStudentNo" type="text" placeholder="可选" />
          </div>
          <div>
            <label class="label" for="userDialogClassLabel">班级</label>
            <input id="userDialogClassLabel" type="text" placeholder="可选" />
          </div>
          <div>
            <label class="label" for="userDialogCourseSource">课表来源ID</label>
            <input id="userDialogCourseSource" type="text" placeholder="留空默认使用自身ID（新用户可复用内置课表）" />
          </div>
          <div>
            <label class="label" for="userDialogRandomCode">随机码（4位数字）</label>
            <input id="userDialogRandomCode" type="text" placeholder="留空则不修改" />
          </div>
        </div>
        <div class="top-actions">
          <label style="font-size:13px; display:flex; align-items:center; gap:6px;">
            <input id="userDialogIsAdmin" type="checkbox" />
            设为管理员
          </label>
          <button class="btn" onclick="saveUserDialog()">保存</button>
          <button class="btn gray" onclick="closeUserDialog()">取消</button>
        </div>
        <div id="userDialogMsg" class="muted" style="margin-top:8px;"></div>
      </div>
    </div>

    <div id="tabPanel-themes" class="card tab-panel">
      <h2 style="margin:0 0 6px;">主题图片管理</h2>
      <p class="muted">按主题上传对应背景图。前端会动态拉取并缓存，切换主题时自动生效。</p>
      <div class="top-actions">
        <button class="btn gray" onclick="refreshThemeImages()">刷新主题图片</button>
      </div>
      <div id="themeImageMsg" class="muted" style="margin-top:8px;"></div>
      <div id="themeImageList" class="theme-image-list"></div>
    </div>

    <div id="tabPanel-templates" class="card tab-panel">
      <h2 style="margin:0 0 6px;">推送文案模板</h2>
      <p class="muted">支持变量：{display_name}、{offset}、{course_name}、{classroom}、{classroom_suffix}、{week_no}、{day_label}、{start_section}、{end_section}、{start_time}、{end_time}、{part}、{lesson_time}、{now_text}</p>
      <div class="form-grid">
        <div>
          <label class="label" for="titleTemplate">正式提醒标题</label>
          <input id="titleTemplate" type="text" />
        </div>
        <div>
          <label class="label" for="testTitleTemplate">测试提醒标题</label>
          <input id="testTitleTemplate" type="text" />
        </div>
        <div>
          <label class="label" for="contentTemplate">正式提醒正文</label>
          <textarea id="contentTemplate"></textarea>
        </div>
        <div>
          <label class="label" for="testContentTemplate">测试提醒正文</label>
          <textarea id="testContentTemplate"></textarea>
        </div>
      </div>
      <div class="top-actions">
        <button class="btn" onclick="saveTemplates()">保存模板</button>
      </div>
    </div>
  </div>

  <script>
    const ADMIN_SESSION_STORAGE_KEY = "touchx_admin_session";
    const TABS = ["wecom", "users", "themes", "templates"];
    const TAB_ROUTES = {
      wecom: "/admin/wecom",
      users: "/admin/users",
      themes: "/admin/themes",
      templates: "/admin/templates"
    };
    const THEME_LABELS = { black: "典雅黑", purple: "炫靓紫", green: "不蕉绿", pink: "墨新粉", blue: "菱光蓝", yellow: "曜晶黄", orange: "焰霞橙" };
    const state = {
      templates: {},
      wecom: {},
      miniProgram: {},
      runtime: {},
      themeImages: {},
      themeImageKeys: Object.keys(THEME_LABELS),
      users: [],
      usersCsvPath: "",
      coursesCsvPath: "",
      editingUserId: "",
      userDialogMode: "create",
      activeTab: "wecom"
    };

    async function request(url, options = {}) {
      const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
      const sessionToken = String(sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY) || "").trim();
      if (sessionToken) {
        headers["X-Admin-Session"] = sessionToken;
      }
      const res = await fetch(url, { ...options, headers, credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
        window.location.href = "/login";
        throw new Error("登录已失效，请重新登录");
      }
      if (!res.ok) throw new Error(data.detail || ("请求失败: " + res.status));
      return data;
    }

    async function requestForm(url, formData) {
      const headers = {};
      const sessionToken = String(sessionStorage.getItem(ADMIN_SESSION_STORAGE_KEY) || "").trim();
      if (sessionToken) {
        headers["X-Admin-Session"] = sessionToken;
      }
      const res = await fetch(url, {
        method: "POST",
        body: formData,
        headers,
        credentials: "same-origin"
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
        window.location.href = "/login";
        throw new Error("登录已失效，请重新登录");
      }
      if (!res.ok) throw new Error(data.detail || ("请求失败: " + res.status));
      return data;
    }

    function downloadCsvFile(fileName, content) {
      const blob = new Blob([String(content || "")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = String(fileName || "export.csv");
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    }

    async function logoutAdmin() {
      try {
        await request("/api/admin/logout", { method: "POST" });
      } catch (_) {
      } finally {
        sessionStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
        window.location.href = "/login";
      }
    }

    function resolveTabFromPath(pathname) {
      const path = String(pathname || "").trim();
      if (path === "/admin") return "wecom";
      if (!path.startsWith("/admin/")) return "";
      const segment = path.slice("/admin/".length).split("/")[0];
      return TABS.includes(segment) ? segment : "";
    }

    function onTabLinkClick(event, tabName) {
      if (!event || !tabName) return;
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button === 1) {
        return;
      }
      event.preventDefault();
      switchTab(tabName);
    }

    function switchTab(tabName, syncRoute = true, useReplace = false) {
      if (!TABS.includes(tabName)) return;
      state.activeTab = tabName;
      for (const tab of TABS) {
        const btn = document.getElementById("tabBtn-" + tab);
        const panel = document.getElementById("tabPanel-" + tab);
        if (btn) btn.classList.toggle("active", tab === tabName);
        if (panel) panel.classList.toggle("active", tab === tabName);
      }
      if (syncRoute) {
        const targetPath = TAB_ROUTES[tabName] || "/admin/wecom";
        if (window.location.pathname !== targetPath) {
          if (useReplace) {
            window.history.replaceState({ tab: tabName }, "", targetPath);
          } else {
            window.history.pushState({ tab: tabName }, "", targetPath);
          }
        }
      }
    }

    function setMiniProgramMsg(text, isError) {
      const el = document.getElementById("miniProgramMsg");
      if (!el) {
        console.warn("miniProgramMsg element not found");
        return;
      }
      el.textContent = text;
      el.className = isError ? "err" : "ok";
    }

    function renderRuntimeBadge() {
      const runtime = state.runtime || {};
      const pushMode = String(runtime.push_mode || "-").trim() || "-";
      const workerEnabled = Boolean(runtime.worker_enabled);
      const pushModeBadge = document.getElementById("pushModeBadge");
      const workerBadge = document.getElementById("workerBadge");
      if (pushModeBadge) {
        pushModeBadge.textContent = `PUSH_MODE: ${pushMode}`;
        pushModeBadge.className = `mode-badge ${pushMode === "wecom" ? "mode-wecom" : (pushMode === "mock" ? "mode-mock" : "")}`.trim();
      }
      if (workerBadge) {
        workerBadge.textContent = `WORKER: ${workerEnabled ? "ON" : "OFF"}`;
        workerBadge.className = `mode-badge ${workerEnabled ? "state-on" : "state-off"}`;
      }
    }

    async function refreshAll() {
      const [templateData, wecomData, miniProgramData, themeImageData, adminUserData, healthData] = await Promise.all([
        request("/api/settings/templates"),
        request("/api/settings/wecom"),
        request("/api/settings/mini-program"),
        request("/api/settings/theme-images"),
        request("/api/admin/users"),
        request("/health")
      ]);
      state.templates = templateData || {};
      state.wecom = wecomData || {};
      state.miniProgram = miniProgramData || {};
      state.runtime = healthData || {};
      state.themeImages = (themeImageData && themeImageData.images) || {};
      state.themeImageKeys = (themeImageData && themeImageData.themeKeys) || Object.keys(THEME_LABELS);
      state.users = (adminUserData && adminUserData.items) || [];
      state.usersCsvPath = String((adminUserData && adminUserData.csvPath) || "");
      renderRuntimeBadge();
      renderTemplates();
      renderWecom();
      renderMiniProgram();
      renderThemeImages();
      renderUsers();
      setThemeImageMsg("主题图片列表已刷新", false);
      setUserMsg(`当前用户数：${state.users.length}，管理员：${state.users.filter(item => !!item.isAdmin).length}`, false);
      setGlobal("已刷新", false);
    }

    function renderTemplates() {
      document.getElementById("titleTemplate").value = state.templates.title_template || "";
      document.getElementById("contentTemplate").value = state.templates.content_template || "";
      document.getElementById("testTitleTemplate").value = state.templates.test_title_template || "";
      document.getElementById("testContentTemplate").value = state.templates.test_content_template || "";
    }

    function renderWecom() {
      const conf = state.wecom || {};
      const callbackHint = document.getElementById("callbackUrlHint");
      if (callbackHint) callbackHint.textContent = window.location.origin + "/api/wecom/callback";
      document.getElementById("wecomApiBase").value = conf.api_base || "https://qyapi.weixin.qq.com";
      document.getElementById("wecomCorpId").value = conf.corp_id || "";
      document.getElementById("wecomAgentId").value = conf.agent_id || "";
      document.getElementById("wecomDefaultTouser").value = conf.default_touser || "";
      document.getElementById("wecomCorpSecret").value = "";
      document.getElementById("wecomCallbackToken").value = "";
      document.getElementById("wecomCallbackAesKey").value = "";
      const secretMasked = String(conf.corp_secret_masked || "").trim();
      const callbackTokenMasked = String(conf.callback_token_masked || "").trim();
      const callbackAesKeyMasked = String(conf.callback_aes_key_masked || "").trim();
      const secretInput = document.getElementById("wecomCorpSecret");
      const callbackTokenInput = document.getElementById("wecomCallbackToken");
      const callbackAesInput = document.getElementById("wecomCallbackAesKey");
      secretInput.placeholder = secretMasked ? `已保存：${secretMasked}（留空沿用）` : "企业微信应用 Secret（必填）";
      callbackTokenInput.placeholder = callbackTokenMasked ? `已保存：${callbackTokenMasked}（留空沿用）` : "回调校验 token（可选）";
      callbackAesInput.placeholder = callbackAesKeyMasked ? `已保存：${callbackAesKeyMasked}（留空沿用）` : "43位 EncodingAESKey（可选）";
      document.getElementById("wecomSecretHint").textContent = secretMasked ? `Secret 返显（脱敏）：${secretMasked}` : "Secret 尚未配置";
      if (conf.callback_configured) {
        document.getElementById("wecomCallbackHint").textContent = `回调参数返显（脱敏）：${callbackTokenMasked} / ${callbackAesKeyMasked}`;
      } else {
        document.getElementById("wecomCallbackHint").textContent = "回调参数未配置";
      }
      if (conf.configured) {
        const callbackState = conf.callback_configured ? "，回调参数已配置" : "，回调参数未配置";
        setWecomMsg("已配置（secret 已脱敏保存）" + callbackState, false);
      } else {
        setWecomMsg("尚未配置企业微信鉴权信息", true);
      }
    }

    function renderMiniProgram() {
      const conf = state.miniProgram || {};
      document.getElementById("mpWechatAppId").value = conf.app_id || "";
      document.getElementById("mpWechatAppSecret").value = "";
      const appSecretMasked = String(conf.app_secret_masked || "").trim();
      const secretInput = document.getElementById("mpWechatAppSecret");
      secretInput.placeholder = appSecretMasked ? `已保存：${appSecretMasked}（留空沿用）` : "小程序密钥（必填）";
      document.getElementById("mpWechatSecretHint").textContent = appSecretMasked ? `AppSecret 返显（脱敏）：${appSecretMasked}` : "AppSecret 尚未配置";
    }

    function resolveThemeLabel(themeKey) {
      return THEME_LABELS[themeKey] || themeKey;
    }

    function resolveThemeImagePreviewUrl(themeKey) {
      const images = state.themeImages || {};
      const rawUrl = String(images[themeKey] || "").trim();
      if (!rawUrl) {
        return "";
      }
      if (/^https?:\/\//i.test(rawUrl) || rawUrl.startsWith("/")) {
        return rawUrl;
      }
      return "";
    }

    function renderThemeImages() {
      const el = document.getElementById("themeImageList");
      if (!el) {
        return;
      }
      const keys = Array.isArray(state.themeImageKeys) && state.themeImageKeys.length
        ? state.themeImageKeys
        : Object.keys(THEME_LABELS);
      if (!keys.length) {
        el.innerHTML = '<div class="muted">暂无主题配置</div>';
        return;
      }
      el.innerHTML = keys.map((themeKey) => {
        const label = resolveThemeLabel(themeKey);
        const previewUrl = resolveThemeImagePreviewUrl(themeKey);
        const imageNode = previewUrl
          ? `<img class="theme-image-preview" src="${escapeHtml(previewUrl)}" alt="${escapeHtml(label)}" />`
          : '<div class="theme-image-preview theme-image-empty">未配置图片</div>';
        const rawUrl = String((state.themeImages || {})[themeKey] || "").trim();
        const meta = rawUrl ? `当前：${escapeHtml(rawUrl)}` : "当前：未配置";
        return `
          <div class="theme-image-item">
            <div class="theme-image-title">${escapeHtml(label)}（${escapeHtml(themeKey)}）</div>
            ${imageNode}
            <div class="theme-image-meta">${meta}</div>
            <div class="theme-image-actions">
              <input id="themeImageFile-${escapeHtml(themeKey)}" type="file" accept="image/*" />
              <button class="btn" onclick="uploadThemeImage('${escapeHtml(themeKey)}')">上传并保存</button>
              <button class="btn gray" onclick="clearThemeImage('${escapeHtml(themeKey)}')">清除</button>
            </div>
          </div>
        `;
      }).join("");
    }

    async function refreshThemeImages() {
      try {
        const data = await request("/api/settings/theme-images");
        state.themeImages = (data && data.images) || {};
        state.themeImageKeys = (data && data.themeKeys) || Object.keys(THEME_LABELS);
        renderThemeImages();
        setThemeImageMsg("主题图片列表已刷新", false);
      } catch (e) {
        setThemeImageMsg(String(e.message || e), true);
      }
    }

    async function uploadThemeImage(themeKey) {
      const key = String(themeKey || "").trim();
      if (!key) {
        setThemeImageMsg("主题键为空，请刷新后重试", true);
        return;
      }
      const fileInput = document.getElementById("themeImageFile-" + key);
      const file = fileInput && fileInput.files ? fileInput.files[0] : null;
      if (!file) {
        setThemeImageMsg(`请先选择 ${resolveThemeLabel(key)} 的图片文件`, true);
        return;
      }
      try {
        const formData = new FormData();
        formData.append("theme_key", key);
        formData.append("file", file);
        const data = await requestForm("/api/settings/theme-images/upload", formData);
        state.themeImages = (data && data.images) || {};
        state.themeImageKeys = (data && data.themeKeys) || Object.keys(THEME_LABELS);
        renderThemeImages();
        setThemeImageMsg(`${resolveThemeLabel(key)} 图片已更新`, false);
      } catch (e) {
        setThemeImageMsg(String(e.message || e), true);
      } finally {
        if (fileInput) {
          fileInput.value = "";
        }
      }
    }

    async function clearThemeImage(themeKey) {
      const key = String(themeKey || "").trim();
      if (!key) {
        setThemeImageMsg("主题键为空，请刷新后重试", true);
        return;
      }
      try {
        const data = await request("/api/settings/theme-images", {
          method: "POST",
          body: JSON.stringify({
            theme_key: key,
            image_url: ""
          }),
        });
        state.themeImages = (data && data.images) || {};
        state.themeImageKeys = (data && data.themeKeys) || Object.keys(THEME_LABELS);
        renderThemeImages();
        setThemeImageMsg(`${resolveThemeLabel(key)} 图片已清除`, false);
      } catch (e) {
        setThemeImageMsg(String(e.message || e), true);
      }
    }

    function renderSecretCode(code) {
      const value = String(code || "").trim();
      if (!value) return "-";
      return `<span class="code-secret" title="悬停显示随机码"><span class="code-mask">••••</span><span class="code-real">${escapeHtml(value)}</span></span>`;
    }

    function setUserDialogMsg(text, isError) {
      const el = document.getElementById("userDialogMsg");
      if (!el) return;
      el.textContent = String(text || "");
      el.className = isError ? "err" : "ok";
    }

    function setCourseCsvStudentId(studentId) {
      const input = document.getElementById("courseCsvStudentId");
      if (!input) return;
      input.value = String(studentId || "").trim();
    }

    function renderUsers() {
      const rows = Array.isArray(state.users) ? state.users : [];
      const el = document.getElementById("userRows");
      const pathEl = document.getElementById("userCsvPath");
      const coursePathInput = document.getElementById("courseCsvPath");
      if (pathEl) {
        pathEl.textContent = state.usersCsvPath ? `当前文件：${state.usersCsvPath}` : "当前文件：-";
      }
      if (coursePathInput) {
        coursePathInput.value = String(state.coursesCsvPath || "");
      }
      if (!rows.length) {
        el.innerHTML = '<tr><td colspan="9" class="muted">暂无用户数据</td></tr>';
        return;
      }
      el.innerHTML = rows.map((item, idx) => {
        const ids = Array.isArray(item.wecomUserIds) ? item.wecomUserIds.filter(Boolean) : [];
        const wecomText = ids.length ? ids.join(", ") : "-";
        const canDelete = !item.builtIn;
        const hasBinding = Boolean(item.wecomSubscriberKey);
        return `
          <tr>
            <td>${escapeHtml(item.name || "-")}</td>
            <td>${escapeHtml(item.studentId || "-")}</td>
            <td>${escapeHtml(item.studentNo || "-")}</td>
            <td>${escapeHtml(item.classLabel || "-")}</td>
            <td>${renderSecretCode(item.randomCode)}</td>
            <td>${escapeHtml(wecomText)}</td>
            <td>${item.isAdmin ? "是" : "否"}</td>
            <td>${item.builtIn ? "是" : "否"}</td>
            <td>
              <button class="btn gray" onclick="openEditUserDialog(${idx})">编辑</button>
              <button class="btn gray" onclick="deleteUser(${idx})" ${canDelete ? "" : "disabled"}>删除</button>
              <button class="btn gray" onclick="testUserBinding(${idx})" ${hasBinding ? "" : "disabled"}>测试推送</button>
              <button class="btn gray" onclick="exportUserCsv(${idx})">导出用户CSV</button>
              <button class="btn gray" onclick="exportCourseCsv(${idx})">导出课程CSV</button>
            </td>
          </tr>
        `;
      }).join("");
    }

    function resetUserDialogForm() {
      state.editingUserId = "";
      state.userDialogMode = "create";
      document.getElementById("userDialogTitle").textContent = "新增用户";
      document.getElementById("userDialogSub").textContent = "填写用户资料并保存。";
      document.getElementById("userDialogStudentId").value = "";
      document.getElementById("userDialogStudentId").disabled = false;
      document.getElementById("userDialogName").value = "";
      document.getElementById("userDialogStudentNo").value = "";
      document.getElementById("userDialogClassLabel").value = "";
      document.getElementById("userDialogCourseSource").value = "";
      document.getElementById("userDialogRandomCode").value = "";
      document.getElementById("userDialogIsAdmin").checked = false;
      setUserDialogMsg("", false);
    }

    function openCreateUserDialog() {
      resetUserDialogForm();
      const mask = document.getElementById("userDialogMask");
      if (mask) mask.classList.add("open");
    }

    function openEditUserDialog(index) {
      const item = (state.users || [])[index];
      if (!item || !item.studentId) {
        setUserMsg("用户不存在，请刷新后重试", true);
        return;
      }
      state.editingUserId = String(item.studentId || "").trim();
      state.userDialogMode = "edit";
      document.getElementById("userDialogTitle").textContent = "编辑用户";
      document.getElementById("userDialogSub").textContent = `正在编辑：${item.name || item.studentId}`;
      document.getElementById("userDialogStudentId").value = state.editingUserId;
      document.getElementById("userDialogStudentId").disabled = true;
      document.getElementById("userDialogName").value = String(item.name || "");
      document.getElementById("userDialogStudentNo").value = String(item.studentNo || "");
      document.getElementById("userDialogClassLabel").value = String(item.classLabel || "");
      document.getElementById("userDialogCourseSource").value = String(item.courseSourceStudentId || "");
      document.getElementById("userDialogRandomCode").value = "";
      document.getElementById("userDialogIsAdmin").checked = Boolean(item.isAdmin);
      setUserDialogMsg("", false);
      setCourseCsvStudentId(state.editingUserId);
      const mask = document.getElementById("userDialogMask");
      if (mask) mask.classList.add("open");
    }

    function closeUserDialogByMask(event) {
      const target = event && event.target;
      if (!target || target.id !== "userDialogMask") return;
      closeUserDialog();
    }

    function closeUserDialog() {
      const mask = document.getElementById("userDialogMask");
      if (mask) mask.classList.remove("open");
      resetUserDialogForm();
    }

    async function saveUserDialog() {
      const editingId = String(state.editingUserId || "").trim();
      const studentId = String(document.getElementById("userDialogStudentId").value || "").trim();
      const name = String(document.getElementById("userDialogName").value || "").trim();
      const studentNo = String(document.getElementById("userDialogStudentNo").value || "").trim();
      const classLabel = String(document.getElementById("userDialogClassLabel").value || "").trim();
      const courseSource = String(document.getElementById("userDialogCourseSource").value || "").trim();
      const randomCode = String(document.getElementById("userDialogRandomCode").value || "").trim();
      const isAdmin = Boolean(document.getElementById("userDialogIsAdmin").checked);

      if (!editingId && !studentId) {
        setUserDialogMsg("新增用户必须填写课表ID", true);
        return;
      }
      if (!name) {
        setUserDialogMsg("姓名不能为空", true);
        return;
      }

      const payload = {
        name,
        student_no: studentNo,
        class_label: classLabel,
        course_source_student_id: courseSource,
        is_admin: isAdmin
      };
      if (randomCode) {
        payload.random_code = randomCode;
      }

      try {
        let data = {};
        if (editingId) {
          data = await request(`/api/admin/users/${encodeURIComponent(editingId)}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });
        } else {
          data = await request("/api/admin/users", {
            method: "POST",
            body: JSON.stringify({
              ...payload,
              student_id: studentId
            }),
          });
        }
        state.users = (data && data.items) || [];
        renderUsers();
        setCourseCsvStudentId(String(editingId || studentId));
        setUserMsg("用户保存成功", false);
        closeUserDialog();
      } catch (e) {
        setUserDialogMsg(String(e.message || e), true);
      }
    }

    async function refreshUsers() {
      try {
        const data = await request("/api/admin/users");
        state.users = (data && data.items) || [];
        state.usersCsvPath = String((data && data.csvPath) || "");
        renderUsers();
        setUserMsg("用户列表已刷新", false);
      } catch (e) {
        setUserMsg(String(e.message || e), true);
      }
    }

    async function deleteUser(index) {
      const item = (state.users || [])[index];
      if (!item || !item.studentId) {
        setUserMsg("用户不存在，请刷新后重试", true);
        return;
      }
      if (item.builtIn) {
        setUserMsg("内置用户不允许删除", true);
        return;
      }
      if (!window.confirm(`确认删除用户 ${item.name || item.studentId} 吗？`)) {
        return;
      }
      try {
        const data = await request(`/api/admin/users/${encodeURIComponent(item.studentId)}`, { method: "DELETE" });
        state.users = (data && data.items) || [];
        renderUsers();
        if (state.editingUserId === item.studentId) closeUserDialog();
        setUserMsg("用户已删除", false);
      } catch (e) {
        setUserMsg(String(e.message || e), true);
      }
    }

    async function testUserBinding(index) {
      const item = (state.users || [])[index];
      if (!item || !item.wecomSubscriberKey) {
        setUserMsg("该用户暂无企业微信绑定", true);
        return;
      }
      try {
        await request("/api/subscribers/test", {
          method: "POST",
          body: JSON.stringify({ subscriber_key: item.wecomSubscriberKey }),
        });
        setUserMsg(`已发送测试推送：${item.name || item.studentId}`, false);
      } catch (e) {
        setUserMsg(String(e.message || e), true);
      }
    }

    async function loadUsersCsv() {
      try {
        const data = await request("/api/admin/users/csv");
        const content = String((data && data.csvContent) || "");
        state.usersCsvPath = String((data && data.path) || state.usersCsvPath || "");
        const editor = document.getElementById("userCsvEditor");
        if (editor) editor.value = content;
        renderUsers();
        setUserMsg("CSV 已加载", false);
      } catch (e) {
        setUserMsg(String(e.message || e), true);
      }
    }

    async function exportAllUsersCsv() {
      try {
        const data = await request("/api/admin/users/csv");
        downloadCsvFile(String((data && data.fileName) || "users.normalized.csv"), String((data && data.csvContent) || ""));
        setUserMsg("已导出全部用户CSV", false);
      } catch (e) {
        setUserMsg(String(e.message || e), true);
      }
    }

    async function exportCurrentUsersCsv() {
      const studentId = String(document.getElementById("courseCsvStudentId").value || "").trim();
      const query = studentId ? `?student_id=${encodeURIComponent(studentId)}` : "";
      try {
        const data = await request(`/api/admin/users/csv${query}`);
        downloadCsvFile(String((data && data.fileName) || "users.normalized.csv"), String((data && data.csvContent) || ""));
        setUserMsg(studentId ? `已导出用户CSV：${studentId}` : "已导出全部用户CSV", false);
      } catch (e) {
        setUserMsg(String(e.message || e), true);
      }
    }

    async function exportAllCoursesCsv() {
      try {
        const data = await request("/api/admin/courses/csv");
        downloadCsvFile(String((data && data.fileName) || "courses.normalized.csv"), String((data && data.csvContent) || ""));
        state.coursesCsvPath = String((data && data.path) || state.coursesCsvPath || "");
        renderUsers();
        setUserMsg("已导出全部课程CSV", false);
      } catch (e) {
        setUserMsg(String(e.message || e), true);
      }
    }

    async function exportCurrentCoursesCsv() {
      const studentId = String(document.getElementById("courseCsvStudentId").value || "").trim();
      if (!studentId) {
        setUserMsg("请先输入目标课表ID", true);
        return;
      }
      try {
        const data = await request(`/api/admin/courses/csv?student_id=${encodeURIComponent(studentId)}`);
        downloadCsvFile(String((data && data.fileName) || `courses.${studentId}.csv`), String((data && data.csvContent) || ""));
        setUserMsg(`已导出课程CSV：${studentId}`, false);
      } catch (e) {
        setUserMsg(String(e.message || e), true);
      }
    }

    async function exportUserCsv(index) {
      const item = (state.users || [])[index];
      if (!item || !item.studentId) {
        setUserMsg("用户不存在，请刷新后重试", true);
        return;
      }
      setCourseCsvStudentId(item.studentId);
      try {
        const data = await request(`/api/admin/users/csv?student_id=${encodeURIComponent(item.studentId)}`);
        downloadCsvFile(String((data && data.fileName) || `users.${item.studentId}.csv`), String((data && data.csvContent) || ""));
        setUserMsg(`已导出用户CSV：${item.studentId}`, false);
      } catch (e) {
        setUserMsg(String(e.message || e), true);
      }
    }

    async function exportCourseCsv(index) {
      const item = (state.users || [])[index];
      if (!item || !item.studentId) {
        setUserMsg("用户不存在，请刷新后重试", true);
        return;
      }
      setCourseCsvStudentId(item.studentId);
      try {
        const data = await request(`/api/admin/courses/csv?student_id=${encodeURIComponent(item.studentId)}`);
        downloadCsvFile(String((data && data.fileName) || `courses.${item.studentId}.csv`), String((data && data.csvContent) || ""));
        setUserMsg(`已导出课程CSV：${item.studentId}`, false);
      } catch (e) {
        setUserMsg(String(e.message || e), true);
      }
    }

    async function saveUsersCsv() {
      const editor = document.getElementById("userCsvEditor");
      const content = editor ? String(editor.value || "") : "";
      if (!content.trim()) {
        setUserMsg("CSV 内容不能为空", true);
        return;
      }
      try {
        const data = await request("/api/admin/users/csv", {
          method: "POST",
          body: JSON.stringify({ csv_content: content }),
        });
        state.users = (data && data.items) || [];
        state.usersCsvPath = String((data && data.path) || state.usersCsvPath || "");
        renderUsers();
        setUserMsg("CSV 保存成功并已重载", false);
      } catch (e) {
        setUserMsg(String(e.message || e), true);
      }
    }

    async function loadCoursesCsv() {
      const studentId = String(document.getElementById("courseCsvStudentId").value || "").trim();
      if (!studentId) {
        setUserMsg("请先输入目标课表ID", true);
        return;
      }
      try {
        const data = await request(`/api/admin/courses/csv?student_id=${encodeURIComponent(studentId)}`);
        const editor = document.getElementById("courseCsvEditor");
        if (editor) {
          editor.value = String((data && data.csvContent) || "");
        }
        state.coursesCsvPath = String((data && data.path) || state.coursesCsvPath || "");
        const pathInput = document.getElementById("courseCsvPath");
        if (pathInput) {
          pathInput.value = state.coursesCsvPath;
        }
        setUserMsg(`课程 CSV 已加载：${studentId}（${Number((data && data.rowCount) || 0)} 行）`, false);
      } catch (e) {
        setUserMsg(String(e.message || e), true);
      }
    }

    async function saveCoursesCsv() {
      const studentId = String(document.getElementById("courseCsvStudentId").value || "").trim();
      const editor = document.getElementById("courseCsvEditor");
      const content = editor ? String(editor.value || "") : "";
      if (!studentId) {
        setUserMsg("请先输入目标课表ID", true);
        return;
      }
      if (!content.trim()) {
        setUserMsg("课程 CSV 内容不能为空", true);
        return;
      }
      try {
        const data = await request("/api/admin/courses/csv", {
          method: "POST",
          body: JSON.stringify({
            student_id: studentId,
            csv_content: content
          }),
        });
        state.users = (data && data.items) || [];
        state.coursesCsvPath = String((data && data.path) || state.coursesCsvPath || "");
        renderUsers();
        setUserMsg(`课程 CSV 保存成功：${studentId}（${Number((data && data.rowCount) || 0)} 行）`, false);
      } catch (e) {
        setUserMsg(String(e.message || e), true);
      }
    }

    async function saveTemplates() {
      const titleTemplate = (document.getElementById("titleTemplate").value || "").trim();
      const contentTemplate = (document.getElementById("contentTemplate").value || "").trim();
      const testTitleTemplate = (document.getElementById("testTitleTemplate").value || "").trim();
      const testContentTemplate = (document.getElementById("testContentTemplate").value || "").trim();
      if (!titleTemplate || !contentTemplate || !testTitleTemplate || !testContentTemplate) {
        setGlobal("模板内容不能为空", true);
        return;
      }
      try {
        await request("/api/settings/templates", {
          method: "POST",
          body: JSON.stringify({
            title_template: titleTemplate,
            content_template: contentTemplate,
            test_title_template: testTitleTemplate,
            test_content_template: testContentTemplate
          }),
        });
        setGlobal("模板保存成功", false);
      } catch (e) {
        setGlobal(String(e.message || e), true);
      }
    }

    async function saveWecom() {
      const apiBase = (document.getElementById("wecomApiBase").value || "").trim();
      const corpId = (document.getElementById("wecomCorpId").value || "").trim();
      const agentId = (document.getElementById("wecomAgentId").value || "").trim();
      const corpSecret = (document.getElementById("wecomCorpSecret").value || "").trim();
      const defaultTouser = (document.getElementById("wecomDefaultTouser").value || "").trim();
      const callbackToken = (document.getElementById("wecomCallbackToken").value || "").trim();
      const callbackAesKey = (document.getElementById("wecomCallbackAesKey").value || "").trim();
      if (!apiBase || !corpId || !agentId || !defaultTouser) {
        setWecomMsg("api_base / corp_id / agent_id / default_touser 不能为空", true);
        return;
      }
      try {
        const data = await request("/api/settings/wecom", {
          method: "POST",
          body: JSON.stringify({
            api_base: apiBase,
            corp_id: corpId,
            agent_id: agentId,
            corp_secret: corpSecret,
            default_touser: defaultTouser,
            callback_token: callbackToken,
            callback_aes_key: callbackAesKey
          }),
        });
        state.wecom = data;
        setWecomMsg("企业微信配置已保存", false);
        renderWecom();
      } catch (e) {
        setWecomMsg(String(e.message || e), true);
      }
    }

    async function saveMiniProgram() {
      const appId = (document.getElementById("mpWechatAppId").value || "").trim();
      const appSecret = (document.getElementById("mpWechatAppSecret").value || "").trim();
      if (!appId) {
        setMiniProgramMsg("❌ app_id 不能为空", true);
        return;
      }
      try {
        const data = await request("/api/settings/mini-program", {
          method: "POST",
          body: JSON.stringify({
            app_id: appId,
            app_secret: appSecret,
          }),
        });
        state.miniProgram = data;
        renderMiniProgram();
        setMiniProgramMsg("✅ 小程序登录配置保存成功（已生效）", false);
        setGlobal("✅ 小程序登录配置保存成功", false);
      } catch (e) {
        setMiniProgramMsg("❌ " + String(e.message || e), true);
      }
    }

    async function testMiniProgram() {
      const appId = (document.getElementById("mpWechatAppId").value || "").trim();
      const appSecret = (document.getElementById("mpWechatAppSecret").value || "").trim();
      try {
        const data = await request("/api/settings/mini-program/test", {
          method: "POST",
          body: JSON.stringify({
            app_id: appId,
            app_secret: appSecret,
          }),
        });
        const preview = String(data.access_token_preview || "-");
        const expiresIn = Number(data.expires_in || 0);
        setMiniProgramMsg(`✅ 配置可用，token 预览: ${preview}，有效期: ${expiresIn} 秒`, false);
      } catch (e) {
        setMiniProgramMsg("❌ " + String(e.message || e), true);
      }
    }

    async function testWecom() {
      try {
        const data = await request("/api/settings/wecom/test", { method: "POST" });
        setWecomMsg("连接成功，token 预览: " + (data.access_token_preview || "-"), false);
      } catch (e) {
        setWecomMsg(String(e.message || e), true);
      }
    }

    function setGlobal(text, isError) {
      const el = document.getElementById("globalMsg");
      el.textContent = text;
      el.className = `${isError ? "err" : "ok"} header-status`;
    }

    function setWecomMsg(text, isError) {
      const el = document.getElementById("wecomMsg");
      el.textContent = text;
      el.className = isError ? "err" : "ok";
    }

    function setUserMsg(text, isError) {
      const el = document.getElementById("userMsg");
      if (!el) return;
      el.textContent = text;
      el.className = isError ? "err" : "ok";
    }

    function setThemeImageMsg(text, isError) {
      const el = document.getElementById("themeImageMsg");
      el.textContent = text;
      el.className = isError ? "err" : "ok";
    }

    function escapeHtml(s) {
      return String(s || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
    }

    const routeTab = resolveTabFromPath(window.location.pathname) || state.activeTab;
    switchTab(routeTab, true, true);
    window.addEventListener("popstate", () => {
      const nextTab = resolveTabFromPath(window.location.pathname) || "wecom";
      switchTab(nextTab, false);
    });
    refreshAll().catch(err => setGlobal(String(err.message || err), true));
  </script>
</body>
</html>"""


@app.get("/", response_class=HTMLResponse)
def admin_home(request: Request):
    if is_admin_authenticated(request):
        return RedirectResponse(url="/admin/wecom", status_code=302)
    return RedirectResponse(url="/login", status_code=302)


@app.get("/admin", response_class=HTMLResponse)
def admin_page() -> HTMLResponse:
    return RedirectResponse(url="/admin/wecom", status_code=302)


@app.get("/admin/{tab_name}", response_class=HTMLResponse)
def admin_page_with_tab(tab_name: str) -> HTMLResponse:
    normalized = (tab_name or "").strip().lower()
    if normalized not in ADMIN_SECOND_LEVEL_TABS:
        raise HTTPException(status_code=404, detail="页面不存在")
    return HTMLResponse(build_admin_html())


@app.get("/login", response_class=HTMLResponse)
def admin_login_page(request: Request):
    if is_admin_authenticated(request):
        return RedirectResponse(url="/admin/wecom", status_code=302)
    return HTMLResponse(build_login_html())


@app.post("/api/admin/login")
def admin_login(body: AdminLoginRequest, request: Request) -> JSONResponse:
    token = body.token.strip()
    if not verify_admin_token(token):
        raise HTTPException(status_code=401, detail="登录失败：token 不正确")
    session_id, expires_at = create_admin_session()
    x_forwarded_proto = str(request.headers.get("x-forwarded-proto", "")).split(",")[0].strip().lower()
    secure_cookie = request.url.scheme == "https" or x_forwarded_proto == "https"
    response = JSONResponse({"ok": True, "expiresAt": expires_at, "sessionToken": session_id})
    response.set_cookie(
        key=ADMIN_WEB_SESSION_COOKIE,
        value=session_id,
        max_age=max(600, ADMIN_WEB_SESSION_TTL_SECONDS),
        httponly=True,
        samesite="lax",
        secure=secure_cookie,
        path="/",
    )
    return response


@app.post("/api/admin/logout")
def admin_logout() -> JSONResponse:
    response = JSONResponse({"ok": True})
    response.delete_cookie(ADMIN_WEB_SESSION_COOKIE, path="/")
    return response


@app.get("/api/wecom/callback", response_class=PlainTextResponse)
def wecom_callback_verify(msg_signature: str, timestamp: str, nonce: str, echostr: str) -> PlainTextResponse:
    config = get_wecom_config()
    token = config.get("callback_token", "")
    aes_key = config.get("callback_aes_key", "")
    if not token or not aes_key:
        raise HTTPException(status_code=500, detail="请先配置 callback_token 和 callback_aes_key")

    decoded_echostr = urllib.parse.unquote(echostr)
    expected_signature = compute_wecom_signature(token, timestamp, nonce, decoded_echostr)
    if expected_signature != msg_signature:
        raise HTTPException(status_code=400, detail="msg_signature 校验失败")

    try:
        plain_text, receive_id = decrypt_wecom_echostr(decoded_echostr, aes_key)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    corp_id = config.get("corp_id")
    if corp_id and receive_id and receive_id != corp_id:
        raise HTTPException(status_code=400, detail="回调 receive_id 与 corp_id 不匹配")
    return PlainTextResponse(content=plain_text)


@app.post("/api/wecom/callback", response_class=PlainTextResponse)
async def wecom_callback_receive(
    request: Request,
    msg_signature: Optional[str] = None,
    timestamp: Optional[str] = None,
    nonce: Optional[str] = None,
) -> PlainTextResponse:
    raw_body = await request.body()
    if not raw_body:
        return PlainTextResponse(content="success")

    try:
        outer_xml = parse_xml_message(raw_body.decode("utf-8", "ignore"))
    except RuntimeError as exc:
        print(f"[WECOM CALLBACK] XML parse error: {exc}")
        return PlainTextResponse(content="success")

    message_data = outer_xml
    encrypted = outer_xml.get("Encrypt", "").strip()
    if encrypted:
        config = get_wecom_config()
        token = config.get("callback_token", "")
        aes_key = config.get("callback_aes_key", "")
        if not token or not aes_key:
            print("[WECOM CALLBACK] missing callback token/aes key")
            return PlainTextResponse(content="success")
        if not msg_signature or not timestamp or not nonce:
            print("[WECOM CALLBACK] missing signature query params")
            return PlainTextResponse(content="success")

        expected_signature = compute_wecom_signature(token, timestamp, nonce, encrypted)
        if expected_signature != msg_signature:
            print("[WECOM CALLBACK] signature verify failed")
            return PlainTextResponse(content="success")

        try:
            plain_xml, receive_id = decrypt_wecom_echostr(encrypted, aes_key)
            corp_id = config.get("corp_id")
            if corp_id and receive_id and receive_id != corp_id:
                print("[WECOM CALLBACK] receive_id mismatch")
                return PlainTextResponse(content="success")
            message_data = parse_xml_message(plain_xml)
        except RuntimeError as exc:
            print(f"[WECOM CALLBACK] decrypt failed: {exc}")
            return PlainTextResponse(content="success")

    from_user = (message_data.get("FromUserName") or "").strip()
    msg_type = (message_data.get("MsgType") or "").strip().lower()
    if not from_user:
        return PlainTextResponse(content="success")

    if msg_type == "text":
        content = message_data.get("Content", "")
        try:
            reply = handle_wecom_text_command(from_user, content)
        except Exception as exc:
            reply = f"命令处理失败：{exc}"
        try:
            send_wecom_text(title="课表助手", content=reply, touser=from_user)
        except Exception as exc:
            print(f"[WECOM CALLBACK] reply send failed: {exc}")

    return PlainTextResponse(content="success")


@app.get("/health")
def health() -> Dict[str, Any]:
    wecom_info = get_wecom_config_public()
    mini_program_info = get_mini_program_config_public()
    return {
        "status": "ok",
        "db": str(DB_PATH),
        "push_mode": PUSH_MODE,
        "timezone": TIMEZONE_NAME,
        "week1_monday": TERM_WEEK1_MONDAY,
        "worker_enabled": ENABLE_REMINDER_WORKER,
        "admin_web_auth_configured": bool(ADMIN_WEB_AUTH_TOKEN),
        "wecom_configured": wecom_info["configured"],
        "wecom_callback_configured": wecom_info["callback_configured"],
        "mp_wechat_login_configured": mini_program_info["configured"],
    }


@app.get("/api/schedules")
def schedules() -> Dict[str, Any]:
    return {
        "students": [
            {
                "studentId": student_id,
                "name": schedule["name"],
                "classLabel": str(schedule.get("classLabel", "")),
                "studentNo": str(schedule.get("studentNo", "")),
                "courseCount": len(schedule["courses"]),
            }
            for student_id, schedule in SCHEDULES.items()
        ]
    }


def build_schedule_term_payload() -> Dict[str, Any]:
    return {
        "name": "默认学期",
        "week1Monday": TERM_WEEK1_MONDAY,
        "maxWeek": 25,
    }


def build_schedule_section_times_payload() -> List[Dict[str, Any]]:
    return [
        {
            "section": section,
            "start": value["start"],
            "end": value["end"],
            "part": value["part"],
        }
        for section, value in sorted(SECTION_TIMES.items(), key=lambda item: item[0])
    ]


def build_schedule_student_payload(student_id: str) -> Dict[str, Any]:
    ensure_student_exists(student_id)
    schedule = SCHEDULES[student_id]
    profile = get_user_profile_optional(student_id) or {}
    courses = []
    for course in schedule.get("courses", []):
        courses.append(
            {
                "id": str(course.get("id", "")),
                "name": str(course.get("name", "")),
                "day": int(course.get("day", 0)),
                "startSection": int(course.get("startSection", 0)),
                "endSection": int(course.get("endSection", 0)),
                "weekExpr": str(course.get("weekExpr", "")),
                "parity": str(course.get("parity", "all")),
                "classroom": course.get("classroom"),
                "teacher": course.get("teacher"),
                "teachingClasses": course.get("teachingClasses"),
                "practiceCourseKey": build_course_practice_key(course),
            }
        )
    return {
        "id": student_id,
        "name": str(schedule.get("name", student_id)),
        "classLabel": str(schedule.get("classLabel", "")),
        "studentNo": str(profile.get("student_no", "") or schedule.get("studentNo", "")),
        "courses": courses,
    }


@app.get("/api/schedules/full")
def schedules_full() -> Dict[str, Any]:
    students = [build_schedule_student_payload(student_id) for student_id in SCHEDULES.keys()]
    return {
        "term": build_schedule_term_payload(),
        "sectionTimes": build_schedule_section_times_payload(),
        "weekdayLabels": DAY_LABELS,
        "students": students,
        "generatedAt": int(time.time()),
    }


@app.get("/api/schedules/student")
def schedules_student(student_id: str, request: Request) -> Dict[str, Any]:
    session = require_auth_session(request)
    current_student_id = require_bound_student_id(session)
    target_student_id = student_id.strip()
    ensure_student_exists(target_student_id)
    ensure_user_profile(target_student_id)
    require_schedule_read_permission(current_student_id, target_student_id)
    return {
        "term": build_schedule_term_payload(),
        "sectionTimes": build_schedule_section_times_payload(),
        "weekdayLabels": DAY_LABELS,
        "student": build_schedule_student_payload(target_student_id),
        "generatedAt": int(time.time()),
    }


@app.get("/api/today-brief")
def today_brief(student_id: str = "caiziling") -> Dict[str, Any]:
    now = get_now()
    return build_today_brief(student_id=student_id, now=now)


@app.post("/api/auth/wechat-login")
def auth_wechat_login(body: MiniProgramAuthLoginRequest) -> Dict[str, Any]:
    student_id = (body.student_id or "").strip()
    if not student_id:
        student_id = (resolve_student_id_by_student_no(body.student_no) or "").strip()
    if student_id:
        ensure_student_exists(student_id)
    code = body.code.strip()
    open_id, auth_mode = resolve_wechat_openid(code=code)
    persisted_student_id = get_auth_binding_student(open_id)
    if persisted_student_id and not get_user_profile_optional(persisted_student_id):
        remove_auth_binding(open_id)
        persisted_student_id = ""
    if persisted_student_id:
        if student_id and student_id != persisted_student_id:
            raise HTTPException(status_code=403, detail="当前微信已绑定其他课表账号，请先手动解除授权")
        student_id = persisted_student_id
    if student_id:
        ensure_auth_binding_allowed(open_id, student_id)
    nickname = trim_profile_text(body.nickname, max_length=40)
    avatar_url = trim_profile_text(body.avatar_url, max_length=300)
    session = create_auth_session(
        open_id=open_id,
        auth_mode=auth_mode,
        student_id=student_id,
        nickname=nickname,
        avatar_url=avatar_url,
    )
    if student_id:
        ensure_user_profile(student_id)
        if body.student_no is not None:
            set_user_student_no(student_id, body.student_no)
        set_auth_binding(open_id, student_id)
    if avatar_url and student_id:
        set_user_media(student_id, avatar_url=avatar_url)
    return {
        "ok": True,
        "token": session["token"],
        "expiresAt": session["expiresAt"],
        "expiresIn": max(0, int(session["expiresAt"]) - int(time.time())),
        "mode": session["mode"],
        "user": {
            "openId": session["openId"],
            "studentId": session["studentId"],
            "studentName": session["studentName"],
            "classLabel": session["classLabel"],
            "nickname": session["nickname"],
            "avatarUrl": session["avatarUrl"],
        },
    }


@app.get("/api/auth/me")
def auth_me(request: Request) -> Dict[str, Any]:
    session = require_auth_session(request)
    return {
        "ok": True,
        "mode": session["mode"],
        "expiresAt": session["expiresAt"],
        "user": {
            "openId": session["openId"],
            "studentId": session["studentId"],
            "studentName": session["studentName"],
            "classLabel": session["classLabel"],
            "nickname": session["nickname"],
            "avatarUrl": session["avatarUrl"],
        },
    }


@app.post("/api/auth/logout")
def auth_logout(request: Request) -> Dict[str, Any]:
    token = parse_auth_token_from_request(request)
    revoke_auth_session(token)
    return {"ok": True}


@app.post("/api/auth/unbind")
def auth_unbind(request: Request) -> Dict[str, Any]:
    session = require_auth_session(request)
    token = str(session.get("token") or "").strip()
    open_id = str(session.get("openId") or "").strip()
    bound_student_id = get_auth_binding_student(open_id)
    if bound_student_id:
        remove_auth_binding_by_student(bound_student_id)
    else:
        remove_auth_binding(open_id)
    revoke_auth_sessions_by_open_id(open_id)
    revoke_auth_session(token)
    return {"ok": True}


@app.get("/api/media/{file_name}")
def get_uploaded_media(file_name: str) -> FileResponse:
    target = resolve_media_file_path(file_name)
    return FileResponse(target)


@app.get("/api/social/me")
def social_me(request: Request) -> Dict[str, Any]:
    session = require_auth_session(request)
    student_id = str(session.get("studentId") or "").strip()
    if not student_id:
        candidates = [
            build_social_user_payload(other_id, include_random_code=False, reveal_sensitive=False)
            for other_id in SCHEDULES.keys()
        ]
        return {
            "ok": True,
            "me": None,
            "subscriptions": [],
            "subscribers": [],
            "candidates": candidates,
            "bound": False,
        }
    return {"ok": True, **build_social_dashboard_payload(student_id), "bound": True}


@app.post("/api/social/bind-student")
def social_bind_student(body: SocialBindStudentRequest, request: Request) -> Dict[str, Any]:
    session = require_auth_session(request)
    target_student_id = body.target_student_id.strip()
    current_student_id = str(session.get("studentId") or "").strip()
    open_id = str(session.get("openId") or "").strip()
    ensure_auth_binding_allowed(open_id, target_student_id)
    require_target_random_code_if_needed(current_student_id, target_student_id, body.target_random_code)
    ensure_user_profile(target_student_id)
    token = str(session.get("token") or "").strip()
    update_auth_session_student(token, target_student_id)
    set_auth_binding(open_id, target_student_id)
    return {"ok": True, "me": build_social_user_payload(target_student_id, include_random_code=True, reveal_sensitive=True)}


@app.post("/api/social/profile")
def social_save_profile(body: SocialSaveProfileRequest, request: Request) -> Dict[str, Any]:
    session = require_auth_session(request)
    student_id = require_bound_student_id(session)
    avatar_url = normalize_media_url(body.avatar_url, max_length=300) if body.avatar_url is not None else None
    wallpaper_url = normalize_media_url(body.wallpaper_url, max_length=500) if body.wallpaper_url is not None else None
    if body.student_no is not None:
        set_user_student_no(student_id, body.student_no)
    set_user_media(student_id, avatar_url=avatar_url, wallpaper_url=wallpaper_url)
    if avatar_url is not None:
        update_auth_session_avatar(str(session.get("token", "")), avatar_url)
    return {"ok": True, "me": build_social_user_payload(student_id, include_random_code=True, reveal_sensitive=True)}


@app.post("/api/social/random-code")
def social_update_random_code(body: SocialUpdateRandomCodeRequest, request: Request) -> Dict[str, Any]:
    session = require_auth_session(request)
    student_id = require_bound_student_id(session)
    result = set_user_random_code(student_id, body.random_code)
    return {
        "ok": True,
        "changed": bool(result.get("changed")),
        "removedSubscriberCount": int(result.get("removed_subscribers") or 0),
        "me": build_social_user_payload(student_id, include_random_code=True, reveal_sensitive=True),
    }


@app.post("/api/social/subscribe")
def social_subscribe(body: SocialSubscribeRequest, request: Request) -> Dict[str, Any]:
    session = require_auth_session(request)
    current_student_id = require_bound_student_id(session)
    target_student_id = body.target_student_id.strip()
    require_target_random_code_if_needed(current_student_id, target_student_id, body.target_random_code)
    subscribe_student(current_student_id, target_student_id)
    return {"ok": True, "targetStudentId": target_student_id}


@app.post("/api/social/upload/avatar")
def social_upload_avatar(request: Request, file: UploadFile = File(...)) -> Dict[str, Any]:
    session = require_auth_session(request)
    student_id = require_bound_student_id(session)
    avatar_url = save_uploaded_image(request, file, usage="avatar", max_bytes=MAX_AVATAR_UPLOAD_BYTES)
    set_user_media(student_id, avatar_url=avatar_url)
    update_auth_session_avatar(str(session.get("token", "")), avatar_url)
    return {
        "ok": True,
        "avatarUrl": avatar_url,
        "me": build_social_user_payload(student_id, include_random_code=True, reveal_sensitive=True),
    }


@app.post("/api/social/upload/wallpaper")
def social_upload_wallpaper(request: Request, file: UploadFile = File(...)) -> Dict[str, Any]:
    session = require_auth_session(request)
    student_id = require_bound_student_id(session)
    wallpaper_url = save_uploaded_image(request, file, usage="wallpaper", max_bytes=MAX_WALLPAPER_UPLOAD_BYTES)
    set_user_media(student_id, wallpaper_url=wallpaper_url)
    return {
        "ok": True,
        "wallpaperUrl": wallpaper_url,
        "me": build_social_user_payload(student_id, include_random_code=True, reveal_sensitive=True),
    }


@app.post("/api/social/subscribe/remove")
def social_unsubscribe(body: SocialUnsubscribeRequest, request: Request) -> Dict[str, Any]:
    session = require_auth_session(request)
    current_student_id = require_bound_student_id(session)
    target_student_id = body.target_student_id.strip()
    unsubscribe_student(current_student_id, target_student_id)
    return {"ok": True, "targetStudentId": target_student_id}


@app.post("/api/social/practice-course")
def social_toggle_practice_course(body: SocialTogglePracticeCourseRequest, request: Request) -> Dict[str, Any]:
    session = require_auth_session(request)
    student_id = require_bound_student_id(session)
    course_key, practice_course_keys = toggle_user_practice_course(student_id, body.course_key, bool(body.enabled))
    return {
        "ok": True,
        "courseKey": course_key,
        "enabled": bool(body.enabled),
        "practiceCourseKeys": practice_course_keys,
    }


@app.post("/api/social/notify/bind")
def social_bind_notify(body: SocialBindNotifyRequest, request: Request) -> Dict[str, Any]:
    session = require_auth_session(request)
    student_id = require_bound_student_id(session)
    value = (body.channel_url or body.channel_token or "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="请输入企业微信用户 ID 或 wecom://用户ID")
    bind_notify_channel(student_id, value, display_name=body.display_name)
    return {"ok": True}


@app.post("/api/social/notify/unbind")
def social_unbind_notify(request: Request) -> Dict[str, Any]:
    session = require_auth_session(request)
    student_id = require_bound_student_id(session)
    unbind_notify_channel(student_id)
    return {"ok": True}


@app.get("/api/theme-images")
def get_theme_images() -> Dict[str, Any]:
    images, updated_at = get_theme_image_settings()
    return {"ok": True, "images": images, "updatedAt": updated_at, "themeKeys": list(THEME_KEYS)}


@app.get("/api/admin/users")
def admin_list_users(request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    return {"ok": True, "items": list_admin_user_payloads(), "csvPath": str(USER_CSV_PATH)}


@app.post("/api/admin/users")
def admin_create_user(body: AdminCreateUserRequest, request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    target_id = ensure_valid_student_id(body.student_id)
    if target_id in SCHEDULES:
        raise HTTPException(status_code=400, detail="student_id 已存在")

    upsert_user_registry_row(
        student_id=target_id,
        name=body.name,
        class_label=body.class_label,
        student_no=body.student_no,
        course_source_student_id=body.course_source_student_id,
        built_in=False,
    )
    ensure_user_profile(target_id)
    if body.student_no is not None:
        set_user_student_no(target_id, body.student_no)
    if body.is_admin is not None:
        set_user_admin(target_id, bool(body.is_admin))
    if body.random_code is not None:
        set_user_random_code(target_id, body.random_code)

    return {"ok": True, "item": build_admin_user_payload(target_id), "items": list_admin_user_payloads()}


@app.put("/api/admin/users/{student_id}")
def admin_update_user(student_id: str, body: AdminUpdateUserRequest, request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    target_id = normalize_student_id(student_id)
    ensure_student_exists(target_id)

    if any(
        item is not None
        for item in [body.name, body.class_label, body.student_no, body.course_source_student_id]
    ):
        upsert_user_registry_row(
            student_id=target_id,
            name=body.name,
            class_label=body.class_label,
            student_no=body.student_no,
            course_source_student_id=body.course_source_student_id,
        )

    ensure_user_profile(target_id)
    if body.student_no is not None:
        set_user_student_no(target_id, body.student_no)
    if body.is_admin is not None:
        set_user_admin(target_id, bool(body.is_admin))
    if body.random_code is not None:
        set_user_random_code(target_id, body.random_code)

    return {"ok": True, "item": build_admin_user_payload(target_id), "items": list_admin_user_payloads()}


@app.post("/api/admin/users/admin")
def admin_set_user_role_compat(body: Dict[str, Any], request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    target_id = normalize_student_id(body.get("student_id", ""))
    ensure_student_exists(target_id)
    set_user_admin(target_id, bool(body.get("is_admin")))
    return {"ok": True, "studentId": target_id, "isAdmin": bool(body.get("is_admin"))}


@app.delete("/api/admin/users/{student_id}")
def admin_delete_user(student_id: str, request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    target_id = normalize_student_id(student_id)
    delete_user_registry_row(target_id)
    return {"ok": True, "studentId": target_id, "items": list_admin_user_payloads()}


@app.get("/api/admin/users/csv")
def admin_get_users_csv(request: Request, student_id: Optional[str] = None) -> Dict[str, Any]:
    require_admin_session(request)
    rows = get_user_registry_csv_rows(student_id=student_id)
    normalized_student_id = normalize_student_id(student_id or "")
    content = build_user_registry_csv_text(rows)
    return {
        "ok": True,
        "path": str(USER_CSV_PATH),
        "studentId": normalized_student_id,
        "rowCount": len(rows),
        "fileName": f"users.{normalized_student_id}.csv" if normalized_student_id else "users.normalized.csv",
        "csvContent": content,
    }


@app.post("/api/admin/users/csv")
def admin_save_users_csv(body: AdminUpdateUsersCsvRequest, request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    parsed_rows = parse_user_registry_csv_content(body.csv_content)
    save_user_registry_rows_and_reload(parsed_rows)
    for student_id in SCHEDULES.keys():
        ensure_user_profile(student_id)
    return {"ok": True, "items": list_admin_user_payloads(), "path": str(USER_CSV_PATH)}


@app.get("/api/admin/courses/csv")
def admin_get_courses_csv(request: Request, student_id: Optional[str] = None) -> Dict[str, Any]:
    require_admin_session(request)
    normalized_student_id = normalize_student_id(student_id or "")
    if normalized_student_id:
        headers, rows, text = get_course_rows_for_student(normalized_student_id)
    else:
        headers, rows = read_course_csv_table(COURSE_CSV_PATH)
        text = build_course_csv_text(headers, rows)
    return {
        "ok": True,
        "studentId": normalized_student_id,
        "path": str(COURSE_CSV_PATH),
        "headers": headers,
        "rowCount": len(rows),
        "fileName": f"courses.{normalized_student_id}.csv" if normalized_student_id else "courses.normalized.csv",
        "csvContent": text,
    }


@app.post("/api/admin/courses/csv")
def admin_save_courses_csv(body: AdminUpdateCoursesCsvRequest, request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    normalized_student_id = normalize_student_id(body.student_id)
    ensure_student_exists(normalized_student_id)
    _, existing_rows = read_course_csv_table(COURSE_CSV_PATH)
    default_term = infer_default_term_from_course_rows(existing_rows)
    headers, parsed_rows = parse_course_csv_content_for_student(normalized_student_id, body.csv_content, default_term=default_term)
    replace_course_rows_for_student(normalized_student_id, parsed_rows, preferred_headers=headers)
    return {
        "ok": True,
        "studentId": normalized_student_id,
        "path": str(COURSE_CSV_PATH),
        "rowCount": len(parsed_rows),
        "items": list_admin_user_payloads(),
    }


@app.get("/api/settings/theme-images")
def get_theme_image_settings_admin(request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    images, updated_at = get_theme_image_settings()
    return {"ok": True, "images": images, "updatedAt": updated_at, "themeKeys": list(THEME_KEYS)}


@app.post("/api/settings/theme-images")
def update_theme_image_settings_admin(body: SaveThemeImageRequest, request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    result = update_single_theme_image(body.theme_key, body.image_url)
    return {"ok": True, **result, "themeKeys": list(THEME_KEYS)}


@app.post("/api/settings/theme-images/upload")
def upload_theme_image_settings_admin(
    request: Request,
    theme_key: str = Form(...),
    file: UploadFile = File(...),
) -> Dict[str, Any]:
    require_admin_session(request)
    normalized_theme_key = normalize_theme_key(theme_key)
    uploaded_url = save_uploaded_image(
        request,
        file,
        usage=f"theme-{normalized_theme_key}",
        max_bytes=MAX_WALLPAPER_UPLOAD_BYTES,
    )
    result = update_single_theme_image(normalized_theme_key, uploaded_url)
    return {"ok": True, **result, "themeKeys": list(THEME_KEYS)}


@app.get("/api/settings/templates")
def get_templates(request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    return get_push_templates()


@app.post("/api/settings/templates")
def update_templates(body: SaveTemplatesRequest, request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    save_push_templates(body)
    return {"ok": True, **get_push_templates()}


@app.get("/api/settings/wecom")
def get_wecom_settings(request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    return get_wecom_config_public()


@app.post("/api/settings/wecom")
def update_wecom_settings(body: SaveWecomConfigRequest, request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    save_wecom_config(body)
    return {"ok": True, **get_wecom_config_public()}


@app.post("/api/settings/wecom/test")
def test_wecom_settings(request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    try:
        result = test_wecom_connection()
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result


@app.get("/api/settings/mini-program")
def get_mini_program_settings(request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    return get_mini_program_config_public()


@app.post("/api/settings/mini-program")
def update_mini_program_settings(body: SaveMiniProgramConfigRequest, request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    save_mini_program_config(body)
    return {"ok": True, **get_mini_program_config_public()}


@app.post("/api/settings/mini-program/test")
def test_mini_program_settings(request: Request, body: Optional[TestMiniProgramConfigRequest] = None) -> Dict[str, Any]:
    require_admin_session(request)
    payload = body or TestMiniProgramConfigRequest()
    try:
        result = test_mini_program_connection(payload.app_id, payload.app_secret)
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result


@app.get("/api/wecom/bindings")
def wecom_bindings(request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    return {"items": list_wecom_bindings()}


@app.post("/api/subscribers/register")
def register_subscriber(body: RegisterSubscriberRequest, request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    student_id = resolve_student_id_by_name(body.name)
    if not student_id:
        raise HTTPException(status_code=404, detail="未找到对应课表姓名")

    channel_url = ensure_channel_url(body.channel_url or build_channel_url_from_token(body.channel_token))
    subscriber_key = (body.subscriber_key or "").strip() or make_subscriber_key(student_id, channel_url)
    canonical_name = SCHEDULES[student_id]["name"]
    existing = get_subscriber_by_key(subscriber_key)
    display_name = normalize_display_name(body.display_name, canonical_name)
    if existing and body.display_name is None:
        display_name = normalize_display_name(existing.get("display_name"), canonical_name)

    if body.disabled_days is None:
        disabled_days = parse_disabled_days(existing.get("disabled_days") if existing else [])
    else:
        disabled_days = normalize_disabled_days(body.disabled_days)
    reminder_offsets = parse_reminder_offsets(existing.get("reminder_offsets") if existing else None)
    daily_overview = bool(existing.get("daily_overview")) if existing else False

    upsert_subscriber(
        subscriber_key=subscriber_key,
        name=canonical_name,
        student_id=student_id,
        channel_url=channel_url,
        display_name=display_name,
        disabled_days=disabled_days,
        reminder_offsets=reminder_offsets,
        daily_overview=daily_overview,
    )

    return {
        "ok": True,
        "subscriberKey": subscriber_key,
        "name": canonical_name,
        "studentId": student_id,
        "channelUrl": channel_url,
        "displayName": display_name,
        "disabledDays": disabled_days,
    }


@app.post("/api/subscribers/active")
def update_subscriber_active(body: UpdateSubscriberRequest, request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    ok = set_subscriber_active(body.subscriber_key, body.active)
    if not ok:
        raise HTTPException(status_code=404, detail="subscriber_key 不存在")
    return {"ok": True, "subscriberKey": body.subscriber_key, "active": body.active}


@app.get("/api/subscribers")
def subscribers(request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    return {"items": list_subscribers()}


@app.post("/api/subscribers/test")
def test_subscriber_push(body: TestPushRequest, request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    sub = get_subscriber_by_key(body.subscriber_key)
    if not sub:
        raise HTTPException(status_code=404, detail="subscriber_key 不存在")
    title, content = build_test_push_payload(sub)
    try:
        send_message(sub["channel_url"], title, content)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "subscriberKey": body.subscriber_key}
