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
import shutil
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
BACKEND_DIR = BASE_DIR.parent


def detect_project_root(start_path: Path) -> Path:
    current = start_path.resolve()
    while True:
        if (current / "pnpm-workspace.yaml").exists() or (current / ".git").exists():
            return current
        if current.parent == current:
            return start_path.resolve().parent
        current = current.parent


def resolve_first_existing_path(*candidates: Path) -> Path:
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


PROJECT_ROOT = detect_project_root(BACKEND_DIR)


def resolve_backend_storage_path(env_name: str, default_path: Path) -> Path:
    raw_value = str(os.getenv(env_name, "") or "").strip()
    if not raw_value:
        return default_path
    candidate = Path(raw_value)
    if candidate.is_absolute():
        return candidate
    normalized = raw_value.replace("\\", "/")
    if normalized.startswith("ends/"):
        normalized = normalized[len("ends/") :]
    if normalized.startswith("backends/legacy-fastapi/"):
        normalized = normalized[len("backends/legacy-fastapi/") :]
    if normalized.startswith(("apps/", "backends/", "packages/")):
        return (PROJECT_ROOT / normalized).resolve()
    candidate = Path(normalized)
    return (BACKEND_DIR / candidate).resolve()


DEFAULT_DB_PATH = BASE_DIR / "touchx.db"
DEFAULT_COURSE_CSV_PATH = BACKEND_DIR / "data/normalized/courses.normalized.csv"
DEFAULT_USER_CSV_PATH = BACKEND_DIR / "data/normalized/users.normalized.csv"
LEGACY_COURSE_CSV_PATH = resolve_first_existing_path(
    PROJECT_ROOT / "apps/microapp/src/data/normalized/courses.normalized.csv",
    PROJECT_ROOT / "src/data/normalized/courses.normalized.csv",
)
LEGACY_USER_CSV_PATH = resolve_first_existing_path(
    PROJECT_ROOT / "apps/microapp/src/data/normalized/users.normalized.csv",
    PROJECT_ROOT / "src/data/normalized/users.normalized.csv",
)

DB_PATH = resolve_backend_storage_path("TOUCHX_DB_PATH", DEFAULT_DB_PATH)
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
COURSE_CSV_PATH = resolve_backend_storage_path("COURSE_CSV_PATH", DEFAULT_COURSE_CSV_PATH)
USER_CSV_PATH = resolve_backend_storage_path("USER_CSV_PATH", DEFAULT_USER_CSV_PATH)
MP_WECHAT_APPID = os.getenv("MP_WECHAT_APPID", "").strip()
MP_WECHAT_SECRET = os.getenv("MP_WECHAT_SECRET", "").strip()
AUTH_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60
MEDIA_STORAGE_DIR = resolve_backend_storage_path("MEDIA_STORAGE_DIR", BASE_DIR / "media_temp")
ADMIN_DIST_DIR = resolve_backend_storage_path("ADMIN_DIST_DIR", BACKEND_DIR / "admin_dist")
MEDIA_BASE_PATH = "/api/media"
MAX_AVATAR_UPLOAD_BYTES = int(os.getenv("MAX_AVATAR_UPLOAD_BYTES", str(2 * 1024 * 1024)))
MAX_WALLPAPER_UPLOAD_BYTES = int(os.getenv("MAX_WALLPAPER_UPLOAD_BYTES", str(5 * 1024 * 1024)))
ALLOWED_IMAGE_TYPES = {"jpg", "png", "gif", "webp"}
RANDOM_CODE_LENGTH = 4
RANDOM_CODE_SPACE_SIZE = 10 ** RANDOM_CODE_LENGTH
RANDOM_CODE_MAX_ATTEMPTS = max(64, RANDOM_CODE_SPACE_SIZE // 2)
CLASS_RANDOM_CODE_LENGTH = 6
CLASS_RANDOM_CODE_SPACE_SIZE = 10 ** CLASS_RANDOM_CODE_LENGTH
CLASS_RANDOM_CODE_MAX_ATTEMPTS = max(128, CLASS_RANDOM_CODE_SPACE_SIZE // 2)
CLASS_CODE_MIGRATION_VERSION = "class_subscription_v1"
FOOD_REVEAL_SCOPE_SHARE_TOKEN = "share_token"
ADMIN_ROLE_SUPER_ADMIN = "super_admin"
ADMIN_ROLE_OPERATOR = "operator"
ADMIN_ROLE_NONE = "none"
SENSITIVE_MASK_TEXT = "已隐藏"
DEFAULT_ADMIN_STUDENT_ID = "tangzixian"
ADMIN_SECOND_LEVEL_TABS = ("wecom", "users", "themes", "foods", "templates")
THEME_KEYS = ("black", "purple", "green", "pink", "blue", "yellow", "orange")
DEFAULT_THEME_IMAGE_CANDIDATES = (
    PROJECT_ROOT / "apps/microapp/src/static/theme/purple.png",
    PROJECT_ROOT / "src/static/theme/purple.png",
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
        "name": "潘晓锋",
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
    "潘晓锋": "panxiaofeng",
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


def normalize_admin_role(value: Any, is_admin: bool = False) -> str:
    if not is_admin:
        return ADMIN_ROLE_NONE
    role = str(value or "").strip().lower()
    if role in {ADMIN_ROLE_SUPER_ADMIN, ADMIN_ROLE_OPERATOR}:
        return role
    return ADMIN_ROLE_OPERATOR


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


def migrate_legacy_csv_file_if_needed(env_name: str, target_path: Path, legacy_path: Path) -> None:
    if str(os.getenv(env_name, "") or "").strip():
        return
    if not legacy_path.exists():
        return
    if target_path.exists():
        target_rows = read_csv_non_empty_row_count(target_path)
        legacy_rows = read_csv_non_empty_row_count(legacy_path)
        if target_rows > 0 or legacy_rows <= 0:
            return
    target_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(legacy_path, target_path)


def ensure_schedule_csv_storage_ready() -> None:
    migrate_legacy_csv_file_if_needed("USER_CSV_PATH", USER_CSV_PATH, LEGACY_USER_CSV_PATH)
    migrate_legacy_csv_file_if_needed("COURSE_CSV_PATH", COURSE_CSV_PATH, LEGACY_COURSE_CSV_PATH)


def read_csv_non_empty_row_count(path: Path) -> int:
    if not path.exists():
        return 0
    with path.open("r", encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        count = 0
        for row in reader:
            if any(str(value or "").strip() for value in (row or {}).values()):
                count += 1
        return count


def parse_int_or_zero(value: Any) -> int:
    try:
        return int(str(value or "").strip())
    except (TypeError, ValueError):
        return 0


def build_fallback_course_id(student_id: str, row: Dict[str, str], parity: str) -> str:
    source = "|".join(
        [
            student_id,
            str(row.get("course_name", "") or "").strip(),
            str(row.get("day", "") or "").strip(),
            str(row.get("start_section", "") or "").strip(),
            str(row.get("end_section", "") or "").strip(),
            str(row.get("week_expr", "") or "").strip(),
            parity,
        ]
    )
    digest = hashlib.sha1(source.encode("utf-8")).hexdigest()[:10]
    return f"csv-{digest}"


def build_csv_course_map(rows: List[Dict[str, str]]) -> Dict[str, List[Dict[str, Any]]]:
    course_map: Dict[str, List[Dict[str, Any]]] = {}
    for row in rows:
        student_id = normalize_student_id(row.get("student_id", ""))
        if not student_id:
            continue
        course_name = str(row.get("course_name", "") or "").strip()
        day = parse_int_or_zero(row.get("day", ""))
        start_section = parse_int_or_zero(row.get("start_section", ""))
        end_section = parse_int_or_zero(row.get("end_section", ""))
        week_expr = str(row.get("week_expr", "") or "").strip()
        if not course_name or day <= 0 or start_section <= 0 or end_section <= 0 or not week_expr:
            continue
        parity = normalize_course_parity(row.get("parity"))
        course_id = str(row.get("course_id", "") or "").strip() or build_fallback_course_id(student_id, row, parity)
        course: Dict[str, Any] = {
            "id": course_id,
            "name": course_name,
            "day": day,
            "startSection": start_section,
            "endSection": end_section,
            "weekExpr": week_expr,
        }
        if parity in {"odd", "even"}:
            course["parity"] = parity
        classroom = str(row.get("classroom", "") or "").strip()
        if classroom:
            course["classroom"] = classroom
        teacher = str(row.get("teacher", "") or "").strip()
        if teacher:
            course["teacher"] = teacher
        teaching_classes = str(row.get("teaching_classes", "") or "").strip()
        if teaching_classes:
            course["teachingClasses"] = teaching_classes
        course_map.setdefault(student_id, []).append(course)
    return course_map


def resolve_courses_from_source(
    student_id: str,
    source_id: str,
    csv_course_map: Dict[str, List[Dict[str, Any]]],
) -> List[Dict[str, Any]]:
    if student_id in csv_course_map:
        return copy.deepcopy(csv_course_map[student_id])
    source = normalize_student_id(source_id)
    if source and source in csv_course_map:
        return copy.deepcopy(csv_course_map[source])
    if student_id in BUILTIN_SCHEDULES:
        return copy.deepcopy(BUILTIN_SCHEDULES[student_id].get("courses", []))
    if source in BUILTIN_SCHEDULES:
        return copy.deepcopy(BUILTIN_SCHEDULES[source].get("courses", []))
    return []


def rebuild_runtime_schedule_registry(rows: List[Dict[str, str]]) -> None:
    _, course_csv_rows = read_course_csv_table(COURSE_CSV_PATH)
    csv_course_map = build_csv_course_map(course_csv_rows)
    runtime_schedules: Dict[str, Dict[str, Any]] = {}
    runtime_aliases: Dict[str, str] = {}
    runtime_override_alias: Dict[str, str] = {}
    runtime_registry: Dict[str, Dict[str, Any]] = {}

    for row in rows:
        student_id = row["student_id"]
        source_id = normalize_student_id(row.get("course_source_student_id", ""))
        courses = resolve_courses_from_source(student_id, source_id, csv_course_map)
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
        "2) bind 学号或姓名 - 绑定课表（例：bind 2305200133）",
        "3) sub 学号或姓名 - 追加订阅他人课表",
        "4) unsub 学号或姓名 - 取消订阅",
        "5) subs - 查看当前订阅",
        "6) offsets - 查看提醒档位",
        "7) offset 分钟 on|off - 设置提醒档位（60/30/15/5）",
        "8) digest on|off - 开关每日总览",
        "9) test [学号或姓名] - 测试推送",
    ]
)

FOOD_TEMPLATE_DAILY = "daily"
FOOD_TEMPLATE_PARTY = "party"
FOOD_TEMPLATE_KEYS = (FOOD_TEMPLATE_DAILY, FOOD_TEMPLATE_PARTY)
FOOD_CAMPAIGN_STATUS_OPEN = "open"
FOOD_CAMPAIGN_STATUS_CLOSED = "closed"
FOOD_CAMPAIGN_STATUS_CANCELLED = "cancelled"
FOOD_CAMPAIGN_JOIN_MODE_ALL = "all"
FOOD_CAMPAIGN_JOIN_MODE_INVITE = "invite"
FOOD_CAMPAIGN_JOIN_MODE_PASSWORD = "password"
FOOD_CAMPAIGN_JOIN_MODE_KEYS = (
    FOOD_CAMPAIGN_JOIN_MODE_ALL,
    FOOD_CAMPAIGN_JOIN_MODE_INVITE,
    FOOD_CAMPAIGN_JOIN_MODE_PASSWORD,
)
FOOD_CAMPAIGN_PARTICIPANT_PENDING = "pending"
FOOD_CAMPAIGN_PARTICIPANT_APPROVED = "approved"
FOOD_CAMPAIGN_PARTICIPANT_REJECTED = "rejected"
FOOD_PRICE_TREND_DECREASE = "decrease"
FOOD_PRICE_TREND_INCREASE = "increase"
FOOD_PRICE_TREND_FLAT = "flat"
FOOD_PRICE_TREND_KEYS = (FOOD_PRICE_TREND_DECREASE, FOOD_PRICE_TREND_INCREASE, FOOD_PRICE_TREND_FLAT)
FOOD_CAMPAIGN_MIN_VOTE_LIMIT = 1
FOOD_CAMPAIGN_MAX_VOTE_LIMIT = 3
FOOD_CAMPAIGN_INITIAL_CANDIDATE_COUNT = 3
FOOD_CAMPAIGN_MAX_SUPPLEMENT_COUNT = 1
FOOD_CAMPAIGN_MIN_DEADLINE_SECONDS = 5 * 60
FOOD_CAMPAIGN_PASSWORD_MIN_LENGTH = 4
FOOD_CAMPAIGN_PASSWORD_MAX_LENGTH = 32
FOOD_CANDIDATE_SOURCE_INITIAL = "initial"
FOOD_CANDIDATE_SOURCE_SUPPLEMENT = "supplement"
FOOD_PARTICIPANT_SOURCE_INVITE = "invite"
FOOD_PARTICIPANT_SOURCE_INITIATOR = "initiator"
FOOD_PARTICIPANT_SOURCE_JOIN_REQUEST = "join_request"
FOOD_WINNER_DEFAULT_FIRST_VOTE_TS = 2**62
FOOD_CANDIDATE_STATUS_APPROVED = "approved"
FOOD_CANDIDATE_STATUS_PENDING_REVIEW = "pending_review"
FOOD_CANDIDATE_STATUS_PENDING_EAT = "pending_eat"
FOOD_CANDIDATE_STATUS_REJECTED = "rejected"
FOOD_CANDIDATE_STATUS_KEYS = (
    FOOD_CANDIDATE_STATUS_APPROVED,
    FOOD_CANDIDATE_STATUS_PENDING_REVIEW,
    FOOD_CANDIDATE_STATUS_PENDING_EAT,
    FOOD_CANDIDATE_STATUS_REJECTED,
)
FOOD_CANDIDATE_STATUS_LABEL_MAP: Dict[str, str] = {
    FOOD_CANDIDATE_STATUS_APPROVED: "已通过",
    FOOD_CANDIDATE_STATUS_PENDING_REVIEW: "待审核",
    FOOD_CANDIDATE_STATUS_PENDING_EAT: "待吃",
    FOOD_CANDIDATE_STATUS_REJECTED: "已拒绝",
}

FOOD_GLOBAL_PRICING_DEFAULT: Dict[str, Any] = {
    "trend_mode": FOOD_PRICE_TREND_FLAT,
    "anchor_headcount": 4,
    "slope": 0.03,
    "min_factor": 0.75,
    "max_factor": 1.45,
}

FOOD_PRICE_TEMPLATE_TIERS: Dict[str, List[Dict[str, Any]]] = {
    FOOD_TEMPLATE_DAILY: [
        {"id": "daily_under_8", "label": "苟活套餐", "min": 0.0, "max": 8.0},
        {"id": "daily_8_12", "label": "穷死鬼套餐", "min": 8.0, "max": 12.0},
        {"id": "daily_12_15", "label": "小康套餐", "min": 12.0, "max": 15.0},
        {"id": "daily_15_18", "label": "富公区", "min": 15.0, "max": 18.0},
        {"id": "daily_18_plus", "label": "禁区", "min": 18.0, "max": None},
    ],
    FOOD_TEMPLATE_PARTY: [
        {"id": "party_25_35", "label": "聚会实惠档", "min": 25.0, "max": 35.0},
        {"id": "party_35_45", "label": "聚会优选档", "min": 35.0, "max": 45.0},
        {"id": "party_45_65", "label": "聚会富公档", "min": 45.0, "max": 65.0},
        {"id": "party_65_plus", "label": "聚会腰子档", "min": 65.0, "max": None},
    ],
}

FOOD_CATEGORY_RULE_SEEDS: List[Dict[str, Any]] = [
    {
        "category_key": "stir_fry",
        "category_name": "炒菜",
        "trend_mode": FOOD_PRICE_TREND_DECREASE,
        "anchor_headcount": 4,
        "slope": 0.05,
        "min_factor": 0.68,
        "max_factor": 1.12,
    },
    {
        "category_key": "maocai",
        "category_name": "冒菜",
        "trend_mode": FOOD_PRICE_TREND_INCREASE,
        "anchor_headcount": 3,
        "slope": 0.04,
        "min_factor": 0.85,
        "max_factor": 1.45,
    },
    {
        "category_key": "hotpot",
        "category_name": "火锅",
        "trend_mode": FOOD_PRICE_TREND_FLAT,
        "anchor_headcount": 5,
        "slope": 0.02,
        "min_factor": 0.85,
        "max_factor": 1.25,
    },
    {
        "category_key": "grill",
        "category_name": "烧烤",
        "trend_mode": FOOD_PRICE_TREND_INCREASE,
        "anchor_headcount": 4,
        "slope": 0.03,
        "min_factor": 0.85,
        "max_factor": 1.35,
    },
    {
        "category_key": "noodle",
        "category_name": "面食",
        "trend_mode": FOOD_PRICE_TREND_FLAT,
        "anchor_headcount": 2,
        "slope": 0.02,
        "min_factor": 0.9,
        "max_factor": 1.2,
    },
    {
        "category_key": "rice",
        "category_name": "米饭",
        "trend_mode": FOOD_PRICE_TREND_FLAT,
        "anchor_headcount": 2,
        "slope": 0.02,
        "min_factor": 0.9,
        "max_factor": 1.2,
    },
    {
        "category_key": "breakfast",
        "category_name": "早餐",
        "trend_mode": FOOD_PRICE_TREND_FLAT,
        "anchor_headcount": 2,
        "slope": 0.02,
        "min_factor": 0.85,
        "max_factor": 1.15,
    },
    {
        "category_key": "afternoon_tea",
        "category_name": "下午茶",
        "trend_mode": FOOD_PRICE_TREND_INCREASE,
        "anchor_headcount": 2,
        "slope": 0.03,
        "min_factor": 0.9,
        "max_factor": 1.3,
    },
    {
        "category_key": "drink",
        "category_name": "饮品",
        "trend_mode": FOOD_PRICE_TREND_INCREASE,
        "anchor_headcount": 2,
        "slope": 0.03,
        "min_factor": 0.9,
        "max_factor": 1.35,
    },
    {
        "category_key": "midnight_snack",
        "category_name": "夜宵",
        "trend_mode": FOOD_PRICE_TREND_INCREASE,
        "anchor_headcount": 3,
        "slope": 0.04,
        "min_factor": 0.88,
        "max_factor": 1.35,
    },
    {
        "category_key": "takeout",
        "category_name": "外卖",
        "trend_mode": FOOD_PRICE_TREND_FLAT,
        "anchor_headcount": 2,
        "slope": 0.03,
        "min_factor": 0.9,
        "max_factor": 1.25,
    },
]

FOOD_TIER_ID_ALIAS_MAP: Dict[str, List[str]] = {
    "daily_under_12": ["daily_under_8", "daily_8_12"],
}

FOOD_BRAND_NAME_MAP: Dict[str, str] = {
    "mixue": "蜜雪冰城",
    "chabaidao": "茶百道",
    "bawangchaji": "霸王茶姬",
    "heytea": "喜茶",
    "guming": "古茗",
    "luckin": "瑞幸咖啡",
    "cotti": "库迪咖啡",
    "starbucks": "星巴克",
}

DEFAULT_FOOD_ITEMS: List[Dict[str, Any]] = [
    {"food_key": "steamed_bun_pair", "name": "馒头（2个，红糖/原味）", "category_key": "rice", "daily_price_min": 1.5, "daily_price_max": 3, "party_price_min": 25, "party_price_max": 28, "distance_km": 0.2},
    {"food_key": "instant_noodle", "name": "泡面（桶装）", "category_key": "noodle", "daily_price_min": 5, "daily_price_max": 8, "party_price_min": 25, "party_price_max": 30, "distance_km": 0.3},
    {"food_key": "soy_milk_youtiao", "name": "豆浆油条", "category_key": "breakfast", "daily_price_min": 6, "daily_price_max": 9, "party_price_min": 25, "party_price_max": 28, "distance_km": 0.4},
    {"food_key": "egg_pancake", "name": "鸡蛋饼", "category_key": "breakfast", "daily_price_min": 5, "daily_price_max": 8, "party_price_min": 25, "party_price_max": 28, "distance_km": 0.5},
    {"food_key": "coffee_americano", "name": "美式咖啡", "category_key": "drink", "daily_price_min": 12, "daily_price_max": 16, "party_price_min": 28, "party_price_max": 35, "distance_km": 0.8},
    {"food_key": "fruit_tea", "name": "鲜果茶", "category_key": "drink", "daily_price_min": 10, "daily_price_max": 14, "party_price_min": 27, "party_price_max": 34, "distance_km": 0.8},
    {"food_key": "milk_tea_snack", "name": "奶茶+小蛋糕", "category_key": "afternoon_tea", "daily_price_min": 14, "daily_price_max": 18, "party_price_min": 32, "party_price_max": 40, "distance_km": 1.0},
    {"food_key": "fried_skewer_combo", "name": "炸串拼单", "category_key": "midnight_snack", "daily_price_min": 12, "daily_price_max": 18, "party_price_min": 32, "party_price_max": 42, "distance_km": 1.6},
    {"food_key": "guandongzhu", "name": "关东煮", "category_key": "midnight_snack", "daily_price_min": 9, "daily_price_max": 14, "party_price_min": 28, "party_price_max": 36, "distance_km": 1.4},
    {"food_key": "takeout_bento", "name": "外卖便当", "category_key": "takeout", "daily_price_min": 16, "daily_price_max": 22, "party_price_min": 35, "party_price_max": 45, "distance_km": 2.2},
    {"food_key": "takeout_stewed_chicken", "name": "黄焖鸡外卖", "category_key": "takeout", "daily_price_min": 15, "daily_price_max": 20, "party_price_min": 34, "party_price_max": 44, "distance_km": 2.0},
    {"food_key": "fried_rice", "name": "蛋炒饭", "category_key": "rice", "daily_price_min": 10, "daily_price_max": 12, "party_price_min": 25, "party_price_max": 30, "distance_km": 0.7},
    {"food_key": "rice_noodle", "name": "炒米粉", "category_key": "rice", "daily_price_min": 11, "daily_price_max": 13, "party_price_min": 26, "party_price_max": 31, "distance_km": 0.8},
    {"food_key": "wonton", "name": "馄饨", "category_key": "noodle", "daily_price_min": 9, "daily_price_max": 11, "party_price_min": 25, "party_price_max": 28, "distance_km": 1.0},
    {"food_key": "beef_noodle", "name": "牛肉面", "category_key": "noodle", "daily_price_min": 13, "daily_price_max": 15, "party_price_min": 30, "party_price_max": 36, "distance_km": 1.2},
    {"food_key": "maocai_single", "name": "冒菜（单人）", "category_key": "maocai", "daily_price_min": 14, "daily_price_max": 17, "party_price_min": 33, "party_price_max": 40, "distance_km": 1.5},
    {"food_key": "spicy_hotpot", "name": "麻辣香锅", "category_key": "maocai", "daily_price_min": 16, "daily_price_max": 19, "party_price_min": 38, "party_price_max": 46, "distance_km": 1.6},
    {"food_key": "sichuan_stir_fry", "name": "川湘小炒", "category_key": "stir_fry", "daily_price_min": 15, "daily_price_max": 18, "party_price_min": 35, "party_price_max": 44, "distance_km": 1.7},
    {"food_key": "home_stir_fry", "name": "家常炒菜", "category_key": "stir_fry", "daily_price_min": 13, "daily_price_max": 17, "party_price_min": 34, "party_price_max": 42, "distance_km": 2.1},
    {"food_key": "casserole_rice", "name": "煲仔饭", "category_key": "rice", "daily_price_min": 12, "daily_price_max": 15, "party_price_min": 32, "party_price_max": 38, "distance_km": 2.0},
    {"food_key": "burger_combo", "name": "汉堡套餐", "category_key": "rice", "daily_price_min": 18, "daily_price_max": 22, "party_price_min": 40, "party_price_max": 48, "distance_km": 2.3},
    {"food_key": "bbq_buffet", "name": "烧烤自助", "category_key": "grill", "daily_price_min": 20, "daily_price_max": 24, "party_price_min": 45, "party_price_max": 60, "distance_km": 2.8},
    {"food_key": "korean_bbq", "name": "韩式烤肉", "category_key": "grill", "daily_price_min": 21, "daily_price_max": 25, "party_price_min": 48, "party_price_max": 62, "distance_km": 3.0},
    {"food_key": "fish_hotpot", "name": "酸菜鱼火锅", "category_key": "hotpot", "daily_price_min": 19, "daily_price_max": 24, "party_price_min": 46, "party_price_max": 62, "distance_km": 3.1},
    {"food_key": "beef_hotpot", "name": "牛肉火锅", "category_key": "hotpot", "daily_price_min": 20, "daily_price_max": 26, "party_price_min": 52, "party_price_max": 68, "distance_km": 3.4},
    {"food_key": "seafood_hotpot", "name": "海鲜火锅", "category_key": "hotpot", "daily_price_min": 24, "daily_price_max": 30, "party_price_min": 58, "party_price_max": 78, "distance_km": 3.8},
    {"food_key": "mao_daxian", "name": "冒大仙", "category_key": "maocai", "daily_price_min": 16, "daily_price_max": 16, "party_price_min": 16, "party_price_max": 16, "distance_km": 0.3},
    {"food_key": "yuzhou_ganguo", "name": "禹洲坩埚", "category_key": "stir_fry", "daily_price_min": 20, "daily_price_max": 20, "party_price_min": 20, "party_price_max": 20, "distance_km": 1.2},
    {
        "food_key": "axiangpo",
        "name": "阿香婆",
        "category_key": "maocai",
        "daily_price_min": 10,
        "daily_price_max": 10,
        "party_price_min": 10,
        "party_price_max": 10,
        "distance_km": 1.0,
        "note": "历史说明：以前是炸串烧烤，当前按麻辣烫归类（类似刘文祥）。",
    },
    {"food_key": "dongbei_malatang", "name": "东北麻辣烫", "category_key": "maocai", "daily_price_min": 20, "daily_price_max": 20, "party_price_min": 20, "party_price_max": 20, "distance_km": 1.2},
    {"food_key": "waxiangji_purple", "name": "瓦香鸡（紫色招牌）", "category_key": "stir_fry", "daily_price_min": 18, "daily_price_max": 18, "party_price_min": 18, "party_price_max": 18, "distance_km": 1.2},
    {"food_key": "feichangji", "name": "肥肠鸡", "category_key": "hotpot", "daily_price_min": 30, "daily_price_max": 30, "party_price_min": 30, "party_price_max": 30, "distance_km": 1.3},
    {"food_key": "luosifen", "name": "螺狮粉", "category_key": "noodle", "daily_price_min": 15, "daily_price_max": 15, "party_price_min": 15, "party_price_max": 15, "distance_km": 1.2},
    {
        "food_key": "liuwenxiang",
        "name": "刘文祥",
        "category_key": "maocai",
        "daily_price_min": 20,
        "daily_price_max": 20,
        "party_price_min": 20,
        "party_price_max": 20,
        "distance_km": 1.2,
        "candidate_status": "pending_eat",
        "note": "待吃标记：当前按麻辣烫归类。",
    },
]

FOOD_CATEGORY_TOPUP_ITEMS: List[Dict[str, Any]] = [
    {"food_key": "breakfast_pork_bun_soymilk", "name": "肉包+豆浆", "category_key": "breakfast", "daily_price_min": 6, "daily_price_max": 10, "party_price_min": 25, "party_price_max": 28, "distance_km": 0.4},
    {"food_key": "breakfast_egg_burger", "name": "鸡蛋汉堡", "category_key": "breakfast", "daily_price_min": 5, "daily_price_max": 8, "party_price_min": 25, "party_price_max": 28, "distance_km": 0.5},
    {"food_key": "breakfast_scallion_pancake", "name": "手抓饼", "category_key": "breakfast", "daily_price_min": 6, "daily_price_max": 10, "party_price_min": 25, "party_price_max": 28, "distance_km": 0.5},
    {"food_key": "breakfast_congee_pickle", "name": "白粥+小菜", "category_key": "breakfast", "daily_price_min": 4, "daily_price_max": 7, "party_price_min": 24, "party_price_max": 28, "distance_km": 0.6},
    {"food_key": "breakfast_small_wonton", "name": "小馄饨早餐", "category_key": "breakfast", "daily_price_min": 7, "daily_price_max": 10, "party_price_min": 25, "party_price_max": 30, "distance_km": 0.7},
    {"food_key": "breakfast_rice_noodle_roll", "name": "肠粉", "category_key": "breakfast", "daily_price_min": 8, "daily_price_max": 12, "party_price_min": 26, "party_price_max": 31, "distance_km": 0.8},
    {"food_key": "breakfast_fried_dumpling", "name": "煎饺+豆浆", "category_key": "breakfast", "daily_price_min": 8, "daily_price_max": 12, "party_price_min": 26, "party_price_max": 31, "distance_km": 0.8},
    {"food_key": "breakfast_tuna_sandwich", "name": "吞拿鱼三明治", "category_key": "breakfast", "daily_price_min": 9, "daily_price_max": 13, "party_price_min": 28, "party_price_max": 34, "distance_km": 0.9},
    {"food_key": "afternoon_cookie_latte", "name": "曲奇+拿铁", "category_key": "afternoon_tea", "daily_price_min": 15, "daily_price_max": 20, "party_price_min": 33, "party_price_max": 42, "distance_km": 1.0},
    {"food_key": "afternoon_tiramisu_americano", "name": "提拉米苏+美式", "category_key": "afternoon_tea", "daily_price_min": 16, "daily_price_max": 22, "party_price_min": 34, "party_price_max": 43, "distance_km": 1.1},
    {"food_key": "afternoon_waffle_blacktea", "name": "华夫饼+红茶拿铁", "category_key": "afternoon_tea", "daily_price_min": 15, "daily_price_max": 21, "party_price_min": 34, "party_price_max": 42, "distance_km": 1.1},
    {"food_key": "afternoon_cheesecake_oolong", "name": "芝士蛋糕+乌龙茶", "category_key": "afternoon_tea", "daily_price_min": 16, "daily_price_max": 22, "party_price_min": 35, "party_price_max": 44, "distance_km": 1.1},
    {"food_key": "afternoon_egg_tart_milktea", "name": "蛋挞双拼+奶茶", "category_key": "afternoon_tea", "daily_price_min": 14, "daily_price_max": 20, "party_price_min": 33, "party_price_max": 42, "distance_km": 1.0},
    {"food_key": "afternoon_matcha_roll_tea", "name": "抹茶卷+茉莉奶绿", "category_key": "afternoon_tea", "daily_price_min": 15, "daily_price_max": 21, "party_price_min": 33, "party_price_max": 42, "distance_km": 1.1},
    {"food_key": "afternoon_puff_yogurt", "name": "泡芙+酸奶饮", "category_key": "afternoon_tea", "daily_price_min": 13, "daily_price_max": 18, "party_price_min": 30, "party_price_max": 40, "distance_km": 1.0},
    {"food_key": "afternoon_fruit_plate_tea", "name": "鲜果拼盘+冷萃茶", "category_key": "afternoon_tea", "daily_price_min": 17, "daily_price_max": 24, "party_price_min": 36, "party_price_max": 45, "distance_km": 1.2},
    {"food_key": "afternoon_pudding_coffee", "name": "布丁杯+拿铁", "category_key": "afternoon_tea", "daily_price_min": 16, "daily_price_max": 22, "party_price_min": 34, "party_price_max": 43, "distance_km": 1.1},
    {"food_key": "mixue_lemon_icecream_combo", "name": "冰鲜柠檬水+新鲜冰淇淋", "category_key": "drink", "brand_key": "mixue", "brand_name": "蜜雪冰城", "brand_combo": "冰鲜柠檬水+新鲜冰淇淋", "daily_price_min": 8, "daily_price_max": 12, "party_price_min": 25, "party_price_max": 30, "distance_km": 0.8},
    {"food_key": "mixue_orange_lemon_combo", "name": "棒打鲜橙+柠檬水", "category_key": "drink", "brand_key": "mixue", "brand_name": "蜜雪冰城", "brand_combo": "棒打鲜橙+柠檬水", "daily_price_min": 9, "daily_price_max": 13, "party_price_min": 26, "party_price_max": 31, "distance_km": 0.8},
    {"food_key": "chabaidao_yangzhi_combo", "name": "杨枝甘露+豆乳玉麒麟", "category_key": "drink", "brand_key": "chabaidao", "brand_name": "茶百道", "brand_combo": "杨枝甘露+豆乳玉麒麟", "daily_price_min": 14, "daily_price_max": 20, "party_price_min": 32, "party_price_max": 40, "distance_km": 1.0},
    {"food_key": "bawang_boya_combo", "name": "伯牙绝弦+桂馥兰香", "category_key": "drink", "brand_key": "bawangchaji", "brand_name": "霸王茶姬", "brand_combo": "伯牙绝弦+桂馥兰香", "daily_price_min": 16, "daily_price_max": 22, "party_price_min": 35, "party_price_max": 44, "distance_km": 1.1},
    {"food_key": "heytea_duorou_combo", "name": "多肉葡萄+芝芝莓莓", "category_key": "drink", "brand_key": "heytea", "brand_name": "喜茶", "brand_combo": "多肉葡萄+芝芝莓莓", "daily_price_min": 17, "daily_price_max": 24, "party_price_min": 36, "party_price_max": 46, "distance_km": 1.2},
    {"food_key": "guming_grape_combo", "name": "超A芝士葡萄+杨枝甘露", "category_key": "drink", "brand_key": "guming", "brand_name": "古茗", "brand_combo": "超A芝士葡萄+杨枝甘露", "daily_price_min": 15, "daily_price_max": 22, "party_price_min": 34, "party_price_max": 43, "distance_km": 1.1},
    {"food_key": "luckin_coconut_combo", "name": "生椰拿铁+厚乳拿铁", "category_key": "drink", "brand_key": "luckin", "brand_name": "瑞幸咖啡", "brand_combo": "生椰拿铁+厚乳拿铁", "daily_price_min": 18, "daily_price_max": 24, "party_price_min": 36, "party_price_max": 46, "distance_km": 1.0},
    {"food_key": "cotti_coconut_combo", "name": "生椰拿铁+经典拿铁", "category_key": "drink", "brand_key": "cotti", "brand_name": "库迪咖啡", "brand_combo": "生椰拿铁+经典拿铁", "daily_price_min": 16, "daily_price_max": 22, "party_price_min": 34, "party_price_max": 43, "distance_km": 1.0},
    {"food_key": "starbucks_white_combo", "name": "馥芮白+焦糖玛奇朵", "category_key": "drink", "brand_key": "starbucks", "brand_name": "星巴克", "brand_combo": "馥芮白+焦糖玛奇朵", "daily_price_min": 24, "daily_price_max": 34, "party_price_min": 45, "party_price_max": 60, "distance_km": 1.8},
    {"food_key": "mixue_pearl_combo", "name": "珍珠奶茶+冰鲜柠檬水", "category_key": "drink", "brand_key": "mixue", "brand_name": "蜜雪冰城", "brand_combo": "珍珠奶茶+冰鲜柠檬水", "daily_price_min": 8, "daily_price_max": 13, "party_price_min": 25, "party_price_max": 31, "distance_km": 0.8},
    {"food_key": "chabaidao_taro_combo", "name": "招牌芋圆奶茶+黄金椰椰乌龙", "category_key": "drink", "brand_key": "chabaidao", "brand_name": "茶百道", "brand_combo": "招牌芋圆奶茶+黄金椰椰乌龙", "daily_price_min": 15, "daily_price_max": 22, "party_price_min": 33, "party_price_max": 42, "distance_km": 1.0},
    {"food_key": "bawang_wanli_combo", "name": "伯牙绝弦+万里木兰", "category_key": "drink", "brand_key": "bawangchaji", "brand_name": "霸王茶姬", "brand_combo": "伯牙绝弦+万里木兰", "daily_price_min": 17, "daily_price_max": 24, "party_price_min": 36, "party_price_max": 45, "distance_km": 1.1},
    {"food_key": "heytea_boba_combo", "name": "多肉葡萄+烤黑糖波波牛乳", "category_key": "drink", "brand_key": "heytea", "brand_name": "喜茶", "brand_combo": "多肉葡萄+烤黑糖波波牛乳", "daily_price_min": 18, "daily_price_max": 25, "party_price_min": 37, "party_price_max": 47, "distance_km": 1.2},
    {"food_key": "guming_yangmei_combo", "name": "超A芝士葡萄+芝士杨梅", "category_key": "drink", "brand_key": "guming", "brand_name": "古茗", "brand_combo": "超A芝士葡萄+芝士杨梅", "daily_price_min": 16, "daily_price_max": 23, "party_price_min": 35, "party_price_max": 44, "distance_km": 1.1},
    {"food_key": "luckin_maotai_combo", "name": "生椰拿铁+酱香拿铁", "category_key": "drink", "brand_key": "luckin", "brand_name": "瑞幸咖啡", "brand_combo": "生椰拿铁+酱香拿铁", "daily_price_min": 19, "daily_price_max": 26, "party_price_min": 38, "party_price_max": 48, "distance_km": 1.0},
    {"food_key": "cotti_blue_combo", "name": "潘帕斯蓝椰拿铁+生椰拿铁", "category_key": "drink", "brand_key": "cotti", "brand_name": "库迪咖啡", "brand_combo": "潘帕斯蓝椰拿铁+生椰拿铁", "daily_price_min": 17, "daily_price_max": 24, "party_price_min": 35, "party_price_max": 44, "distance_km": 1.0},
    {"food_key": "starbucks_latte_combo", "name": "馥芮白+拿铁", "category_key": "drink", "brand_key": "starbucks", "brand_name": "星巴克", "brand_combo": "馥芮白+拿铁", "daily_price_min": 23, "daily_price_max": 33, "party_price_min": 44, "party_price_max": 58, "distance_km": 1.8},
    {"food_key": "grill_lamb_skewer_set", "name": "羊肉串套餐", "category_key": "grill", "daily_price_min": 18, "daily_price_max": 25, "party_price_min": 42, "party_price_max": 55, "distance_km": 2.0},
    {"food_key": "grill_chicken_skin_skewer", "name": "鸡皮串拼", "category_key": "grill", "daily_price_min": 16, "daily_price_max": 22, "party_price_min": 38, "party_price_max": 50, "distance_km": 2.0},
    {"food_key": "grill_beef_skewer_set", "name": "牛肉串拼盘", "category_key": "grill", "daily_price_min": 20, "daily_price_max": 28, "party_price_min": 45, "party_price_max": 58, "distance_km": 2.2},
    {"food_key": "grill_chicken_wing_set", "name": "烤鸡翅套餐", "category_key": "grill", "daily_price_min": 18, "daily_price_max": 24, "party_price_min": 40, "party_price_max": 54, "distance_km": 2.1},
    {"food_key": "grill_corn_potato_set", "name": "烤玉米土豆片", "category_key": "grill", "daily_price_min": 14, "daily_price_max": 20, "party_price_min": 35, "party_price_max": 48, "distance_km": 1.9},
    {"food_key": "grill_five_flavor_set", "name": "五花肉烤串", "category_key": "grill", "daily_price_min": 18, "daily_price_max": 25, "party_price_min": 42, "party_price_max": 56, "distance_km": 2.2},
    {"food_key": "grill_squid_set", "name": "铁板鱿鱼", "category_key": "grill", "daily_price_min": 19, "daily_price_max": 26, "party_price_min": 43, "party_price_max": 57, "distance_km": 2.3},
    {"food_key": "grill_veggie_set", "name": "烤蔬菜拼盘", "category_key": "grill", "daily_price_min": 15, "daily_price_max": 21, "party_price_min": 36, "party_price_max": 49, "distance_km": 2.0},
    {"food_key": "hotpot_spicy_beef", "name": "麻辣牛肉火锅", "category_key": "hotpot", "daily_price_min": 24, "daily_price_max": 30, "party_price_min": 56, "party_price_max": 72, "distance_km": 3.0},
    {"food_key": "hotpot_tomato_beef", "name": "番茄牛腩锅", "category_key": "hotpot", "daily_price_min": 22, "daily_price_max": 28, "party_price_min": 52, "party_price_max": 68, "distance_km": 3.1},
    {"food_key": "hotpot_mushroom_chicken", "name": "菌汤鸡火锅", "category_key": "hotpot", "daily_price_min": 20, "daily_price_max": 26, "party_price_min": 49, "party_price_max": 64, "distance_km": 2.9},
    {"food_key": "hotpot_pork_belly", "name": "猪肚鸡锅", "category_key": "hotpot", "daily_price_min": 23, "daily_price_max": 29, "party_price_min": 54, "party_price_max": 70, "distance_km": 3.1},
    {"food_key": "hotpot_veggie_combo", "name": "素食养生锅", "category_key": "hotpot", "daily_price_min": 18, "daily_price_max": 24, "party_price_min": 45, "party_price_max": 60, "distance_km": 2.7},
    {"food_key": "hotpot_duck_blood", "name": "鸭血毛肚锅", "category_key": "hotpot", "daily_price_min": 21, "daily_price_max": 27, "party_price_min": 50, "party_price_max": 66, "distance_km": 3.0},
    {"food_key": "maocai_spicy_beef_bowl", "name": "肥牛冒菜", "category_key": "maocai", "daily_price_min": 16, "daily_price_max": 22, "party_price_min": 36, "party_price_max": 46, "distance_km": 1.4},
    {"food_key": "maocai_veggie_bowl", "name": "素菜冒菜", "category_key": "maocai", "daily_price_min": 12, "daily_price_max": 17, "party_price_min": 30, "party_price_max": 40, "distance_km": 1.3},
    {"food_key": "maocai_fat_intestine_bowl", "name": "肥肠冒菜", "category_key": "maocai", "daily_price_min": 17, "daily_price_max": 23, "party_price_min": 37, "party_price_max": 47, "distance_km": 1.5},
    {"food_key": "maocai_luncheon_meat_bowl", "name": "午餐肉冒菜", "category_key": "maocai", "daily_price_min": 15, "daily_price_max": 20, "party_price_min": 34, "party_price_max": 44, "distance_km": 1.4},
    {"food_key": "midnight_fried_noodle", "name": "夜宵炒面", "category_key": "midnight_snack", "daily_price_min": 10, "daily_price_max": 14, "party_price_min": 28, "party_price_max": 35, "distance_km": 1.2},
    {"food_key": "midnight_sticky_rice_roll", "name": "糯米饭团", "category_key": "midnight_snack", "daily_price_min": 8, "daily_price_max": 12, "party_price_min": 26, "party_price_max": 33, "distance_km": 1.1},
    {"food_key": "midnight_egg_fried_rice", "name": "夜宵蛋炒饭", "category_key": "midnight_snack", "daily_price_min": 11, "daily_price_max": 15, "party_price_min": 28, "party_price_max": 36, "distance_km": 1.2},
    {"food_key": "midnight_hot_dry_noodle", "name": "热干面", "category_key": "midnight_snack", "daily_price_min": 9, "daily_price_max": 13, "party_price_min": 26, "party_price_max": 33, "distance_km": 1.2},
    {"food_key": "midnight_spicy_rice_noodle", "name": "酸辣粉", "category_key": "midnight_snack", "daily_price_min": 10, "daily_price_max": 14, "party_price_min": 27, "party_price_max": 34, "distance_km": 1.3},
    {"food_key": "midnight_braised_noodle", "name": "卤肉拌面", "category_key": "midnight_snack", "daily_price_min": 12, "daily_price_max": 16, "party_price_min": 30, "party_price_max": 38, "distance_km": 1.4},
    {"food_key": "midnight_pan_fried_bun", "name": "生煎包", "category_key": "midnight_snack", "daily_price_min": 8, "daily_price_max": 12, "party_price_min": 26, "party_price_max": 33, "distance_km": 1.1},
    {"food_key": "midnight_bbq_noodle", "name": "烤冷面", "category_key": "midnight_snack", "daily_price_min": 9, "daily_price_max": 13, "party_price_min": 27, "party_price_max": 34, "distance_km": 1.2},
    {"food_key": "noodle_tomato_egg", "name": "番茄鸡蛋面", "category_key": "noodle", "daily_price_min": 11, "daily_price_max": 14, "party_price_min": 28, "party_price_max": 35, "distance_km": 1.1},
    {"food_key": "noodle_knife_cut", "name": "刀削面", "category_key": "noodle", "daily_price_min": 12, "daily_price_max": 16, "party_price_min": 30, "party_price_max": 38, "distance_km": 1.2},
    {"food_key": "noodle_chongqing", "name": "重庆小面", "category_key": "noodle", "daily_price_min": 10, "daily_price_max": 14, "party_price_min": 27, "party_price_max": 34, "distance_km": 1.1},
    {"food_key": "noodle_cold_noodle", "name": "凉面", "category_key": "noodle", "daily_price_min": 9, "daily_price_max": 12, "party_price_min": 26, "party_price_max": 32, "distance_km": 1.0},
    {"food_key": "noodle_mixed_sauce", "name": "炸酱面", "category_key": "noodle", "daily_price_min": 11, "daily_price_max": 15, "party_price_min": 29, "party_price_max": 36, "distance_km": 1.2},
    {"food_key": "noodle_ramen_pork", "name": "豚骨拉面", "category_key": "noodle", "daily_price_min": 16, "daily_price_max": 22, "party_price_min": 35, "party_price_max": 45, "distance_km": 1.6},
    {"food_key": "rice_tomato_beef_brisket", "name": "番茄牛腩盖饭", "category_key": "rice", "daily_price_min": 14, "daily_price_max": 19, "party_price_min": 34, "party_price_max": 42, "distance_km": 1.4},
    {"food_key": "rice_black_pepper_beef", "name": "黑椒牛柳饭", "category_key": "rice", "daily_price_min": 15, "daily_price_max": 20, "party_price_min": 35, "party_price_max": 44, "distance_km": 1.5},
    {"food_key": "rice_roast_pork", "name": "叉烧饭", "category_key": "rice", "daily_price_min": 13, "daily_price_max": 18, "party_price_min": 33, "party_price_max": 41, "distance_km": 1.4},
    {"food_key": "rice_chicken_chop", "name": "鸡排饭", "category_key": "rice", "daily_price_min": 12, "daily_price_max": 17, "party_price_min": 31, "party_price_max": 39, "distance_km": 1.3},
    {"food_key": "rice_fried_chicken_steak", "name": "照烧鸡腿饭", "category_key": "rice", "daily_price_min": 13, "daily_price_max": 18, "party_price_min": 32, "party_price_max": 40, "distance_km": 1.4},
    {"food_key": "stir_fry_pepper_beef", "name": "青椒牛肉小炒", "category_key": "stir_fry", "daily_price_min": 16, "daily_price_max": 22, "party_price_min": 36, "party_price_max": 46, "distance_km": 1.7},
    {"food_key": "stir_fry_tomato_egg", "name": "番茄炒蛋套餐", "category_key": "stir_fry", "daily_price_min": 12, "daily_price_max": 16, "party_price_min": 31, "party_price_max": 39, "distance_km": 1.5},
    {"food_key": "stir_fry_kungpao_chicken", "name": "宫保鸡丁套餐", "category_key": "stir_fry", "daily_price_min": 14, "daily_price_max": 19, "party_price_min": 33, "party_price_max": 42, "distance_km": 1.6},
    {"food_key": "stir_fry_mapo_tofu", "name": "麻婆豆腐盖饭", "category_key": "stir_fry", "daily_price_min": 11, "daily_price_max": 15, "party_price_min": 30, "party_price_max": 38, "distance_km": 1.4},
    {"food_key": "stir_fry_shredded_pork", "name": "鱼香肉丝套餐", "category_key": "stir_fry", "daily_price_min": 14, "daily_price_max": 19, "party_price_min": 33, "party_price_max": 42, "distance_km": 1.6},
    {"food_key": "stir_fry_dry_pot_cauliflower", "name": "干锅花菜", "category_key": "stir_fry", "daily_price_min": 13, "daily_price_max": 18, "party_price_min": 32, "party_price_max": 40, "distance_km": 1.6},
    {"food_key": "takeout_sushi_set", "name": "外卖寿司拼盘", "category_key": "takeout", "daily_price_min": 18, "daily_price_max": 25, "party_price_min": 38, "party_price_max": 48, "distance_km": 2.3},
    {"food_key": "takeout_salad_chicken", "name": "轻食鸡胸沙拉", "category_key": "takeout", "daily_price_min": 16, "daily_price_max": 22, "party_price_min": 35, "party_price_max": 44, "distance_km": 2.0},
    {"food_key": "takeout_mala_xiangguo", "name": "外卖麻辣香锅", "category_key": "takeout", "daily_price_min": 18, "daily_price_max": 24, "party_price_min": 37, "party_price_max": 47, "distance_km": 2.1},
    {"food_key": "takeout_rice_ball", "name": "日式饭团便当", "category_key": "takeout", "daily_price_min": 14, "daily_price_max": 20, "party_price_min": 33, "party_price_max": 42, "distance_km": 2.0},
    {"food_key": "takeout_pasta_combo", "name": "意面套餐外卖", "category_key": "takeout", "daily_price_min": 19, "daily_price_max": 25, "party_price_min": 40, "party_price_max": 50, "distance_km": 2.4},
    {"food_key": "takeout_steamed_rice_set", "name": "双拼便当", "category_key": "takeout", "daily_price_min": 15, "daily_price_max": 21, "party_price_min": 34, "party_price_max": 43, "distance_km": 2.1},
    {"food_key": "takeout_dumpling_set", "name": "饺子套餐外卖", "category_key": "takeout", "daily_price_min": 13, "daily_price_max": 18, "party_price_min": 32, "party_price_max": 40, "distance_km": 2.0},
    {"food_key": "takeout_korean_rice", "name": "韩式拌饭外卖", "category_key": "takeout", "daily_price_min": 17, "daily_price_max": 23, "party_price_min": 36, "party_price_max": 46, "distance_km": 2.2},
]


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


class SocialCreateFoodCampaignRequest(BaseModel):
    template_key: str = Field(..., min_length=1)
    selected_tier_ids: List[str] = Field(..., min_length=3, max_length=4)
    max_votes_per_user: int = Field(..., ge=FOOD_CAMPAIGN_MIN_VOTE_LIMIT, le=FOOD_CAMPAIGN_MAX_VOTE_LIMIT)
    deadline_at: str = Field(..., min_length=1)
    invitee_student_ids: Optional[List[str]] = None
    category_keys: Optional[List[str]] = None
    brand_keys: Optional[List[str]] = None
    title: Optional[str] = None
    join_mode: Optional[str] = None
    join_password: Optional[str] = None
    is_anonymous: Optional[bool] = None


class SocialJoinFoodCampaignRequest(BaseModel):
    share_token: str = Field(..., min_length=1)
    access_password: Optional[str] = None


class SocialFoodCampaignVoteRequest(BaseModel):
    selected_food_ids: List[int] = Field(..., min_length=1)


class SocialToggleFoodItemActiveRequest(BaseModel):
    enabled: bool


class SocialCreateFoodCandidateRequest(BaseModel):
    name: str = Field(..., min_length=1)
    category_key: str = Field(..., min_length=1)
    brand_key: Optional[str] = None
    brand_name: Optional[str] = None
    brand_combo: Optional[str] = None
    daily_price_min: float = Field(..., ge=0)
    daily_price_max: float = Field(..., ge=0)
    party_price_min: float = Field(..., ge=0)
    party_price_max: float = Field(..., ge=0)
    distance_km: float = Field(..., ge=0)
    note: Optional[str] = None


class AdminSaveFoodItemRequest(BaseModel):
    food_key: str = Field(..., min_length=1)
    name: str = Field(..., min_length=1)
    category_key: str = Field(..., min_length=1)
    brand_key: Optional[str] = None
    brand_name: Optional[str] = None
    brand_combo: Optional[str] = None
    daily_price_min: float = Field(..., ge=0)
    daily_price_max: float = Field(..., ge=0)
    party_price_min: float = Field(..., ge=0)
    party_price_max: float = Field(..., ge=0)
    distance_km: float = Field(..., ge=0)
    enabled: Optional[bool] = None
    candidate_status: Optional[str] = None
    note: Optional[str] = None
    strategy_override_json: Optional[Dict[str, Any]] = None


class AdminUpdateFoodItemRequest(BaseModel):
    name: str = Field(..., min_length=1)
    category_key: str = Field(..., min_length=1)
    brand_key: Optional[str] = None
    brand_name: Optional[str] = None
    brand_combo: Optional[str] = None
    daily_price_min: float = Field(..., ge=0)
    daily_price_max: float = Field(..., ge=0)
    party_price_min: float = Field(..., ge=0)
    party_price_max: float = Field(..., ge=0)
    distance_km: float = Field(..., ge=0)
    enabled: Optional[bool] = None
    candidate_status: Optional[str] = None
    note: Optional[str] = None
    strategy_override_json: Optional[Dict[str, Any]] = None


class AdminReviewFoodItemRequest(BaseModel):
    candidate_status: str = Field(..., min_length=1)
    enabled: Optional[bool] = None


class AdminSaveFoodCategoryRuleItemRequest(BaseModel):
    category_key: str = Field(..., min_length=1)
    category_name: str = Field(..., min_length=1)
    trend_mode: str = Field(..., min_length=1)
    anchor_headcount: int = Field(..., ge=1, le=200)
    slope: float = Field(..., ge=0, le=1)
    min_factor: float = Field(..., ge=0.1, le=5)
    max_factor: float = Field(..., ge=0.1, le=5)


class AdminSaveFoodCategoryRulesRequest(BaseModel):
    items: List[AdminSaveFoodCategoryRuleItemRequest] = Field(..., min_length=1)


class AdminSaveClassRequest(BaseModel):
    class_id: Optional[str] = None
    class_label: str = Field(..., min_length=1)
    active: Optional[bool] = None


class SocialSubscribeClassByCodeRequest(BaseModel):
    class_code: str = Field(..., min_length=1)


class SocialUnsubscribeClassRequest(BaseModel):
    class_id: str = Field(..., min_length=1)


class AdminFoodPricingPreviewRequest(BaseModel):
    template_key: str = Field(..., min_length=1)
    category_key: Optional[str] = None
    food_key: Optional[str] = None
    base_price_min: Optional[float] = None
    base_price_max: Optional[float] = None
    headcount_start: Optional[int] = Field(default=1, ge=1, le=200)
    headcount_end: Optional[int] = Field(default=50, ge=1, le=200)
    headcount_step: Optional[int] = Field(default=1, ge=1, le=20)
    strategy_override_json: Optional[Dict[str, Any]] = None


class AdminFoodPricingRollbackRequest(BaseModel):
    version_id: str = Field(..., min_length=1)


class AdminMediaCleanupRequest(BaseModel):
    max_age_hours: Optional[int] = Field(default=24 * 7, ge=1, le=24 * 365)
    dry_run: Optional[bool] = True


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
    if path == "/admin-legacy" or path.startswith("/admin-legacy/"):
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
    if path == "/admin" or path.startswith("/admin/") or path == "/admin-legacy" or path.startswith("/admin-legacy/"):
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


def resolve_student_id_for_bind_target(target: str) -> Optional[str]:
    normalized_target = str(target or "").strip()
    if not normalized_target:
        return None
    by_name = resolve_student_id_by_name(normalized_target)
    if by_name:
        return by_name
    return resolve_student_id_by_student_no(normalized_target)


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


def build_media_asset_mime_type(extension: str) -> str:
    normalized_extension = str(extension or "").strip().lower()
    return {
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "png": "image/png",
        "gif": "image/gif",
        "webp": "image/webp",
    }.get(normalized_extension, "application/octet-stream")


def build_media_relative_url(file_name: str) -> str:
    return f"{MEDIA_BASE_PATH}/{file_name}"


def extract_media_file_name_from_url(media_url: Optional[str]) -> str:
    normalized = normalize_media_url(media_url, max_length=500)
    if not normalized:
        return ""
    path = normalized
    if normalized.startswith("http://") or normalized.startswith("https://"):
        parsed = urllib.parse.urlparse(normalized)
        path = str(parsed.path or "").strip()
    prefix = f"{MEDIA_BASE_PATH}/"
    if not path.startswith(prefix):
        return ""
    file_name = Path(path).name
    if not re.fullmatch(r"[A-Za-z0-9._-]{6,120}", file_name):
        return ""
    return file_name


def upsert_media_asset_for_url(
    conn: sqlite3.Connection,
    media_url: Optional[str],
    usage: str,
    owner_scope: str = "system",
    owner_student_id: str = "",
    referenced: bool = False,
) -> Optional[Dict[str, Any]]:
    file_name = extract_media_file_name_from_url(media_url)
    if not file_name:
        return None
    file_path = MEDIA_STORAGE_DIR / file_name
    if not file_path.exists() or not file_path.is_file():
        return None
    extension = file_path.suffix.lower().lstrip(".")
    if extension not in ALLOWED_IMAGE_TYPES:
        return None
    now_ts = int(time.time())
    media_path = normalize_media_url(media_url, max_length=500) or build_media_relative_url(file_name)
    normalized_usage = trim_profile_text(usage, max_length=60) or "unknown"
    normalized_owner_scope = trim_profile_text(owner_scope, max_length=40) or "system"
    normalized_owner_student_id = normalize_student_id(owner_student_id) if owner_student_id else ""
    conn.execute(
        """
        INSERT INTO media_assets
        (file_name, usage, owner_scope, owner_student_id, media_url, mime_type, extension, size_bytes, is_referenced, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_name) DO UPDATE SET
          usage=excluded.usage,
          owner_scope=excluded.owner_scope,
          owner_student_id=CASE
            WHEN TRIM(COALESCE(excluded.owner_student_id, ''))<>'' THEN excluded.owner_student_id
            ELSE media_assets.owner_student_id
          END,
          media_url=excluded.media_url,
          mime_type=excluded.mime_type,
          extension=excluded.extension,
          size_bytes=excluded.size_bytes,
          is_referenced=excluded.is_referenced,
          updated_at=excluded.updated_at
        """,
        (
            file_name,
            normalized_usage,
            normalized_owner_scope,
            normalized_owner_student_id,
            media_path,
            build_media_asset_mime_type(extension),
            extension,
            int(file_path.stat().st_size),
            1 if referenced else 0,
            now_ts,
            now_ts,
        ),
    )
    return {
        "file_name": file_name,
        "usage": normalized_usage,
        "owner_scope": normalized_owner_scope,
        "owner_student_id": normalized_owner_student_id,
        "media_url": media_path,
        "is_referenced": bool(referenced),
        "updated_at": now_ts,
    }


def collect_referenced_media_file_names(conn: sqlite3.Connection) -> set[str]:
    file_names: set[str] = set()
    profile_rows = conn.execute(
        """
        SELECT avatar_url, wallpaper_url
        FROM user_profiles
        """
    ).fetchall()
    for row in profile_rows:
        for key in ("avatar_url", "wallpaper_url"):
            file_name = extract_media_file_name_from_url(row[key] if key in row.keys() else "")
            if file_name:
                file_names.add(file_name)

    theme_row = conn.execute(
        """
        SELECT value
        FROM app_settings
        WHERE key='theme_image_map'
        LIMIT 1
        """
    ).fetchone()
    theme_map = parse_theme_image_map(theme_row["value"]) if theme_row else {}
    for image_url in theme_map.values():
        file_name = extract_media_file_name_from_url(image_url)
        if file_name:
            file_names.add(file_name)
    return file_names


def reconcile_media_asset_references(conn: sqlite3.Connection) -> Dict[str, Any]:
    referenced_names = collect_referenced_media_file_names(conn)
    now_ts = int(time.time())
    conn.execute(
        """
        UPDATE media_assets
        SET is_referenced=0, updated_at=?
        """,
        (now_ts,),
    )
    marked_count = 0
    if referenced_names:
        placeholders = ",".join("?" for _ in referenced_names)
        params: List[Any] = [now_ts, *sorted(referenced_names)]
        result = conn.execute(
            f"""
            UPDATE media_assets
            SET is_referenced=1, updated_at=?
            WHERE file_name IN ({placeholders})
            """,
            tuple(params),
        )
        marked_count = int(result.rowcount or 0)
    return {
        "referencedCount": len(referenced_names),
        "markedCount": marked_count,
        "referencedFileNames": sorted(referenced_names),
    }


def scan_storage_media_assets(conn: sqlite3.Connection) -> Dict[str, int]:
    inserted = 0
    updated = 0
    now_ts = int(time.time())
    pattern = re.compile(r"[A-Za-z0-9._-]{6,120}")
    for file_path in MEDIA_STORAGE_DIR.iterdir():
        if not file_path.is_file():
            continue
        file_name = file_path.name
        if not pattern.fullmatch(file_name):
            continue
        extension = file_path.suffix.lower().lstrip(".")
        if extension not in ALLOWED_IMAGE_TYPES:
            continue
        size_bytes = int(file_path.stat().st_size)
        existing = conn.execute(
            "SELECT id FROM media_assets WHERE file_name=? LIMIT 1",
            (file_name,),
        ).fetchone()
        if existing:
            conn.execute(
                """
                UPDATE media_assets
                SET media_url=?, mime_type=?, extension=?, size_bytes=?, updated_at=?
                WHERE file_name=?
                """,
                (
                    build_media_relative_url(file_name),
                    build_media_asset_mime_type(extension),
                    extension,
                    size_bytes,
                    now_ts,
                    file_name,
                ),
            )
            updated += 1
            continue
        conn.execute(
            """
            INSERT INTO media_assets
            (file_name, usage, owner_scope, owner_student_id, media_url, mime_type, extension, size_bytes, is_referenced, created_at, updated_at)
            VALUES (?, 'unknown', 'system', '', ?, ?, ?, ?, 0, ?, ?)
            """,
            (
                file_name,
                build_media_relative_url(file_name),
                build_media_asset_mime_type(extension),
                extension,
                size_bytes,
                now_ts,
                now_ts,
            ),
        )
        inserted += 1
    return {"inserted": inserted, "updated": updated}


def save_uploaded_image(
    request: Request,
    upload: UploadFile,
    usage: str,
    max_bytes: int,
    owner_student_id: str = "",
    owner_scope: str = "system",
) -> str:
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
    media_url = build_absolute_url(request, build_media_relative_url(file_name))
    with db_connection() as conn:
        upsert_media_asset_for_url(
            conn=conn,
            media_url=media_url,
            usage=usage,
            owner_scope=owner_scope,
            owner_student_id=owner_student_id,
            referenced=False,
        )
    return media_url


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
    with db_connection() as conn:
        current_images = result.get("images", {})
        if isinstance(current_images, dict):
            for current_theme_key, current_image_url in current_images.items():
                theme_image_url = normalize_theme_image_url(str(current_image_url or ""))
                if not theme_image_url:
                    continue
                upsert_media_asset_for_url(
                    conn=conn,
                    media_url=theme_image_url,
                    usage=f"theme-{normalize_theme_key(str(current_theme_key))}",
                    owner_scope="theme",
                    owner_student_id="",
                    referenced=True,
                )
        reconcile_media_asset_references(conn)
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


def parse_json_array(raw: Any) -> List[Any]:
    if isinstance(raw, list):
        return list(raw)
    text = str(raw or "").strip()
    if not text:
        return []
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return []
    if isinstance(parsed, list):
        return list(parsed)
    return []


def parse_json_object(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, dict):
        return dict(raw)
    text = str(raw or "").strip()
    if not text:
        return {}
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return {}
    if isinstance(parsed, dict):
        return dict(parsed)
    return {}


def normalize_food_template_key(value: Any) -> str:
    normalized = str(value or "").strip().lower()
    if normalized not in FOOD_TEMPLATE_KEYS:
        raise HTTPException(status_code=400, detail="template_key 仅支持 daily 或 party")
    return normalized


def get_food_template_tiers(template_key: str) -> List[Dict[str, Any]]:
    normalized = normalize_food_template_key(template_key)
    return FOOD_PRICE_TEMPLATE_TIERS.get(normalized, [])


def get_food_template_tier_ids(template_key: str) -> List[str]:
    return [str(item.get("id", "")).strip() for item in get_food_template_tiers(template_key) if str(item.get("id", "")).strip()]


def normalize_food_brand_key(value: Any) -> str:
    normalized = trim_profile_text(value, max_length=40).lower().replace(" ", "_")
    normalized = re.sub(r"[^a-z0-9_-]+", "", normalized)
    return normalized


def normalize_food_filter_keys(raw_keys: Optional[List[str]], max_items: int = 12, max_length: int = 40) -> List[str]:
    result: List[str] = []
    for item in raw_keys or []:
        key = trim_profile_text(item, max_length=max_length).lower()
        if not key or key in result:
            continue
        result.append(key)
        if len(result) >= max_items:
            break
    return result


def normalize_selected_tier_ids(template_key: str, raw_tier_ids: List[str]) -> List[str]:
    allowed_ids = set(get_food_template_tier_ids(template_key))
    values: List[str] = []
    for item in raw_tier_ids:
        tier_id = str(item or "").strip()
        if not tier_id:
            continue
        expanded_ids = FOOD_TIER_ID_ALIAS_MAP.get(tier_id, [tier_id])
        for expanded_tier_id in expanded_ids:
            normalized_tier_id = str(expanded_tier_id or "").strip()
            if not normalized_tier_id or normalized_tier_id in values:
                continue
            if normalized_tier_id not in allowed_ids:
                raise HTTPException(status_code=400, detail=f"价位档非法: {normalized_tier_id}")
            values.append(normalized_tier_id)
    if len(values) < 3 or len(values) > 4:
        raise HTTPException(status_code=400, detail="selected_tier_ids 必须选择 3~4 个不重复价位档")
    return values


def normalize_food_campaign_join_mode(value: Any) -> str:
    mode = str(value or FOOD_CAMPAIGN_JOIN_MODE_ALL).strip().lower()
    if mode not in FOOD_CAMPAIGN_JOIN_MODE_KEYS:
        raise HTTPException(status_code=400, detail="join_mode 仅支持 all|invite|password")
    return mode


def normalize_food_campaign_reveal_scope(value: Any) -> str:
    scope = str(value or FOOD_REVEAL_SCOPE_SHARE_TOKEN).strip().lower()
    if not scope:
        return FOOD_REVEAL_SCOPE_SHARE_TOKEN
    return scope


def normalize_food_campaign_password(value: Any) -> str:
    password = str(value or "").strip()
    if not password:
        return ""
    if len(password) < FOOD_CAMPAIGN_PASSWORD_MIN_LENGTH or len(password) > FOOD_CAMPAIGN_PASSWORD_MAX_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"参与密码长度需在 {FOOD_CAMPAIGN_PASSWORD_MIN_LENGTH}-{FOOD_CAMPAIGN_PASSWORD_MAX_LENGTH} 位之间",
        )
    return password


def build_food_campaign_password_hash(password: str, salt: str) -> str:
    normalized_password = str(password or "")
    normalized_salt = str(salt or "")
    payload = f"{normalized_salt}::{normalized_password}".encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def verify_food_campaign_password(password: str, salt: str, expected_hash: str) -> bool:
    password_text = str(password or "")
    salt_text = str(salt or "")
    expected = str(expected_hash or "").strip().lower()
    if not password_text or not salt_text or not expected:
        return False
    candidate = build_food_campaign_password_hash(password_text, salt_text).lower()
    return hmac.compare_digest(candidate, expected)


def normalize_food_trend_mode(value: Any, fallback: str = FOOD_PRICE_TREND_FLAT) -> str:
    mode = str(value or "").strip().lower()
    if mode not in FOOD_PRICE_TREND_KEYS:
        return fallback
    return mode


def normalize_float_value(value: Any, fallback: float = 0.0) -> float:
    try:
        parsed = float(str(value or "").strip())
    except (TypeError, ValueError):
        return float(fallback)
    if not parsed or parsed != parsed:  # NaN
        return float(fallback)
    return float(parsed)


def normalize_int_value(value: Any, fallback: int = 0) -> int:
    try:
        return int(str(value or "").strip())
    except (TypeError, ValueError):
        return int(fallback)


def normalize_food_pricing_rule(
    trend_mode: Any,
    anchor_headcount: Any,
    slope: Any,
    min_factor: Any,
    max_factor: Any,
) -> Dict[str, Any]:
    normalized = {
        "trend_mode": normalize_food_trend_mode(trend_mode),
        "anchor_headcount": max(1, min(200, normalize_int_value(anchor_headcount, FOOD_GLOBAL_PRICING_DEFAULT["anchor_headcount"]))),
        "slope": max(0.0, min(1.0, normalize_float_value(slope, FOOD_GLOBAL_PRICING_DEFAULT["slope"]))),
        "min_factor": max(0.1, min(5.0, normalize_float_value(min_factor, FOOD_GLOBAL_PRICING_DEFAULT["min_factor"]))),
        "max_factor": max(0.1, min(5.0, normalize_float_value(max_factor, FOOD_GLOBAL_PRICING_DEFAULT["max_factor"]))),
    }
    if normalized["min_factor"] > normalized["max_factor"]:
        normalized["min_factor"], normalized["max_factor"] = normalized["max_factor"], normalized["min_factor"]
    return normalized


def normalize_food_pricing_override(raw: Any) -> Dict[str, Any]:
    data = parse_json_object(raw) if not isinstance(raw, dict) else dict(raw)
    if not data:
        return {}
    picked: Dict[str, Any] = {}
    if "trend_mode" in data:
        picked["trend_mode"] = normalize_food_trend_mode(data.get("trend_mode"), FOOD_GLOBAL_PRICING_DEFAULT["trend_mode"])
    if "anchor_headcount" in data:
        picked["anchor_headcount"] = max(1, min(200, normalize_int_value(data.get("anchor_headcount"), FOOD_GLOBAL_PRICING_DEFAULT["anchor_headcount"])))
    if "slope" in data:
        picked["slope"] = max(0.0, min(1.0, normalize_float_value(data.get("slope"), FOOD_GLOBAL_PRICING_DEFAULT["slope"])))
    if "min_factor" in data:
        picked["min_factor"] = max(0.1, min(5.0, normalize_float_value(data.get("min_factor"), FOOD_GLOBAL_PRICING_DEFAULT["min_factor"])))
    if "max_factor" in data:
        picked["max_factor"] = max(0.1, min(5.0, normalize_float_value(data.get("max_factor"), FOOD_GLOBAL_PRICING_DEFAULT["max_factor"])))
    min_factor = float(picked.get("min_factor", FOOD_GLOBAL_PRICING_DEFAULT["min_factor"]))
    max_factor = float(picked.get("max_factor", FOOD_GLOBAL_PRICING_DEFAULT["max_factor"]))
    if min_factor > max_factor:
        picked["min_factor"] = max_factor
        picked["max_factor"] = min_factor
    return picked


def normalize_food_candidate_status(value: Any, default: str = FOOD_CANDIDATE_STATUS_APPROVED) -> str:
    status = str(value or "").strip().lower()
    if status in FOOD_CANDIDATE_STATUS_KEYS:
        return status
    return default


def get_food_candidate_status_label(value: Any) -> str:
    status = normalize_food_candidate_status(value, FOOD_CANDIDATE_STATUS_APPROVED)
    return FOOD_CANDIDATE_STATUS_LABEL_MAP.get(status, status)


def merge_food_pricing_rule(
    category_rule: Optional[Dict[str, Any]] = None,
    strategy_override: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    merged = dict(FOOD_GLOBAL_PRICING_DEFAULT)
    if category_rule:
        for key in ("trend_mode", "anchor_headcount", "slope", "min_factor", "max_factor"):
            if key in category_rule:
                merged[key] = category_rule[key]
    if strategy_override:
        for key in ("trend_mode", "anchor_headcount", "slope", "min_factor", "max_factor"):
            if key in strategy_override:
                merged[key] = strategy_override[key]
    normalized = normalize_food_pricing_rule(
        trend_mode=merged.get("trend_mode"),
        anchor_headcount=merged.get("anchor_headcount"),
        slope=merged.get("slope"),
        min_factor=merged.get("min_factor"),
        max_factor=merged.get("max_factor"),
    )
    return normalized


def resolve_food_base_price_range(food_item: Dict[str, Any], template_key: str) -> Tuple[float, float]:
    if template_key == FOOD_TEMPLATE_PARTY:
        base_min = max(0.0, normalize_float_value(food_item.get("party_price_min"), 0.0))
        base_max = max(base_min, normalize_float_value(food_item.get("party_price_max"), base_min))
        return base_min, base_max
    base_min = max(0.0, normalize_float_value(food_item.get("daily_price_min"), 0.0))
    base_max = max(base_min, normalize_float_value(food_item.get("daily_price_max"), base_min))
    return base_min, base_max


def calculate_food_price_factor(rule: Dict[str, Any], headcount: int) -> float:
    n = max(1, int(headcount))
    anchor = max(1, int(rule.get("anchor_headcount", FOOD_GLOBAL_PRICING_DEFAULT["anchor_headcount"])))
    slope = max(0.0, float(rule.get("slope", FOOD_GLOBAL_PRICING_DEFAULT["slope"])))
    trend_mode = normalize_food_trend_mode(rule.get("trend_mode"), FOOD_GLOBAL_PRICING_DEFAULT["trend_mode"])
    delta = max(0, n - anchor)
    if trend_mode == FOOD_PRICE_TREND_DECREASE:
        factor = 1.0 - slope * delta
    elif trend_mode == FOOD_PRICE_TREND_INCREASE:
        factor = 1.0 + slope * delta
    else:
        factor = 1.0
    min_factor = max(0.1, float(rule.get("min_factor", FOOD_GLOBAL_PRICING_DEFAULT["min_factor"])))
    max_factor = max(min_factor, float(rule.get("max_factor", FOOD_GLOBAL_PRICING_DEFAULT["max_factor"])))
    return max(min_factor, min(max_factor, factor))


def resolve_food_tier_by_price(template_key: str, price_value: float) -> Dict[str, Any]:
    tiers = get_food_template_tiers(template_key)
    for tier in tiers:
        lower = float(tier.get("min", 0.0) or 0.0)
        upper = tier.get("max")
        if upper is None:
            if price_value >= lower:
                return tier
            continue
        upper_value = float(upper)
        if price_value >= lower and price_value < upper_value:
            return tier
    return tiers[-1] if tiers else {"id": "", "label": "", "min": 0.0, "max": None}


def calculate_food_dynamic_price(
    food_item: Dict[str, Any],
    template_key: str,
    headcount: int,
    category_rules: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    normalized_template = normalize_food_template_key(template_key)
    category_key = str(food_item.get("category_key", "")).strip()
    strategy_override = normalize_food_pricing_override(food_item.get("strategy_override_json"))
    category_rule = (category_rules or {}).get(category_key) if category_key else None
    rule = merge_food_pricing_rule(category_rule=category_rule, strategy_override=strategy_override)
    base_min, base_max = resolve_food_base_price_range(food_item, normalized_template)
    factor = calculate_food_price_factor(rule, headcount)
    dynamic_min = round(base_min * factor, 2)
    dynamic_max = round(base_max * factor, 2)
    if dynamic_max < dynamic_min:
        dynamic_max = dynamic_min
    mid_value = (dynamic_min + dynamic_max) / 2.0
    tier = resolve_food_tier_by_price(normalized_template, mid_value)
    return {
        "templateKey": normalized_template,
        "headcount": max(1, int(headcount)),
        "basePriceMin": base_min,
        "basePriceMax": base_max,
        "dynamicPriceMin": dynamic_min,
        "dynamicPriceMax": dynamic_max,
        "dynamicPriceMid": round(mid_value, 2),
        "tierId": str(tier.get("id", "")).strip(),
        "tierLabel": str(tier.get("label", "")).strip(),
        "rule": rule,
    }


def normalize_food_item_row(row: Any) -> Dict[str, Any]:
    item = dict(row or {})
    item["id"] = normalize_int_value(item.get("id"), 0)
    item["food_key"] = str(item.get("food_key", "")).strip()
    item["name"] = trim_profile_text(item.get("name"), max_length=50)
    item["category_key"] = trim_profile_text(item.get("category_key"), max_length=40)
    item["brand_key"] = normalize_food_brand_key(item.get("brand_key"))
    raw_brand_name = trim_profile_text(item.get("brand_name"), max_length=40)
    item["brand_name"] = raw_brand_name or FOOD_BRAND_NAME_MAP.get(item["brand_key"], "")
    item["brand_combo"] = trim_profile_text(item.get("brand_combo"), max_length=80)
    item["candidate_status"] = normalize_food_candidate_status(item.get("candidate_status"), FOOD_CANDIDATE_STATUS_APPROVED)
    item["note"] = trim_profile_text(item.get("note"), max_length=240)
    item["enabled"] = 1 if bool(item.get("enabled")) else 0
    item["daily_price_min"] = max(0.0, normalize_float_value(item.get("daily_price_min"), 0.0))
    item["daily_price_max"] = max(item["daily_price_min"], normalize_float_value(item.get("daily_price_max"), item["daily_price_min"]))
    item["party_price_min"] = max(0.0, normalize_float_value(item.get("party_price_min"), 0.0))
    item["party_price_max"] = max(item["party_price_min"], normalize_float_value(item.get("party_price_max"), item["party_price_min"]))
    item["distance_km"] = max(0.0, normalize_float_value(item.get("distance_km"), 0.0))
    item["strategy_override_json"] = json.dumps(normalize_food_pricing_override(item.get("strategy_override_json")), ensure_ascii=False)
    item["created_by_student_id"] = trim_profile_text(item.get("created_by_student_id"), max_length=40)
    item["approved_by_student_id"] = trim_profile_text(item.get("approved_by_student_id"), max_length=40)
    item["approved_at"] = normalize_int_value(item.get("approved_at"), 0)
    item["created_at"] = normalize_int_value(item.get("created_at"), int(time.time()))
    item["updated_at"] = normalize_int_value(item.get("updated_at"), int(time.time()))
    return item


def list_food_items_from_db(
    conn: sqlite3.Connection,
    include_disabled: bool = False,
    candidate_status: Optional[str] = None,
    keyword: str = "",
    category_key: str = "",
    brand_key: str = "",
) -> List[Dict[str, Any]]:
    where_parts: List[str] = []
    params: List[Any] = []
    if include_disabled:
        pass
    else:
        where_parts.append("enabled=1")
        where_parts.append("candidate_status=?")
        params.append(FOOD_CANDIDATE_STATUS_APPROVED)
    normalized_status = str(candidate_status or "").strip().lower()
    if normalized_status and normalized_status != "all":
        where_parts.append("candidate_status=?")
        params.append(normalize_food_candidate_status(normalized_status, FOOD_CANDIDATE_STATUS_APPROVED))
    normalized_category_key = trim_profile_text(category_key, max_length=40).lower()
    if normalized_category_key:
        where_parts.append("category_key=?")
        params.append(normalized_category_key)
    normalized_brand_key = normalize_food_brand_key(brand_key)
    if normalized_brand_key:
        where_parts.append("brand_key=?")
        params.append(normalized_brand_key)
    normalized_keyword = trim_profile_text(keyword, max_length=50)
    if normalized_keyword:
        like_keyword = f"%{normalized_keyword}%"
        where_parts.append("(name LIKE ? OR food_key LIKE ? OR note LIKE ? OR brand_name LIKE ?)")
        params.extend([like_keyword, like_keyword, like_keyword, like_keyword])
    where_clause = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
    rows = conn.execute(
        f"""
        SELECT id, food_key, name, category_key, brand_key, brand_name, brand_combo, candidate_status, note, enabled, daily_price_min, daily_price_max, party_price_min, party_price_max, distance_km, strategy_override_json, created_by_student_id, approved_by_student_id, approved_at, created_at, updated_at
        FROM food_items
        {where_clause}
        ORDER BY enabled DESC, updated_at DESC, id DESC
        """,
        tuple(params),
    ).fetchall()
    return [normalize_food_item_row(row) for row in rows]


def get_food_item_by_key(conn: sqlite3.Connection, food_key: str) -> Optional[Dict[str, Any]]:
    normalized_key = str(food_key or "").strip()
    if not normalized_key:
        return None
    row = conn.execute(
        """
        SELECT id, food_key, name, category_key, brand_key, brand_name, brand_combo, candidate_status, note, enabled, daily_price_min, daily_price_max, party_price_min, party_price_max, distance_km, strategy_override_json, created_by_student_id, approved_by_student_id, approved_at, created_at, updated_at
        FROM food_items
        WHERE food_key=?
        LIMIT 1
        """,
        (normalized_key,),
    ).fetchone()
    return normalize_food_item_row(row) if row else None


def get_food_item_by_id(conn: sqlite3.Connection, food_id: int) -> Optional[Dict[str, Any]]:
    normalized_id = max(0, int(food_id))
    if normalized_id <= 0:
        return None
    row = conn.execute(
        """
        SELECT id, food_key, name, category_key, brand_key, brand_name, brand_combo, candidate_status, note, enabled, daily_price_min, daily_price_max, party_price_min, party_price_max, distance_km, strategy_override_json, created_by_student_id, approved_by_student_id, approved_at, created_at, updated_at
        FROM food_items
        WHERE id=?
        LIMIT 1
        """,
        (normalized_id,),
    ).fetchone()
    return normalize_food_item_row(row) if row else None


def build_unique_food_key(conn: sqlite3.Connection, prefix: str = "food") -> str:
    normalized_prefix = re.sub(r"[^a-z0-9_-]+", "_", str(prefix or "").strip().lower()).strip("_")
    if not normalized_prefix:
        normalized_prefix = "food"
    normalized_prefix = normalized_prefix[:20]
    for _ in range(8):
        candidate = f"{normalized_prefix}_{secrets.token_hex(4)}"[:40]
        if not get_food_item_by_key(conn, candidate):
            return candidate
    return f"{normalized_prefix}_{int(time.time())}"[:40]


def list_food_category_pricing_rules(conn: sqlite3.Connection) -> List[Dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT category_key, category_name, trend_mode, anchor_headcount, slope, min_factor, max_factor, updated_at
        FROM food_category_pricing_rules
        ORDER BY category_key ASC
        """
    ).fetchall()
    items: List[Dict[str, Any]] = []
    for row in rows:
        normalized = normalize_food_pricing_rule(
            trend_mode=row["trend_mode"],
            anchor_headcount=row["anchor_headcount"],
            slope=row["slope"],
            min_factor=row["min_factor"],
            max_factor=row["max_factor"],
        )
        items.append(
            {
                "category_key": str(row["category_key"] or "").strip(),
                "category_name": str(row["category_name"] or "").strip(),
                **normalized,
                "updated_at": normalize_int_value(row["updated_at"], 0),
            }
        )
    return items


def get_food_category_pricing_rule_map(conn: sqlite3.Connection) -> Dict[str, Dict[str, Any]]:
    items = list_food_category_pricing_rules(conn)
    return {str(item.get("category_key", "")).strip(): item for item in items if str(item.get("category_key", "")).strip()}


def generate_food_pricing_version_id(prefix: str) -> str:
    normalized_prefix = re.sub(r"[^a-z0-9_-]+", "", str(prefix or "").strip().lower()) or "ver"
    return f"{normalized_prefix}_{int(time.time())}_{secrets.token_hex(4)}"


def record_food_category_rule_versions(
    conn: sqlite3.Connection,
    items: List[Dict[str, Any]],
    operator_student_id: str = "",
) -> str:
    if not items:
        return ""
    version_id = generate_food_pricing_version_id("category_rule")
    now_ts = int(time.time())
    normalized_operator = normalize_student_id(operator_student_id) if operator_student_id else ""
    for item in items:
        normalized = normalize_food_pricing_rule(
            trend_mode=item.get("trend_mode"),
            anchor_headcount=item.get("anchor_headcount"),
            slope=item.get("slope"),
            min_factor=item.get("min_factor"),
            max_factor=item.get("max_factor"),
        )
        conn.execute(
            """
            INSERT INTO food_category_pricing_rule_versions
            (version_id, category_key, category_name, trend_mode, anchor_headcount, slope, min_factor, max_factor, operator_student_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                version_id,
                trim_profile_text(item.get("category_key"), max_length=40).lower(),
                trim_profile_text(item.get("category_name"), max_length=40),
                normalized["trend_mode"],
                normalized["anchor_headcount"],
                normalized["slope"],
                normalized["min_factor"],
                normalized["max_factor"],
                normalized_operator,
                now_ts,
            ),
        )
    return version_id


def record_food_item_pricing_override_version(
    conn: sqlite3.Connection,
    food_key: str,
    strategy_override_json: Any,
    operator_student_id: str = "",
) -> str:
    normalized_food_key = trim_profile_text(food_key, max_length=40).lower()
    if not normalized_food_key:
        return ""
    version_id = generate_food_pricing_version_id("food_override")
    now_ts = int(time.time())
    normalized_override = normalize_food_pricing_override(strategy_override_json)
    normalized_operator = normalize_student_id(operator_student_id) if operator_student_id else ""
    conn.execute(
        """
        INSERT INTO food_item_pricing_override_versions
        (version_id, food_key, strategy_override_json, operator_student_id, created_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            version_id,
            normalized_food_key,
            json.dumps(normalized_override, ensure_ascii=False),
            normalized_operator,
            now_ts,
        ),
    )
    return version_id


def build_food_pricing_preview_food_item(
    template_key: str,
    category_key: str,
    strategy_override_json: Dict[str, Any],
    base_price_min: float,
    base_price_max: float,
) -> Dict[str, Any]:
    normalized_template = normalize_food_template_key(template_key)
    normalized_category_key = trim_profile_text(category_key, max_length=40).lower()
    normalized_override = normalize_food_pricing_override(strategy_override_json)
    normalized_base_min = max(0.0, float(base_price_min))
    normalized_base_max = max(normalized_base_min, float(base_price_max))
    item: Dict[str, Any] = {
        "id": 0,
        "food_key": "__preview__",
        "name": "预览食物",
        "category_key": normalized_category_key,
        "brand_key": "",
        "brand_name": "",
        "brand_combo": "",
        "candidate_status": FOOD_CANDIDATE_STATUS_APPROVED,
        "note": "",
        "enabled": 1,
        "daily_price_min": normalized_base_min,
        "daily_price_max": normalized_base_max,
        "party_price_min": normalized_base_min,
        "party_price_max": normalized_base_max,
        "distance_km": 0.0,
        "strategy_override_json": json.dumps(normalized_override, ensure_ascii=False),
        "created_by_student_id": "",
        "approved_by_student_id": "",
        "approved_at": 0,
        "created_at": int(time.time()),
        "updated_at": int(time.time()),
    }
    if normalized_template == FOOD_TEMPLATE_PARTY:
        item["daily_price_min"] = normalized_base_min
        item["daily_price_max"] = normalized_base_max
    return item


def build_food_pricing_curve_points(
    food_item: Dict[str, Any],
    template_key: str,
    headcount_start: int,
    headcount_end: int,
    headcount_step: int,
    category_rules: Optional[Dict[str, Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    start = max(1, min(200, int(headcount_start)))
    end = max(1, min(200, int(headcount_end)))
    if end < start:
        start, end = end, start
    step = max(1, min(20, int(headcount_step)))
    normalized_template = normalize_food_template_key(template_key)
    category_key = str(food_item.get("category_key", "")).strip()
    override_rule = normalize_food_pricing_override(food_item.get("strategy_override_json"))
    category_rule = (category_rules or {}).get(category_key) if category_key else None
    merged_rule = merge_food_pricing_rule(category_rule=category_rule, strategy_override=override_rule)
    points: List[Dict[str, Any]] = []
    for headcount in range(start, end + 1, step):
        dynamic = calculate_food_dynamic_price(
            food_item,
            template_key=normalized_template,
            headcount=headcount,
            category_rules=category_rules,
        )
        factor = round(calculate_food_price_factor(merged_rule, headcount), 4)
        points.append(
            {
                "headcount": headcount,
                "factor": factor,
                "dynamicPriceMin": dynamic["dynamicPriceMin"],
                "dynamicPriceMax": dynamic["dynamicPriceMax"],
                "dynamicPriceMid": dynamic["dynamicPriceMid"],
                "tierId": dynamic["tierId"],
                "tierLabel": dynamic["tierLabel"],
            }
        )
    return points


def list_food_category_pricing_rule_version_history(
    conn: sqlite3.Connection,
    category_key: str = "",
    limit: int = 200,
) -> List[Dict[str, Any]]:
    normalized_category_key = trim_profile_text(category_key, max_length=40).lower()
    normalized_limit = max(1, min(500, int(limit or 200)))
    where_clause = ""
    params: List[Any] = []
    if normalized_category_key:
        where_clause = "WHERE category_key=?"
        params.append(normalized_category_key)
    params.append(normalized_limit)
    rows = conn.execute(
        f"""
        SELECT version_id, category_key, category_name, trend_mode, anchor_headcount, slope, min_factor, max_factor, operator_student_id, created_at
        FROM food_category_pricing_rule_versions
        {where_clause}
        ORDER BY created_at DESC, id DESC
        LIMIT ?
        """,
        tuple(params),
    ).fetchall()
    result: List[Dict[str, Any]] = []
    for row in rows:
        normalized = normalize_food_pricing_rule(
            trend_mode=row["trend_mode"],
            anchor_headcount=row["anchor_headcount"],
            slope=row["slope"],
            min_factor=row["min_factor"],
            max_factor=row["max_factor"],
        )
        created_at = normalize_int_value(row["created_at"], 0)
        result.append(
            {
                "versionId": str(row["version_id"] or ""),
                "categoryKey": str(row["category_key"] or ""),
                "categoryName": str(row["category_name"] or ""),
                "trendMode": normalized["trend_mode"],
                "anchorHeadcount": normalized["anchor_headcount"],
                "slope": normalized["slope"],
                "minFactor": normalized["min_factor"],
                "maxFactor": normalized["max_factor"],
                "operatorStudentId": str(row["operator_student_id"] or ""),
                "createdAt": created_at,
                "updatedAt": created_at,
            }
        )
    return result


def list_food_item_pricing_override_version_history(
    conn: sqlite3.Connection,
    food_key: str,
    limit: int = 200,
) -> List[Dict[str, Any]]:
    normalized_food_key = trim_profile_text(food_key, max_length=40).lower()
    if not normalized_food_key:
        return []
    normalized_limit = max(1, min(500, int(limit or 200)))
    rows = conn.execute(
        """
        SELECT version_id, food_key, strategy_override_json, operator_student_id, created_at
        FROM food_item_pricing_override_versions
        WHERE food_key=?
        ORDER BY created_at DESC, id DESC
        LIMIT ?
        """,
        (normalized_food_key, normalized_limit),
    ).fetchall()
    result: List[Dict[str, Any]] = []
    for row in rows:
        created_at = normalize_int_value(row["created_at"], 0)
        result.append(
            {
                "versionId": str(row["version_id"] or ""),
                "foodKey": str(row["food_key"] or ""),
                "strategyOverride": normalize_food_pricing_override(row["strategy_override_json"]),
                "operatorStudentId": str(row["operator_student_id"] or ""),
                "createdAt": created_at,
                "updatedAt": created_at,
            }
        )
    return result


def list_food_category_options(conn: sqlite3.Connection) -> List[Dict[str, Any]]:
    category_rule_map = get_food_category_pricing_rule_map(conn)
    rows = conn.execute(
        """
        SELECT category_key, COUNT(1) AS c
        FROM food_items
        WHERE enabled=1 AND candidate_status=?
        GROUP BY category_key
        ORDER BY c DESC, category_key ASC
        """,
        (FOOD_CANDIDATE_STATUS_APPROVED,),
    ).fetchall()
    options: List[Dict[str, Any]] = []
    for row in rows:
        category_key = str(row["category_key"] or "").strip()
        if not category_key:
            continue
        category_name = str((category_rule_map.get(category_key) or {}).get("category_name", "")).strip() or category_key
        options.append(
            {
                "categoryKey": category_key,
                "categoryName": category_name,
                "count": normalize_int_value(row["c"], 0),
            }
        )
    return options


def list_food_brand_options(conn: sqlite3.Connection, category_key: str = "") -> List[Dict[str, Any]]:
    where_parts = ["enabled=1", "candidate_status=?", "TRIM(COALESCE(brand_key, ''))<>''"]
    params: List[Any] = [FOOD_CANDIDATE_STATUS_APPROVED]
    normalized_category_key = trim_profile_text(category_key, max_length=40).lower()
    if normalized_category_key:
        where_parts.append("category_key=?")
        params.append(normalized_category_key)
    where_clause = " AND ".join(where_parts)
    rows = conn.execute(
        f"""
        SELECT brand_key, MAX(brand_name) AS brand_name, COUNT(1) AS c
        FROM food_items
        WHERE {where_clause}
        GROUP BY brand_key
        ORDER BY c DESC, brand_key ASC
        """,
        tuple(params),
    ).fetchall()
    options: List[Dict[str, Any]] = []
    for row in rows:
        brand_key = normalize_food_brand_key(row["brand_key"])
        if not brand_key:
            continue
        brand_name = trim_profile_text(row["brand_name"], max_length=40) or FOOD_BRAND_NAME_MAP.get(brand_key, brand_key)
        options.append(
            {
                "brandKey": brand_key,
                "brandName": brand_name,
                "count": normalize_int_value(row["c"], 0),
            }
        )
    return options


def build_food_item_payload(
    food_item: Dict[str, Any],
    template_key: str,
    headcount: int,
    category_rules: Optional[Dict[str, Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    dynamic = calculate_food_dynamic_price(food_item, template_key=template_key, headcount=headcount, category_rules=category_rules)
    category_key = str(food_item.get("category_key", ""))
    category_rule = (category_rules or {}).get(category_key) if category_key else None
    category_name = str((category_rule or {}).get("category_name", "")).strip() or category_key
    candidate_status = normalize_food_candidate_status(food_item.get("candidate_status"), FOOD_CANDIDATE_STATUS_APPROVED)
    return {
        "id": int(food_item.get("id", 0)),
        "foodKey": str(food_item.get("food_key", "")),
        "name": str(food_item.get("name", "")),
        "categoryKey": category_key,
        "categoryName": category_name,
        "brandKey": str(food_item.get("brand_key", "")),
        "brandName": str(food_item.get("brand_name", "")),
        "brandCombo": str(food_item.get("brand_combo", "")),
        "candidateStatus": candidate_status,
        "candidateStatusLabel": get_food_candidate_status_label(candidate_status),
        "note": str(food_item.get("note", "")),
        "enabled": bool(food_item.get("enabled")),
        "createdByStudentId": str(food_item.get("created_by_student_id", "")),
        "approvedByStudentId": str(food_item.get("approved_by_student_id", "")),
        "approvedAt": normalize_int_value(food_item.get("approved_at"), 0),
        "distanceKm": float(food_item.get("distance_km", 0.0)),
        "dailyPriceMin": float(food_item.get("daily_price_min", 0.0)),
        "dailyPriceMax": float(food_item.get("daily_price_max", 0.0)),
        "partyPriceMin": float(food_item.get("party_price_min", 0.0)),
        "partyPriceMax": float(food_item.get("party_price_max", 0.0)),
        "strategyOverride": normalize_food_pricing_override(food_item.get("strategy_override_json")),
        **dynamic,
    }


def normalize_food_campaign_status(value: Any) -> str:
    status = str(value or "").strip().lower()
    if status in {FOOD_CAMPAIGN_STATUS_OPEN, FOOD_CAMPAIGN_STATUS_CLOSED, FOOD_CAMPAIGN_STATUS_CANCELLED}:
        return status
    return FOOD_CAMPAIGN_STATUS_OPEN


def normalize_food_campaign_title(value: Optional[str]) -> str:
    title = trim_profile_text(value, max_length=40)
    if title:
        return title
    return "今天吃什么"


def parse_deadline_timestamp(deadline_at: str) -> int:
    text = str(deadline_at or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="deadline_at 不能为空")
    normalized = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        raise HTTPException(status_code=400, detail="deadline_at 格式非法，请传 ISO 时间字符串")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=get_timezone())
    ts = int(parsed.astimezone(get_timezone()).timestamp())
    now_ts = int(time.time())
    if ts <= now_ts + FOOD_CAMPAIGN_MIN_DEADLINE_SECONDS:
        raise HTTPException(status_code=400, detail="截止时间必须晚于当前至少 5 分钟")
    return ts


def normalize_student_id_list(values: Optional[List[str]]) -> List[str]:
    normalized: List[str] = []
    for value in values or []:
        student_id = normalize_student_id(value)
        if not student_id or student_id in normalized:
            continue
        ensure_student_exists(student_id)
        normalized.append(student_id)
    return normalized


def normalize_food_id_list(values: List[int]) -> List[int]:
    normalized: List[int] = []
    for raw in values:
        value = normalize_int_value(raw, 0)
        if value <= 0 or value in normalized:
            continue
        normalized.append(value)
    return normalized


def randomize_items(values: List[Any]) -> List[Any]:
    pool = list(values)
    result: List[Any] = []
    while pool:
        index = secrets.randbelow(len(pool))
        result.append(pool.pop(index))
    return result


def generate_food_campaign_id() -> str:
    return f"fc_{secrets.token_hex(8)}"


def generate_food_campaign_share_token() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def parse_food_id_list_from_json(raw: Any) -> List[int]:
    values = parse_json_array(raw)
    result: List[int] = []
    for item in values:
        value = normalize_int_value(item, 0)
        if value <= 0 or value in result:
            continue
        result.append(value)
    return result


def parse_tier_id_list_from_json(raw: Any, template_key: str = "") -> List[str]:
    values = parse_json_array(raw)
    result: List[str] = []
    for item in values:
        tier_id = str(item or "").strip()
        if not tier_id:
            continue
        expanded_ids = FOOD_TIER_ID_ALIAS_MAP.get(tier_id, [tier_id])
        for expanded_tier_id in expanded_ids:
            normalized_tier_id = str(expanded_tier_id or "").strip()
            if not normalized_tier_id or normalized_tier_id in result:
                continue
            result.append(normalized_tier_id)
    if template_key:
        allowed_ids = set(get_food_template_tier_ids(template_key))
        result = [item for item in result if item in allowed_ids]
    return result


def parse_food_filter_keys_from_json(raw: Any, max_length: int = 40, max_items: int = 12) -> List[str]:
    values = parse_json_array(raw)
    result: List[str] = []
    for item in values:
        key = trim_profile_text(item, max_length=max_length).lower()
        if not key or key in result:
            continue
        result.append(key)
        if len(result) >= max_items:
            break
    return result


def seed_food_pricing_rules_if_empty(conn: sqlite3.Connection) -> None:
    now_ts = int(time.time())
    for item in FOOD_CATEGORY_RULE_SEEDS:
        normalized = normalize_food_pricing_rule(
            trend_mode=item.get("trend_mode"),
            anchor_headcount=item.get("anchor_headcount"),
            slope=item.get("slope"),
            min_factor=item.get("min_factor"),
            max_factor=item.get("max_factor"),
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO food_category_pricing_rules
            (category_key, category_name, trend_mode, anchor_headcount, slope, min_factor, max_factor, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(item.get("category_key", "")).strip(),
                str(item.get("category_name", "")).strip(),
                normalized["trend_mode"],
                normalized["anchor_headcount"],
                normalized["slope"],
                normalized["min_factor"],
                normalized["max_factor"],
                now_ts,
            ),
        )


def seed_food_items_if_empty(conn: sqlite3.Connection) -> None:
    now_ts = int(time.time())
    for item in DEFAULT_FOOD_ITEMS:
        normalized = normalize_food_item_row(
            {
                **item,
                "candidate_status": item.get("candidate_status", FOOD_CANDIDATE_STATUS_APPROVED),
                "note": item.get("note", ""),
                "enabled": 1,
                "strategy_override_json": "{}",
                "created_by_student_id": "",
                "approved_by_student_id": "system",
                "approved_at": now_ts,
                "created_at": now_ts,
                "updated_at": now_ts,
            }
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO food_items
            (food_key, name, category_key, brand_key, brand_name, brand_combo, candidate_status, note, enabled, daily_price_min, daily_price_max, party_price_min, party_price_max, distance_km, strategy_override_json, created_by_student_id, approved_by_student_id, approved_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                normalized["food_key"],
                normalized["name"],
                normalized["category_key"],
                normalized["brand_key"],
                normalized["brand_name"],
                normalized["brand_combo"],
                normalized["candidate_status"],
                normalized["note"],
                normalized["enabled"],
                normalized["daily_price_min"],
                normalized["daily_price_max"],
                normalized["party_price_min"],
                normalized["party_price_max"],
                normalized["distance_km"],
                normalized["strategy_override_json"],
                normalized["created_by_student_id"],
                normalized["approved_by_student_id"],
                normalized["approved_at"],
                normalized["created_at"],
                normalized["updated_at"],
            ),
        )


def ensure_food_category_minimum_items(conn: sqlite3.Connection, min_count: int = 10) -> None:
    target = max(1, min(50, int(min_count or 10)))
    now_ts = int(time.time())
    category_counts: Dict[str, int] = {}
    for row in conn.execute(
        """
        SELECT category_key, COUNT(1) AS c
        FROM food_items
        WHERE enabled=1 AND candidate_status=?
        GROUP BY category_key
        """,
        (FOOD_CANDIDATE_STATUS_APPROVED,),
    ).fetchall():
        category_counts[str(row["category_key"] or "").strip()] = normalize_int_value(row["c"], 0)
    for item in FOOD_CATEGORY_TOPUP_ITEMS:
        category_key = str(item.get("category_key", "")).strip()
        if not category_key:
            continue
        if normalize_int_value(category_counts.get(category_key), 0) >= target:
            continue
        normalized = normalize_food_item_row(
            {
                **item,
                "candidate_status": item.get("candidate_status", FOOD_CANDIDATE_STATUS_APPROVED),
                "note": item.get("note", ""),
                "enabled": 1,
                "strategy_override_json": "{}",
                "created_by_student_id": "",
                "approved_by_student_id": "system",
                "approved_at": now_ts,
                "created_at": now_ts,
                "updated_at": now_ts,
            }
        )
        existing = get_food_item_by_key(conn, normalized["food_key"])
        if existing:
            continue
        conn.execute(
            """
            INSERT OR IGNORE INTO food_items
            (food_key, name, category_key, brand_key, brand_name, brand_combo, candidate_status, note, enabled, daily_price_min, daily_price_max, party_price_min, party_price_max, distance_km, strategy_override_json, created_by_student_id, approved_by_student_id, approved_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                normalized["food_key"],
                normalized["name"],
                normalized["category_key"],
                normalized["brand_key"],
                normalized["brand_name"],
                normalized["brand_combo"],
                normalized["candidate_status"],
                normalized["note"],
                normalized["enabled"],
                normalized["daily_price_min"],
                normalized["daily_price_max"],
                normalized["party_price_min"],
                normalized["party_price_max"],
                normalized["distance_km"],
                normalized["strategy_override_json"],
                normalized["created_by_student_id"],
                normalized["approved_by_student_id"],
                normalized["approved_at"],
                normalized["created_at"],
                normalized["updated_at"],
            ),
        )
        category_counts[category_key] = normalize_int_value(category_counts.get(category_key), 0) + 1


def auto_close_food_campaign_if_needed(conn: sqlite3.Connection, campaign: Dict[str, Any]) -> Dict[str, Any]:
    status = normalize_food_campaign_status(campaign.get("status"))
    if status != FOOD_CAMPAIGN_STATUS_OPEN:
        return campaign
    deadline_at = normalize_int_value(campaign.get("deadline_at"), 0)
    now_ts = int(time.time())
    if deadline_at <= 0 or now_ts < deadline_at:
        return campaign
    conn.execute(
        """
        UPDATE food_campaigns
        SET status=?, closed_at=?, updated_at=?
        WHERE campaign_id=?
        """,
        (FOOD_CAMPAIGN_STATUS_CLOSED, now_ts, now_ts, str(campaign.get("campaign_id", "")).strip()),
    )
    next_campaign = dict(campaign)
    next_campaign["status"] = FOOD_CAMPAIGN_STATUS_CLOSED
    next_campaign["closed_at"] = now_ts
    next_campaign["updated_at"] = now_ts
    return next_campaign


def get_food_campaign_row_by_id(conn: sqlite3.Connection, campaign_id: str) -> Optional[Dict[str, Any]]:
    normalized_id = str(campaign_id or "").strip()
    if not normalized_id:
        return None
    row = conn.execute("SELECT * FROM food_campaigns WHERE campaign_id=? LIMIT 1", (normalized_id,)).fetchone()
    if not row:
        return None
    campaign = auto_close_food_campaign_if_needed(conn, dict(row))
    return campaign


def get_food_campaign_row_by_share_token(conn: sqlite3.Connection, share_token: str) -> Optional[Dict[str, Any]]:
    normalized_token = str(share_token or "").strip()
    if not normalized_token:
        return None
    row = conn.execute("SELECT * FROM food_campaigns WHERE share_token=? LIMIT 1", (normalized_token,)).fetchone()
    if not row:
        return None
    campaign = auto_close_food_campaign_if_needed(conn, dict(row))
    return campaign


def list_open_food_campaigns_by_initiator(conn: sqlite3.Connection, initiator_student_id: str) -> List[Dict[str, Any]]:
    normalized_student_id = str(initiator_student_id or "").strip()
    if not normalized_student_id:
        return []
    rows = conn.execute(
        """
        SELECT *
        FROM food_campaigns
        WHERE initiator_student_id=? AND status=?
        ORDER BY created_at DESC
        """,
        (normalized_student_id, FOOD_CAMPAIGN_STATUS_OPEN),
    ).fetchall()
    campaigns: List[Dict[str, Any]] = []
    for row in rows:
        campaign = auto_close_food_campaign_if_needed(conn, dict(row))
        if normalize_food_campaign_status(campaign.get("status")) == FOOD_CAMPAIGN_STATUS_OPEN:
            campaigns.append(campaign)
    return campaigns


def require_food_campaign(conn: sqlite3.Connection, campaign_id: str) -> Dict[str, Any]:
    campaign = get_food_campaign_row_by_id(conn, campaign_id)
    if not campaign:
        raise HTTPException(status_code=404, detail="食物竞选不存在")
    return campaign


def get_food_campaign_participant(
    conn: sqlite3.Connection,
    campaign_id: str,
    student_id: str,
) -> Optional[Dict[str, Any]]:
    row = conn.execute(
        """
        SELECT campaign_id, student_id, source, approval_status, approved_by_student_id, approved_at, created_at, updated_at
        FROM food_campaign_participants
        WHERE campaign_id=? AND student_id=?
        LIMIT 1
        """,
        (campaign_id, student_id),
    ).fetchone()
    return dict(row) if row else None


def get_food_campaign_vote_headcount(conn: sqlite3.Connection, campaign_id: str) -> int:
    rows = conn.execute(
        """
        SELECT selected_food_ids
        FROM food_campaign_ballots
        WHERE campaign_id=?
        """,
        (campaign_id,),
    ).fetchall()
    count = 0
    for row in rows:
        selected = parse_food_id_list_from_json(row["selected_food_ids"])
        if selected:
            count += 1
    return max(1, count)


def get_food_candidate_pool(
    conn: sqlite3.Connection,
    template_key: str,
    headcount: int,
    selected_tier_ids: List[str],
    exclude_food_ids: Optional[set[int]] = None,
    selected_category_keys: Optional[List[str]] = None,
    selected_brand_keys: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    category_rule_map = get_food_category_pricing_rule_map(conn)
    excluded = set(exclude_food_ids or set())
    allowed_category_keys = {str(item or "").strip() for item in (selected_category_keys or []) if str(item or "").strip()}
    allowed_brand_keys = {str(item or "").strip() for item in (selected_brand_keys or []) if str(item or "").strip()}
    pool: List[Dict[str, Any]] = []
    for food in list_food_items_from_db(conn, include_disabled=False):
        food_id = int(food.get("id", 0))
        if food_id <= 0 or food_id in excluded:
            continue
        payload = build_food_item_payload(food, template_key=template_key, headcount=headcount, category_rules=category_rule_map)
        if allowed_category_keys and str(payload.get("categoryKey", "")).strip() not in allowed_category_keys:
            continue
        if allowed_brand_keys and str(payload.get("brandKey", "")).strip() not in allowed_brand_keys:
            continue
        if payload["tierId"] not in selected_tier_ids:
            continue
        pool.append(payload)
    return pool


def pick_food_candidates(
    pool: List[Dict[str, Any]],
    selected_tier_ids: List[str],
    target_count: int,
) -> List[Dict[str, Any]]:
    if target_count <= 0:
        return []
    by_tier: Dict[str, List[Dict[str, Any]]] = {}
    for item in pool:
        tier_id = str(item.get("tierId", "")).strip()
        if not tier_id:
            continue
        by_tier.setdefault(tier_id, []).append(item)

    selected: List[Dict[str, Any]] = []
    selected_ids: set[int] = set()
    for tier_id in randomize_items(selected_tier_ids):
        if len(selected) >= target_count:
            break
        tier_items = [item for item in by_tier.get(tier_id, []) if int(item.get("id", 0)) not in selected_ids]
        if not tier_items:
            continue
        picked = randomize_items(tier_items)[0]
        selected.append(picked)
        selected_ids.add(int(picked.get("id", 0)))

    if len(selected) < target_count:
        remained = [item for item in pool if int(item.get("id", 0)) not in selected_ids]
        for item in randomize_items(remained):
            if len(selected) >= target_count:
                break
            selected.append(item)
            selected_ids.add(int(item.get("id", 0)))
    return selected[:target_count]


def build_food_campaign_summary_payload(campaign: Dict[str, Any]) -> Dict[str, Any]:
    template_key = str(campaign.get("template_key", ""))
    selected_tier_ids = parse_tier_id_list_from_json(campaign.get("selected_tier_ids"), template_key=template_key)
    selected_category_keys = parse_food_filter_keys_from_json(campaign.get("selected_category_keys"))
    selected_brand_keys = parse_food_filter_keys_from_json(campaign.get("selected_brand_keys"))
    deadline_at = normalize_int_value(campaign.get("deadline_at"), 0)
    created_at = normalize_int_value(campaign.get("created_at"), 0)
    closed_at = normalize_int_value(campaign.get("closed_at"), 0)
    join_mode = normalize_food_campaign_join_mode(campaign.get("join_mode"))
    reveal_scope = normalize_food_campaign_reveal_scope(campaign.get("reveal_scope"))
    return {
        "campaignId": str(campaign.get("campaign_id", "")),
        "title": str(campaign.get("title", "")),
        "initiatorStudentId": str(campaign.get("initiator_student_id", "")),
        "templateKey": template_key,
        "joinMode": join_mode,
        "requiresPassword": join_mode == FOOD_CAMPAIGN_JOIN_MODE_PASSWORD,
        "selectedTierIds": selected_tier_ids,
        "selectedCategoryKeys": selected_category_keys,
        "selectedBrandKeys": selected_brand_keys,
        "maxVotesPerUser": normalize_int_value(campaign.get("max_votes_per_user"), FOOD_CAMPAIGN_MIN_VOTE_LIMIT),
        "deadlineAt": deadline_at,
        "deadlineAtIso": datetime.fromtimestamp(deadline_at, tz=get_timezone()).isoformat() if deadline_at > 0 else "",
        "status": normalize_food_campaign_status(campaign.get("status")),
        "shareToken": str(campaign.get("share_token", "")),
        "isAnonymous": bool(campaign.get("is_anonymous", 1)),
        "revealAfterClose": bool(campaign.get("reveal_after_close", 1)),
        "revealScope": reveal_scope,
        "supplementUsed": bool(campaign.get("supplement_used")),
        "createdAt": created_at,
        "createdAtIso": datetime.fromtimestamp(created_at, tz=get_timezone()).isoformat() if created_at > 0 else "",
        "closedAt": closed_at,
        "closedAtIso": datetime.fromtimestamp(closed_at, tz=get_timezone()).isoformat() if closed_at > 0 else "",
    }


def get_food_campaign_category_highlights(conn: sqlite3.Connection, campaign_id: str, limit: int = 3) -> List[Dict[str, Any]]:
    max_items = max(1, min(6, int(limit or 3)))
    rows = conn.execute(
        """
        SELECT f.category_key, COUNT(1) AS c, MIN(ca.slot_index) AS first_slot
        FROM food_campaign_candidates ca
        JOIN food_items f ON f.id=ca.food_id
        WHERE ca.campaign_id=?
        GROUP BY f.category_key
        ORDER BY first_slot ASC, c DESC, f.category_key ASC
        LIMIT ?
        """,
        (campaign_id, max_items),
    ).fetchall()
    category_rule_map = get_food_category_pricing_rule_map(conn)
    highlights: List[Dict[str, Any]] = []
    for row in rows:
        category_key = str(row["category_key"] or "").strip()
        if not category_key:
            continue
        category_name = str((category_rule_map.get(category_key) or {}).get("category_name", "")).strip() or category_key
        highlights.append(
            {
                "categoryKey": category_key,
                "categoryName": category_name,
                "count": normalize_int_value(row["c"], 0),
            }
        )
    return highlights


def get_food_campaign_vote_maps(
    conn: sqlite3.Connection,
    campaign_id: str,
) -> Tuple[Dict[int, int], Dict[str, List[int]]]:
    rows = conn.execute(
        """
        SELECT voter_student_id, selected_food_ids
        FROM food_campaign_ballots
        WHERE campaign_id=?
        """,
        (campaign_id,),
    ).fetchall()
    vote_count_map: Dict[int, int] = {}
    voter_map: Dict[str, List[int]] = {}
    for row in rows:
        voter_student_id = str(row["voter_student_id"] or "").strip()
        selected_food_ids = parse_food_id_list_from_json(row["selected_food_ids"])
        voter_map[voter_student_id] = selected_food_ids
        for food_id in selected_food_ids:
            vote_count_map[food_id] = vote_count_map.get(food_id, 0) + 1
    return vote_count_map, voter_map


def get_food_campaign_first_vote_map(conn: sqlite3.Connection, campaign_id: str) -> Dict[int, int]:
    rows = conn.execute(
        """
        SELECT food_id, MIN(created_at) AS first_vote_at
        FROM food_campaign_vote_events
        WHERE campaign_id=? AND delta>0
        GROUP BY food_id
        """,
        (campaign_id,),
    ).fetchall()
    result: Dict[int, int] = {}
    for row in rows:
        food_id = normalize_int_value(row["food_id"], 0)
        first_vote_at = normalize_int_value(row["first_vote_at"], FOOD_WINNER_DEFAULT_FIRST_VOTE_TS)
        if food_id <= 0:
            continue
        result[food_id] = first_vote_at
    return result


def list_food_campaign_ballot_rows(conn: sqlite3.Connection, campaign_id: str) -> List[Dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT voter_student_id, selected_food_ids, created_at, updated_at
        FROM food_campaign_ballots
        WHERE campaign_id=?
        ORDER BY updated_at DESC, id DESC
        """,
        (campaign_id,),
    ).fetchall()
    result: List[Dict[str, Any]] = []
    for row in rows:
        voter_student_id = normalize_student_id(row["voter_student_id"])
        if not voter_student_id or voter_student_id not in SCHEDULES:
            continue
        result.append(
            {
                "voterStudentId": voter_student_id,
                "selectedFoodIds": parse_food_id_list_from_json(row["selected_food_ids"]),
                "createdAt": normalize_int_value(row["created_at"], 0),
                "updatedAt": normalize_int_value(row["updated_at"], 0),
            }
        )
    return result


def rank_food_campaign_candidates(candidates: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return sorted(
        candidates,
        key=lambda item: (
            -normalize_int_value(item.get("voteCount"), 0),
            normalize_float_value(item.get("distanceKm"), 0.0),
            normalize_float_value(item.get("dynamicPriceMid"), 0.0),
            normalize_int_value(item.get("firstVoteAt"), FOOD_WINNER_DEFAULT_FIRST_VOTE_TS),
            normalize_int_value(item.get("id"), 0),
        ),
    )


def build_food_campaign_detail_payload(
    conn: sqlite3.Connection,
    campaign: Dict[str, Any],
    viewer_student_id: str,
    share_token_granted: bool = False,
    force_reveal_realname: bool = False,
) -> Dict[str, Any]:
    campaign_id = str(campaign.get("campaign_id", "")).strip()
    if not campaign_id:
        raise HTTPException(status_code=500, detail="竞选数据异常")
    headcount = get_food_campaign_vote_headcount(conn, campaign_id)
    category_rules = get_food_category_pricing_rule_map(conn)
    vote_count_map, voter_map = get_food_campaign_vote_maps(conn, campaign_id)
    first_vote_map = get_food_campaign_first_vote_map(conn, campaign_id)
    ballot_rows = list_food_campaign_ballot_rows(conn, campaign_id)
    candidates: List[Dict[str, Any]] = []
    candidate_rows = conn.execute(
        """
        SELECT c.food_id, c.slot_index, c.source, c.tier_id_snapshot, c.dynamic_price_min, c.dynamic_price_max, c.created_at,
               f.id, f.food_key, f.name, f.category_key, f.candidate_status, f.note, f.enabled, f.daily_price_min, f.daily_price_max, f.party_price_min, f.party_price_max, f.distance_km, f.strategy_override_json, f.created_by_student_id, f.approved_by_student_id, f.approved_at, f.created_at AS food_created_at, f.updated_at AS food_updated_at
        FROM food_campaign_candidates c
        JOIN food_items f ON f.id=c.food_id
        WHERE c.campaign_id=?
        ORDER BY c.slot_index ASC, c.id ASC
        """,
        (campaign_id,),
    ).fetchall()
    for row in candidate_rows:
        food_item = normalize_food_item_row(
            {
                "id": row["id"],
                "food_key": row["food_key"],
                "name": row["name"],
                "category_key": row["category_key"],
                "candidate_status": row["candidate_status"],
                "note": row["note"],
                "enabled": row["enabled"],
                "daily_price_min": row["daily_price_min"],
                "daily_price_max": row["daily_price_max"],
                "party_price_min": row["party_price_min"],
                "party_price_max": row["party_price_max"],
                "distance_km": row["distance_km"],
                "strategy_override_json": row["strategy_override_json"],
                "created_by_student_id": row["created_by_student_id"],
                "approved_by_student_id": row["approved_by_student_id"],
                "approved_at": row["approved_at"],
                "created_at": row["food_created_at"],
                "updated_at": row["food_updated_at"],
            }
        )
        payload = build_food_item_payload(
            food_item,
            template_key=str(campaign.get("template_key", FOOD_TEMPLATE_DAILY)),
            headcount=headcount,
            category_rules=category_rules,
        )
        food_id = int(payload.get("id", 0))
        payload.update(
            {
                "slotIndex": normalize_int_value(row["slot_index"], 0),
                "candidateSource": str(row["source"] or ""),
                "tierIdSnapshot": str(row["tier_id_snapshot"] or ""),
                "dynamicPriceMinSnapshot": normalize_float_value(row["dynamic_price_min"], 0.0),
                "dynamicPriceMaxSnapshot": normalize_float_value(row["dynamic_price_max"], 0.0),
                "voteCount": vote_count_map.get(food_id, 0),
                "firstVoteAt": first_vote_map.get(food_id, FOOD_WINNER_DEFAULT_FIRST_VOTE_TS),
            }
        )
        candidates.append(payload)
    ranked_candidates = rank_food_campaign_candidates(candidates)
    candidate_name_map = {int(item.get("id", 0)): str(item.get("name", "")) for item in candidates if int(item.get("id", 0)) > 0}
    participants: List[Dict[str, Any]] = []
    participant_rows = conn.execute(
        """
        SELECT student_id, source, approval_status, approved_by_student_id, approved_at, created_at, updated_at
        FROM food_campaign_participants
        WHERE campaign_id=?
        ORDER BY created_at ASC, id ASC
        """,
        (campaign_id,),
    ).fetchall()
    for row in participant_rows:
        student_id = str(row["student_id"] or "").strip()
        user_payload = build_social_user_payload(student_id, include_random_code=False, reveal_sensitive=True) if student_id else {}
        participants.append(
            {
                "studentId": student_id,
                "name": user_payload.get("name", student_id),
                "avatarUrl": user_payload.get("avatarUrl", ""),
                "source": str(row["source"] or ""),
                "approvalStatus": str(row["approval_status"] or FOOD_CAMPAIGN_PARTICIPANT_PENDING),
                "approvedByStudentId": str(row["approved_by_student_id"] or ""),
                "approvedAt": normalize_int_value(row["approved_at"], 0),
                "createdAt": normalize_int_value(row["created_at"], 0),
            }
        )
    viewer_participant = get_food_campaign_participant(conn, campaign_id, viewer_student_id)
    status = normalize_food_campaign_status(campaign.get("status"))
    is_open = status == FOOD_CAMPAIGN_STATUS_OPEN
    is_anonymous = bool(campaign.get("is_anonymous", 1))
    reveal_after_close = bool(campaign.get("reveal_after_close", 1))
    reveal_scope = normalize_food_campaign_reveal_scope(campaign.get("reveal_scope"))
    viewer_is_admin = bool(viewer_student_id) and is_user_admin(viewer_student_id)
    can_reveal_realname_vote_details = (
        force_reveal_realname
        or viewer_is_admin
        or (not is_anonymous)
        or (not is_open and reveal_after_close and reveal_scope == FOOD_REVEAL_SCOPE_SHARE_TOKEN and bool(share_token_granted))
    )
    vote_details_visibility = "none"
    if can_reveal_realname_vote_details:
        vote_details_visibility = "all"
    elif is_anonymous and is_open and bool(viewer_student_id):
        vote_details_visibility = "self"
    vote_details: List[Dict[str, Any]] = []
    if vote_details_visibility != "none":
        for ballot in ballot_rows:
            voter_student_id = str(ballot.get("voterStudentId", "")).strip()
            if vote_details_visibility == "self" and voter_student_id != viewer_student_id:
                continue
            user_payload = build_social_user_payload(voter_student_id, include_random_code=False, reveal_sensitive=True)
            selected_food_ids = [int(item) for item in ballot.get("selectedFoodIds", []) if int(item) > 0]
            vote_details.append(
                {
                    "voterStudentId": voter_student_id,
                    "voterName": user_payload.get("name", voter_student_id),
                    "voterAvatarUrl": user_payload.get("avatarUrl", ""),
                    "selectedFoodIds": selected_food_ids,
                    "selectedFoodNames": [candidate_name_map.get(food_id, f"食物#{food_id}") for food_id in selected_food_ids],
                    "createdAt": normalize_int_value(ballot.get("createdAt"), 0),
                    "updatedAt": normalize_int_value(ballot.get("updatedAt"), 0),
                }
            )
    can_vote = (
        is_open
        and viewer_participant is not None
        and str(viewer_participant.get("approval_status", "")) == FOOD_CAMPAIGN_PARTICIPANT_APPROVED
    )
    is_admin = viewer_is_admin
    is_initiator = str(campaign.get("initiator_student_id", "")).strip() == viewer_student_id
    can_manage = is_open and (is_initiator or is_admin)
    return {
        **build_food_campaign_summary_payload(campaign),
        "headcount": headcount,
        "viewerVoteFoodIds": voter_map.get(viewer_student_id, []),
        "voteDetailsVisibility": vote_details_visibility,
        "voteDetails": vote_details,
        "shareTokenGranted": bool(share_token_granted),
        "candidates": candidates,
        "rankedCandidates": ranked_candidates,
        "winner": ranked_candidates[0] if ranked_candidates else None,
        "participants": participants,
        "viewerParticipant": viewer_participant,
        "canVote": can_vote,
        "canApprove": can_manage,
        "canSupplement": can_manage and not bool(campaign.get("supplement_used")),
    }


def list_user_visible_food_campaigns(conn: sqlite3.Connection, student_id: str) -> List[Dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT DISTINCT c.*, p.approval_status AS viewer_approval_status
        FROM food_campaigns c
        LEFT JOIN food_campaign_participants p ON p.campaign_id=c.campaign_id AND p.student_id=?
        WHERE c.initiator_student_id=? OR p.student_id=?
        ORDER BY c.created_at DESC
        """,
        (student_id, student_id, student_id),
    ).fetchall()
    result: List[Dict[str, Any]] = []
    for row in rows:
        campaign = auto_close_food_campaign_if_needed(conn, dict(row))
        result.append(campaign)
    return result


def to_percentage(value: int, total: int) -> float:
    safe_total = max(0, int(total))
    if safe_total <= 0:
        return 0.0
    return round(float(value) * 100.0 / safe_total, 2)


def build_food_campaign_stats_payload(conn: sqlite3.Connection, student_id: str, recent_days: int = 30) -> Dict[str, Any]:
    normalized_days = max(1, min(90, int(recent_days or 30)))
    threshold_ts = int(time.time()) - normalized_days * 24 * 60 * 60
    visible_campaigns = list_user_visible_food_campaigns(conn, student_id)
    scoped_campaigns: List[Dict[str, Any]] = []
    for campaign in visible_campaigns:
        reference_ts = max(
            normalize_int_value(campaign.get("closed_at"), 0),
            normalize_int_value(campaign.get("deadline_at"), 0),
            normalize_int_value(campaign.get("created_at"), 0),
        )
        if reference_ts < threshold_ts:
            continue
        scoped_campaigns.append(campaign)

    if not scoped_campaigns:
        return {
            "recentDays": normalized_days,
            "campaignCount": 0,
            "activeCampaignCount": 0,
            "voterCount": 0,
            "selectionCount": 0,
            "mostSelectedFood": None,
            "mostSelectedCategory": None,
            "mostSelectedBrand": None,
            "topFoods": [],
            "topCategories": [],
            "topBrands": [],
        }

    campaign_ids = [str(item.get("campaign_id", "")).strip() for item in scoped_campaigns if str(item.get("campaign_id", "")).strip()]
    active_campaign_count = sum(
        1 for item in scoped_campaigns if normalize_food_campaign_status(item.get("status")) == FOOD_CAMPAIGN_STATUS_OPEN
    )
    placeholders = ",".join(["?"] * len(campaign_ids))
    ballot_rows = conn.execute(
        f"SELECT voter_student_id, selected_food_ids FROM food_campaign_ballots WHERE campaign_id IN ({placeholders})",
        tuple(campaign_ids),
    ).fetchall()
    voter_ids: set[str] = set()
    food_selection_counts: Dict[int, int] = {}
    for row in ballot_rows:
        voter_student_id = str(row["voter_student_id"] or "").strip()
        if voter_student_id:
            voter_ids.add(voter_student_id)
        for food_id in parse_food_id_list_from_json(row["selected_food_ids"]):
            food_selection_counts[food_id] = food_selection_counts.get(food_id, 0) + 1

    total_selection_count = sum(food_selection_counts.values())
    if not food_selection_counts:
        return {
            "recentDays": normalized_days,
            "campaignCount": len(campaign_ids),
            "activeCampaignCount": active_campaign_count,
            "voterCount": len(voter_ids),
            "selectionCount": 0,
            "mostSelectedFood": None,
            "mostSelectedCategory": None,
            "mostSelectedBrand": None,
            "topFoods": [],
            "topCategories": [],
            "topBrands": [],
        }

    food_ids = sorted(food_selection_counts.keys())
    food_meta_map: Dict[int, Dict[str, Any]] = {}
    if food_ids:
        food_placeholders = ",".join(["?"] * len(food_ids))
        food_rows = conn.execute(
            f"SELECT id, name, category_key, brand_key, brand_name FROM food_items WHERE id IN ({food_placeholders})",
            tuple(food_ids),
        ).fetchall()
        for row in food_rows:
            food_id = normalize_int_value(row["id"], 0)
            if food_id <= 0:
                continue
            food_meta_map[food_id] = {
                "name": str(row["name"] or ""),
                "categoryKey": str(row["category_key"] or "").strip(),
                "brandKey": normalize_food_brand_key(row["brand_key"]),
                "brandName": trim_profile_text(row["brand_name"], max_length=40),
            }

    category_rule_map = get_food_category_pricing_rule_map(conn)
    category_name_map = {
        key: str(value.get("category_name") or key)
        for key, value in category_rule_map.items()
        if key
    }

    food_items: List[Dict[str, Any]] = []
    category_selection_counts: Dict[str, int] = {}
    brand_selection_counts: Dict[str, int] = {}
    brand_name_map: Dict[str, str] = {}
    for food_id, count in food_selection_counts.items():
        if count <= 0:
            continue
        meta = food_meta_map.get(food_id, {})
        category_key = str(meta.get("categoryKey") or "").strip()
        brand_key = normalize_food_brand_key(meta.get("brandKey"))
        brand_name = trim_profile_text(meta.get("brandName"), max_length=40) or FOOD_BRAND_NAME_MAP.get(brand_key, brand_key)
        if category_key:
            category_selection_counts[category_key] = category_selection_counts.get(category_key, 0) + count
        if brand_key:
            brand_selection_counts[brand_key] = brand_selection_counts.get(brand_key, 0) + count
            brand_name_map[brand_key] = brand_name
        food_items.append(
            {
                "foodId": food_id,
                "name": str(meta.get("name") or f"食物#{food_id}"),
                "categoryKey": category_key,
                "categoryName": category_name_map.get(category_key, category_key or "未分类"),
                "brandKey": brand_key,
                "brandName": brand_name,
                "selectedCount": count,
                "ratio": to_percentage(count, total_selection_count),
            }
        )

    top_foods = sorted(food_items, key=lambda item: (-int(item.get("selectedCount", 0)), str(item.get("name", ""))))[:3]
    category_items: List[Dict[str, Any]] = []
    for category_key, count in category_selection_counts.items():
        category_items.append(
            {
                "categoryKey": category_key,
                "categoryName": category_name_map.get(category_key, category_key),
                "selectedCount": count,
                "ratio": to_percentage(count, total_selection_count),
            }
        )
    top_categories = sorted(
        category_items,
        key=lambda item: (-int(item.get("selectedCount", 0)), str(item.get("categoryName", ""))),
    )[:3]
    brand_items: List[Dict[str, Any]] = []
    for brand_key, count in brand_selection_counts.items():
        brand_items.append(
            {
                "brandKey": brand_key,
                "brandName": brand_name_map.get(brand_key, FOOD_BRAND_NAME_MAP.get(brand_key, brand_key)),
                "selectedCount": count,
                "ratio": to_percentage(count, total_selection_count),
            }
        )
    top_brands = sorted(
        brand_items,
        key=lambda item: (-int(item.get("selectedCount", 0)), str(item.get("brandName", ""))),
    )[:3]

    return {
        "recentDays": normalized_days,
        "campaignCount": len(campaign_ids),
        "activeCampaignCount": active_campaign_count,
        "voterCount": len(voter_ids),
        "selectionCount": total_selection_count,
        "mostSelectedFood": top_foods[0] if top_foods else None,
        "mostSelectedCategory": top_categories[0] if top_categories else None,
        "mostSelectedBrand": top_brands[0] if top_brands else None,
        "topFoods": top_foods,
        "topCategories": top_categories,
        "topBrands": top_brands,
    }


def require_food_campaign_read_permission(conn: sqlite3.Connection, campaign: Dict[str, Any], viewer_student_id: str) -> None:
    if is_user_admin(viewer_student_id):
        return
    if str(campaign.get("initiator_student_id", "")).strip() == viewer_student_id:
        return
    participant = get_food_campaign_participant(conn, str(campaign.get("campaign_id", "")).strip(), viewer_student_id)
    if participant:
        return
    raise HTTPException(status_code=403, detail="你未参与该食物竞选")


def require_food_campaign_manage_permission(conn: sqlite3.Connection, campaign: Dict[str, Any], viewer_student_id: str) -> None:
    if is_user_admin(viewer_student_id):
        return
    if str(campaign.get("initiator_student_id", "")).strip() == viewer_student_id:
        return
    raise HTTPException(status_code=403, detail="仅发起者可执行该操作")


def require_food_campaign_open(campaign: Dict[str, Any]) -> None:
    status = normalize_food_campaign_status(campaign.get("status"))
    if status != FOOD_CAMPAIGN_STATUS_OPEN:
        raise HTTPException(status_code=400, detail="该食物竞选已结束")


def apply_food_campaign_vote(
    conn: sqlite3.Connection,
    campaign_id: str,
    voter_student_id: str,
    selected_food_ids: List[int],
) -> None:
    now_ts = int(time.time())
    row = conn.execute(
        """
        SELECT selected_food_ids
        FROM food_campaign_ballots
        WHERE campaign_id=? AND voter_student_id=?
        LIMIT 1
        """,
        (campaign_id, voter_student_id),
    ).fetchone()
    previous = parse_food_id_list_from_json(row["selected_food_ids"]) if row else []
    previous_set = set(previous)
    next_set = set(selected_food_ids)
    removed = [food_id for food_id in previous if food_id not in next_set]
    added = [food_id for food_id in selected_food_ids if food_id not in previous_set]

    payload = json.dumps(selected_food_ids, ensure_ascii=False)
    if row:
        conn.execute(
            """
            UPDATE food_campaign_ballots
            SET selected_food_ids=?, updated_at=?
            WHERE campaign_id=? AND voter_student_id=?
            """,
            (payload, now_ts, campaign_id, voter_student_id),
        )
    else:
        conn.execute(
            """
            INSERT INTO food_campaign_ballots (campaign_id, voter_student_id, selected_food_ids, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (campaign_id, voter_student_id, payload, now_ts, now_ts),
        )
    for food_id in removed:
        conn.execute(
            """
            INSERT INTO food_campaign_vote_events (campaign_id, voter_student_id, food_id, delta, created_at)
            VALUES (?, ?, ?, -1, ?)
            """,
            (campaign_id, voter_student_id, int(food_id), now_ts),
        )
    for food_id in added:
        conn.execute(
            """
            INSERT INTO food_campaign_vote_events (campaign_id, voter_student_id, food_id, delta, created_at)
            VALUES (?, ?, ?, 1, ?)
            """,
            (campaign_id, voter_student_id, int(food_id), now_ts),
        )
    conn.execute(
        """
        UPDATE food_campaigns
        SET updated_at=?
        WHERE campaign_id=?
        """,
        (now_ts, campaign_id),
    )


def close_food_campaign(conn: sqlite3.Connection, campaign_id: str) -> None:
    now_ts = int(time.time())
    conn.execute(
        """
        UPDATE food_campaigns
        SET status=?, closed_at=?, updated_at=?
        WHERE campaign_id=?
        """,
        (FOOD_CAMPAIGN_STATUS_CLOSED, now_ts, now_ts, campaign_id),
    )


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    MEDIA_STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
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
              admin_role TEXT NOT NULL DEFAULT 'none',
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
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS classes (
              class_id TEXT PRIMARY KEY,
              class_label TEXT NOT NULL UNIQUE,
              current_code TEXT NOT NULL UNIQUE,
              active INTEGER NOT NULL DEFAULT 1,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS class_code_history (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              class_id TEXT NOT NULL,
              random_code TEXT NOT NULL,
              rotated_by_student_id TEXT NOT NULL DEFAULT '',
              is_active INTEGER NOT NULL DEFAULT 1,
              created_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_class_subscriptions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              subscriber_student_id TEXT NOT NULL,
              class_id TEXT NOT NULL,
              created_at INTEGER NOT NULL,
              UNIQUE(subscriber_student_id, class_id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS food_items (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              food_key TEXT NOT NULL UNIQUE,
              name TEXT NOT NULL,
              category_key TEXT NOT NULL,
              brand_key TEXT NOT NULL DEFAULT '',
              brand_name TEXT NOT NULL DEFAULT '',
              brand_combo TEXT NOT NULL DEFAULT '',
              candidate_status TEXT NOT NULL DEFAULT 'approved',
              note TEXT NOT NULL DEFAULT '',
              enabled INTEGER NOT NULL DEFAULT 1,
              daily_price_min REAL NOT NULL DEFAULT 0,
              daily_price_max REAL NOT NULL DEFAULT 0,
              party_price_min REAL NOT NULL DEFAULT 0,
              party_price_max REAL NOT NULL DEFAULT 0,
              distance_km REAL NOT NULL DEFAULT 0,
              strategy_override_json TEXT NOT NULL DEFAULT '{}',
              created_by_student_id TEXT NOT NULL DEFAULT '',
              approved_by_student_id TEXT NOT NULL DEFAULT '',
              approved_at INTEGER NOT NULL DEFAULT 0,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS food_category_pricing_rules (
              category_key TEXT PRIMARY KEY,
              category_name TEXT NOT NULL,
              trend_mode TEXT NOT NULL,
              anchor_headcount INTEGER NOT NULL,
              slope REAL NOT NULL,
              min_factor REAL NOT NULL,
              max_factor REAL NOT NULL,
              updated_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS food_campaigns (
              campaign_id TEXT PRIMARY KEY,
              title TEXT NOT NULL,
              initiator_student_id TEXT NOT NULL,
              template_key TEXT NOT NULL,
              selected_tier_ids TEXT NOT NULL,
              selected_category_keys TEXT NOT NULL DEFAULT '[]',
              selected_brand_keys TEXT NOT NULL DEFAULT '[]',
              max_votes_per_user INTEGER NOT NULL,
              deadline_at INTEGER NOT NULL,
              status TEXT NOT NULL,
              share_token TEXT NOT NULL UNIQUE,
              join_mode TEXT NOT NULL DEFAULT 'all',
              join_password_salt TEXT NOT NULL DEFAULT '',
              join_password_hash TEXT NOT NULL DEFAULT '',
              is_anonymous INTEGER NOT NULL DEFAULT 1,
              reveal_after_close INTEGER NOT NULL DEFAULT 1,
              reveal_scope TEXT NOT NULL DEFAULT 'share_token',
              supplement_used INTEGER NOT NULL DEFAULT 0,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              closed_at INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS food_category_pricing_rule_versions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              version_id TEXT NOT NULL,
              category_key TEXT NOT NULL,
              category_name TEXT NOT NULL,
              trend_mode TEXT NOT NULL,
              anchor_headcount INTEGER NOT NULL,
              slope REAL NOT NULL,
              min_factor REAL NOT NULL,
              max_factor REAL NOT NULL,
              operator_student_id TEXT NOT NULL DEFAULT '',
              created_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS food_item_pricing_override_versions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              version_id TEXT NOT NULL,
              food_key TEXT NOT NULL,
              strategy_override_json TEXT NOT NULL DEFAULT '{}',
              operator_student_id TEXT NOT NULL DEFAULT '',
              created_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS media_assets (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              file_name TEXT NOT NULL UNIQUE,
              usage TEXT NOT NULL,
              owner_scope TEXT NOT NULL DEFAULT 'system',
              owner_student_id TEXT NOT NULL DEFAULT '',
              media_url TEXT NOT NULL,
              mime_type TEXT NOT NULL,
              extension TEXT NOT NULL,
              size_bytes INTEGER NOT NULL,
              is_referenced INTEGER NOT NULL DEFAULT 0,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS food_campaign_participants (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              campaign_id TEXT NOT NULL,
              student_id TEXT NOT NULL,
              source TEXT NOT NULL,
              approval_status TEXT NOT NULL,
              approved_by_student_id TEXT NOT NULL DEFAULT '',
              approved_at INTEGER NOT NULL DEFAULT 0,
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              UNIQUE(campaign_id, student_id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS food_campaign_candidates (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              campaign_id TEXT NOT NULL,
              food_id INTEGER NOT NULL,
              slot_index INTEGER NOT NULL,
              source TEXT NOT NULL,
              tier_id_snapshot TEXT NOT NULL DEFAULT '',
              dynamic_price_min REAL NOT NULL DEFAULT 0,
              dynamic_price_max REAL NOT NULL DEFAULT 0,
              created_at INTEGER NOT NULL,
              UNIQUE(campaign_id, food_id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS food_campaign_ballots (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              campaign_id TEXT NOT NULL,
              voter_student_id TEXT NOT NULL,
              selected_food_ids TEXT NOT NULL DEFAULT '[]',
              created_at INTEGER NOT NULL,
              updated_at INTEGER NOT NULL,
              UNIQUE(campaign_id, voter_student_id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS food_campaign_vote_events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              campaign_id TEXT NOT NULL,
              voter_student_id TEXT NOT NULL,
              food_id INTEGER NOT NULL,
              delta INTEGER NOT NULL,
              created_at INTEGER NOT NULL
            )
            """
        )
        food_item_columns_before_index = {row[1] for row in conn.execute("PRAGMA table_info(food_items)").fetchall()}
        if "candidate_status" not in food_item_columns_before_index:
            conn.execute(f"ALTER TABLE food_items ADD COLUMN candidate_status TEXT NOT NULL DEFAULT '{FOOD_CANDIDATE_STATUS_APPROVED}'")
        if "brand_key" not in food_item_columns_before_index:
            conn.execute("ALTER TABLE food_items ADD COLUMN brand_key TEXT NOT NULL DEFAULT ''")
        if "brand_name" not in food_item_columns_before_index:
            conn.execute("ALTER TABLE food_items ADD COLUMN brand_name TEXT NOT NULL DEFAULT ''")
        if "brand_combo" not in food_item_columns_before_index:
            conn.execute("ALTER TABLE food_items ADD COLUMN brand_combo TEXT NOT NULL DEFAULT ''")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_food_items_enabled ON food_items(enabled)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_food_items_category ON food_items(category_key)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_food_items_brand ON food_items(brand_key)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_food_items_candidate_status ON food_items(candidate_status)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_food_campaigns_deadline ON food_campaigns(status, deadline_at)")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_food_campaign_participants_lookup ON food_campaign_participants(campaign_id, student_id, approval_status)"
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_food_campaign_candidates_campaign ON food_campaign_candidates(campaign_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_food_campaign_ballots_campaign ON food_campaign_ballots(campaign_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_food_campaign_vote_events_campaign ON food_campaign_vote_events(campaign_id, food_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_classes_label ON classes(class_label)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_class_code_history_class ON class_code_history(class_id, created_at)")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_user_class_subscriptions_subscriber ON user_class_subscriptions(subscriber_student_id, created_at)"
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_user_class_subscriptions_class ON user_class_subscriptions(class_id)")
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_food_rule_versions_category ON food_category_pricing_rule_versions(category_key, created_at)"
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_food_item_override_versions_food ON food_item_pricing_override_versions(food_key, created_at)"
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_media_assets_usage ON media_assets(usage, created_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_media_assets_referenced ON media_assets(is_referenced, created_at)")
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_user_profiles_student_no_unique ON user_profiles(student_no) WHERE TRIM(COALESCE(student_no, ''))<>''"
        )

        food_campaign_columns = {row[1] for row in conn.execute("PRAGMA table_info(food_campaigns)").fetchall()}
        if "join_mode" not in food_campaign_columns:
            conn.execute("ALTER TABLE food_campaigns ADD COLUMN join_mode TEXT NOT NULL DEFAULT 'all'")
        if "join_password_salt" not in food_campaign_columns:
            conn.execute("ALTER TABLE food_campaigns ADD COLUMN join_password_salt TEXT NOT NULL DEFAULT ''")
        if "join_password_hash" not in food_campaign_columns:
            conn.execute("ALTER TABLE food_campaigns ADD COLUMN join_password_hash TEXT NOT NULL DEFAULT ''")
        if "selected_category_keys" not in food_campaign_columns:
            conn.execute("ALTER TABLE food_campaigns ADD COLUMN selected_category_keys TEXT NOT NULL DEFAULT '[]'")
        if "selected_brand_keys" not in food_campaign_columns:
            conn.execute("ALTER TABLE food_campaigns ADD COLUMN selected_brand_keys TEXT NOT NULL DEFAULT '[]'")
        if "is_anonymous" not in food_campaign_columns:
            conn.execute("ALTER TABLE food_campaigns ADD COLUMN is_anonymous INTEGER NOT NULL DEFAULT 1")
        if "reveal_after_close" not in food_campaign_columns:
            conn.execute("ALTER TABLE food_campaigns ADD COLUMN reveal_after_close INTEGER NOT NULL DEFAULT 1")
        if "reveal_scope" not in food_campaign_columns:
            conn.execute(f"ALTER TABLE food_campaigns ADD COLUMN reveal_scope TEXT NOT NULL DEFAULT '{FOOD_REVEAL_SCOPE_SHARE_TOKEN}'")

        food_item_columns = {row[1] for row in conn.execute("PRAGMA table_info(food_items)").fetchall()}
        if "candidate_status" not in food_item_columns:
            conn.execute(f"ALTER TABLE food_items ADD COLUMN candidate_status TEXT NOT NULL DEFAULT '{FOOD_CANDIDATE_STATUS_APPROVED}'")
        if "note" not in food_item_columns:
            conn.execute("ALTER TABLE food_items ADD COLUMN note TEXT NOT NULL DEFAULT ''")
        if "brand_key" not in food_item_columns:
            conn.execute("ALTER TABLE food_items ADD COLUMN brand_key TEXT NOT NULL DEFAULT ''")
        if "brand_name" not in food_item_columns:
            conn.execute("ALTER TABLE food_items ADD COLUMN brand_name TEXT NOT NULL DEFAULT ''")
        if "brand_combo" not in food_item_columns:
            conn.execute("ALTER TABLE food_items ADD COLUMN brand_combo TEXT NOT NULL DEFAULT ''")
        if "created_by_student_id" not in food_item_columns:
            conn.execute("ALTER TABLE food_items ADD COLUMN created_by_student_id TEXT NOT NULL DEFAULT ''")
        if "approved_by_student_id" not in food_item_columns:
            conn.execute("ALTER TABLE food_items ADD COLUMN approved_by_student_id TEXT NOT NULL DEFAULT ''")
        if "approved_at" not in food_item_columns:
            conn.execute("ALTER TABLE food_items ADD COLUMN approved_at INTEGER NOT NULL DEFAULT 0")
        conn.execute(
            """
            UPDATE food_items
            SET candidate_status=?
            WHERE TRIM(COALESCE(candidate_status, ''))=''
            """,
            (FOOD_CANDIDATE_STATUS_APPROVED,),
        )
        for brand_key, brand_name in FOOD_BRAND_NAME_MAP.items():
            conn.execute(
                """
                UPDATE food_items
                SET brand_name=?
                WHERE brand_key=? AND TRIM(COALESCE(brand_name, ''))=''
                """,
                (brand_name, brand_key),
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
        if "admin_role" not in user_profile_columns:
            conn.execute(f"ALTER TABLE user_profiles ADD COLUMN admin_role TEXT NOT NULL DEFAULT '{ADMIN_ROLE_NONE}'")
        conn.execute(
            """
            UPDATE user_profiles
            SET admin_role=CASE
              WHEN is_admin=1 THEN ?
              ELSE ?
            END
            WHERE TRIM(COALESCE(admin_role, ''))=''
            """,
            (ADMIN_ROLE_OPERATOR, ADMIN_ROLE_NONE),
        )
        conn.execute(
            "UPDATE user_profiles SET admin_role=? WHERE student_id=? AND is_admin=1",
            (ADMIN_ROLE_SUPER_ADMIN, DEFAULT_ADMIN_STUDENT_ID),
        )
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

        seed_food_pricing_rules_if_empty(conn)
        seed_food_items_if_empty(conn)
        ensure_food_category_minimum_items(conn, min_count=10)
        seed_classes_from_schedules(conn)
        migrate_legacy_user_subscriptions_to_classes(conn)


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
    wecom_user_id = str(parsed.get("userid") or parsed.get("user_id") or "").strip()
    resolved_open_id = wecom_user_id or open_id
    if not resolved_open_id:
        raise HTTPException(status_code=502, detail="微信授权成功但 openid/userid 为空")
    return resolved_open_id, "wechat"


def build_auth_response_row(row: sqlite3.Row) -> Dict[str, Any]:
    student_id = str(row["student_id"] or "").strip()
    nickname = str(row["nickname"] or "").strip()
    schedule_name = str(SCHEDULES.get(student_id, {}).get("name") or "")
    class_label = str(SCHEDULES.get(student_id, {}).get("classLabel") or "")
    student_no = trim_profile_text(str(SCHEDULES.get(student_id, {}).get("studentNo") or ""), max_length=32)
    profile = get_user_profile_optional(student_id) if student_id else None
    if profile:
        student_no = trim_profile_text(str(profile.get("student_no", "")), max_length=32) or student_no
    return {
        "openId": row["open_id"],
        "studentId": student_id,
        "studentNo": student_no,
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


def clear_auth_session_student(token: str) -> None:
    if not token:
        return
    with db_connection() as conn:
        conn.execute(
            """
            UPDATE auth_sessions
            SET student_id='', updated_at=?
            WHERE token=?
            """,
            (int(time.time()), token),
        )


def get_wecom_binding_student(user_id: str) -> str:
    normalized_user_id = (user_id or "").strip()
    if not normalized_user_id:
        return ""
    channel_url = build_wecom_channel(normalized_user_id)
    with db_connection() as conn:
        row = conn.execute(
            """
            SELECT student_id
            FROM subscribers
            WHERE channel_url=? AND active=1
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            (channel_url,),
        ).fetchone()
    student_id = str(row["student_id"] if row else "").strip()
    if not student_id:
        return ""
    if student_id not in SCHEDULES:
        return ""
    if not get_user_profile_optional(student_id):
        return ""
    return student_id


def resolve_bound_student_for_open_id(open_id: str) -> str:
    normalized_open_id = (open_id or "").strip()
    if not normalized_open_id:
        return ""
    persisted_student_id = get_auth_binding_student(normalized_open_id)
    if persisted_student_id and not get_user_profile_optional(persisted_student_id):
        remove_auth_binding(normalized_open_id)
        persisted_student_id = ""
    if persisted_student_id:
        return persisted_student_id
    return get_wecom_binding_student(normalized_open_id)


def sync_auth_session_binding(session: Dict[str, Any]) -> Dict[str, Any]:
    token = str(session.get("token") or "").strip()
    open_id = str(session.get("openId") or "").strip()
    if not token or not open_id:
        return session
    current_student_id = str(session.get("studentId") or "").strip()
    resolved_student_id = resolve_bound_student_for_open_id(open_id)
    if resolved_student_id == current_student_id:
        return session
    if resolved_student_id:
        update_auth_session_student(token, resolved_student_id)
        set_auth_binding(open_id, resolved_student_id)
    else:
        clear_auth_session_student(token)
        remove_auth_binding(open_id)
    latest = get_auth_session_by_token(token)
    return latest or session


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
    return sync_auth_session_binding(session)


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
              admin_role,
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
              admin_role,
              student_no,
              notify_channel_url,
              avatar_url,
              wallpaper_url,
              practice_course_keys,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, '', '', '', '[]', ?, ?)
            """,
            (
                student_id,
                code,
                is_admin,
                ADMIN_ROLE_SUPER_ADMIN if is_admin else ADMIN_ROLE_NONE,
                schedule_student_no,
                now_ts,
                now_ts,
            ),
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
        if "avatar_url" in updates and str(updates.get("avatar_url", "")).strip():
            upsert_media_asset_for_url(
                conn=conn,
                media_url=updates.get("avatar_url"),
                usage="avatar",
                owner_scope="user_profile",
                owner_student_id=student_id,
                referenced=True,
            )
        if "wallpaper_url" in updates and str(updates.get("wallpaper_url", "")).strip():
            upsert_media_asset_for_url(
                conn=conn,
                media_url=updates.get("wallpaper_url"),
                usage="wallpaper",
                owner_scope="user_profile",
                owner_student_id=student_id,
                referenced=True,
            )
        reconcile_media_asset_references(conn)


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


def normalize_class_label(value: Any) -> str:
    return trim_profile_text(value, max_length=120)


def normalize_class_id(value: Any) -> str:
    return re.sub(r"[^a-z0-9_-]+", "", str(value or "").strip().lower())[:64]


def build_class_id_from_label(label: str) -> str:
    normalized = normalize_class_label(label)
    slug = re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")
    if not slug:
        slug = "class"
    digest = hashlib.sha1(normalized.encode("utf-8")).hexdigest()[:8]
    return normalize_class_id(f"{slug[:40]}-{digest}")


def normalize_class_code(value: Any) -> str:
    return re.sub(r"\D+", "", str(value or "").strip())[:CLASS_RANDOM_CODE_LENGTH]


def is_valid_class_code(value: str) -> bool:
    return bool(re.fullmatch(rf"\d{{{CLASS_RANDOM_CODE_LENGTH}}}", value or ""))


def class_code_exists(conn: sqlite3.Connection, code: str, exclude_class_id: str = "") -> bool:
    normalized = normalize_class_code(code)
    if not is_valid_class_code(normalized):
        return True
    sql = "SELECT 1 FROM classes WHERE current_code=?"
    params: List[Any] = [normalized]
    if exclude_class_id:
        sql += " AND class_id<>?"
        params.append(exclude_class_id)
    row = conn.execute(f"{sql} LIMIT 1", tuple(params)).fetchone()
    return bool(row)


def generate_unique_class_code(conn: sqlite3.Connection, exclude_class_id: str = "") -> str:
    for _ in range(CLASS_RANDOM_CODE_MAX_ATTEMPTS):
        value = f"{secrets.randbelow(CLASS_RANDOM_CODE_SPACE_SIZE):0{CLASS_RANDOM_CODE_LENGTH}d}"
        if not class_code_exists(conn, value, exclude_class_id=exclude_class_id):
            return value
    for number in range(CLASS_RANDOM_CODE_SPACE_SIZE):
        value = f"{number:0{CLASS_RANDOM_CODE_LENGTH}d}"
        if not class_code_exists(conn, value, exclude_class_id=exclude_class_id):
            return value
    raise RuntimeError("班级随机码已耗尽")


def get_student_class_label(student_id: str) -> str:
    ensure_student_exists(student_id)
    schedule = SCHEDULES.get(student_id, {})
    return normalize_class_label(schedule.get("classLabel"))


def get_class_by_id(conn: sqlite3.Connection, class_id: str) -> Optional[Dict[str, Any]]:
    normalized_class_id = normalize_class_id(class_id)
    if not normalized_class_id:
        return None
    row = conn.execute(
        """
        SELECT class_id, class_label, current_code, active, created_at, updated_at
        FROM classes
        WHERE class_id=?
        LIMIT 1
        """,
        (normalized_class_id,),
    ).fetchone()
    return dict(row) if row else None


def get_class_by_label(conn: sqlite3.Connection, class_label: str) -> Optional[Dict[str, Any]]:
    normalized = normalize_class_label(class_label)
    if not normalized:
        return None
    row = conn.execute(
        """
        SELECT class_id, class_label, current_code, active, created_at, updated_at
        FROM classes
        WHERE class_label=?
        LIMIT 1
        """,
        (normalized,),
    ).fetchone()
    return dict(row) if row else None


def get_class_by_code(conn: sqlite3.Connection, class_code: str) -> Optional[Dict[str, Any]]:
    normalized = normalize_class_code(class_code)
    if not is_valid_class_code(normalized):
        return None
    row = conn.execute(
        """
        SELECT class_id, class_label, current_code, active, created_at, updated_at
        FROM classes
        WHERE current_code=?
        LIMIT 1
        """,
        (normalized,),
    ).fetchone()
    return dict(row) if row else None


def ensure_class_for_label(
    conn: sqlite3.Connection,
    class_label: str,
    active: bool = True,
) -> Dict[str, Any]:
    normalized_label = normalize_class_label(class_label)
    if not normalized_label:
        raise HTTPException(status_code=400, detail="班级标签不能为空")
    existing = get_class_by_label(conn, normalized_label)
    if existing:
        if active and not bool(existing.get("active")):
            now_ts = int(time.time())
            conn.execute(
                "UPDATE classes SET active=1, updated_at=? WHERE class_id=?",
                (now_ts, existing["class_id"]),
            )
            existing["active"] = 1
            existing["updated_at"] = now_ts
        return existing
    now_ts = int(time.time())
    class_id = build_class_id_from_label(normalized_label)
    code = generate_unique_class_code(conn)
    conn.execute(
        """
        INSERT INTO classes (class_id, class_label, current_code, active, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (class_id, normalized_label, code, 1 if active else 0, now_ts, now_ts),
    )
    conn.execute(
        """
        INSERT INTO class_code_history (class_id, random_code, rotated_by_student_id, is_active, created_at)
        VALUES (?, ?, '', 1, ?)
        """,
        (class_id, code, now_ts),
    )
    created = get_class_by_id(conn, class_id)
    if not created:
        raise HTTPException(status_code=500, detail="创建班级失败")
    return created


def rotate_class_code(conn: sqlite3.Connection, class_id: str, actor_student_id: str = "") -> Dict[str, Any]:
    current = get_class_by_id(conn, class_id)
    if not current:
        raise HTTPException(status_code=404, detail="班级不存在")
    now_ts = int(time.time())
    next_code = generate_unique_class_code(conn, exclude_class_id=class_id)
    conn.execute("UPDATE classes SET current_code=?, updated_at=? WHERE class_id=?", (next_code, now_ts, class_id))
    conn.execute("UPDATE class_code_history SET is_active=0 WHERE class_id=?", (class_id,))
    conn.execute(
        """
        INSERT INTO class_code_history (class_id, random_code, rotated_by_student_id, is_active, created_at)
        VALUES (?, ?, ?, 1, ?)
        """,
        (class_id, next_code, trim_profile_text(actor_student_id, max_length=40), now_ts),
    )
    result = get_class_by_id(conn, class_id)
    if not result:
        raise HTTPException(status_code=500, detail="轮换随机码失败")
    return result


def subscribe_student_to_class(conn: sqlite3.Connection, subscriber_student_id: str, class_id: str) -> None:
    ensure_student_exists(subscriber_student_id)
    class_row = get_class_by_id(conn, class_id)
    if not class_row:
        raise HTTPException(status_code=404, detail="班级不存在")
    if not bool(class_row.get("active")):
        raise HTTPException(status_code=400, detail="班级已停用")
    conn.execute(
        """
        INSERT OR IGNORE INTO user_class_subscriptions (subscriber_student_id, class_id, created_at)
        VALUES (?, ?, ?)
        """,
        (subscriber_student_id, class_id, int(time.time())),
    )


def unsubscribe_student_from_class(conn: sqlite3.Connection, subscriber_student_id: str, class_id: str) -> None:
    conn.execute(
        """
        DELETE FROM user_class_subscriptions
        WHERE subscriber_student_id=? AND class_id=?
        """,
        (subscriber_student_id, normalize_class_id(class_id)),
    )


def list_class_member_student_ids(class_label: str) -> List[str]:
    normalized_label = normalize_class_label(class_label)
    if not normalized_label:
        return []
    members: List[str] = []
    for student_id, schedule in SCHEDULES.items():
        if normalize_class_label(schedule.get("classLabel")) != normalized_label:
            continue
        members.append(student_id)
    return members


def list_user_subscribed_class_rows(conn: sqlite3.Connection, subscriber_student_id: str) -> List[Dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT c.class_id, c.class_label, c.current_code, c.active, c.created_at, c.updated_at, s.created_at AS subscribed_at
        FROM user_class_subscriptions s
        JOIN classes c ON c.class_id=s.class_id
        WHERE s.subscriber_student_id=?
        ORDER BY s.created_at DESC, c.class_label ASC
        """,
        (subscriber_student_id,),
    ).fetchall()
    return [dict(row) for row in rows]


def list_user_subscribed_student_ids_from_classes(conn: sqlite3.Connection, subscriber_student_id: str) -> List[str]:
    rows = list_user_subscribed_class_rows(conn, subscriber_student_id)
    values: List[str] = []
    seen: set[str] = set()
    for row in rows:
        if not bool(row.get("active")):
            continue
        for student_id in list_class_member_student_ids(str(row.get("class_label", ""))):
            if student_id == subscriber_student_id:
                continue
            if student_id in seen:
                continue
            seen.add(student_id)
            values.append(student_id)
    return values


def list_subscriber_student_ids_for_target_class(conn: sqlite3.Connection, class_label: str) -> List[str]:
    class_row = get_class_by_label(conn, class_label)
    if not class_row:
        return []
    rows = conn.execute(
        """
        SELECT subscriber_student_id
        FROM user_class_subscriptions
        WHERE class_id=?
        ORDER BY created_at DESC
        """,
        (class_row["class_id"],),
    ).fetchall()
    result: List[str] = []
    for row in rows:
        student_id = normalize_student_id(row["subscriber_student_id"])
        if not student_id:
            continue
        if student_id in result:
            continue
        result.append(student_id)
    return result


def seed_classes_from_schedules(conn: sqlite3.Connection) -> None:
    labels: set[str] = set()
    for _, schedule in SCHEDULES.items():
        class_label = normalize_class_label(schedule.get("classLabel"))
        if not class_label:
            continue
        labels.add(class_label)
    for label in sorted(labels):
        ensure_class_for_label(conn, label, active=True)


def migrate_legacy_user_subscriptions_to_classes(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT value FROM app_settings WHERE key='migration_class_subscriptions' LIMIT 1",
    ).fetchone()
    if row and str(row[0] or "").strip() == CLASS_CODE_MIGRATION_VERSION:
        return
    rows = conn.execute(
        """
        SELECT subscriber_student_id, target_student_id
        FROM user_subscriptions
        ORDER BY id ASC
        """,
    ).fetchall()
    for row_item in rows:
        subscriber_student_id = normalize_student_id(row_item["subscriber_student_id"])
        target_student_id = normalize_student_id(row_item["target_student_id"])
        if not subscriber_student_id or not target_student_id:
            continue
        if subscriber_student_id not in SCHEDULES or target_student_id not in SCHEDULES:
            continue
        class_label = get_student_class_label(target_student_id)
        if not class_label:
            continue
        class_row = ensure_class_for_label(conn, class_label, active=True)
        subscribe_student_to_class(conn, subscriber_student_id, str(class_row["class_id"]))
    conn.execute(
        """
        INSERT INTO app_settings (key, value, updated_at)
        VALUES ('migration_class_subscriptions', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
        """,
        (CLASS_CODE_MIGRATION_VERSION, int(time.time())),
    )


def build_class_payload(conn: sqlite3.Connection, class_row: Dict[str, Any], with_members: bool = False) -> Dict[str, Any]:
    class_id = str(class_row.get("class_id", "")).strip()
    class_label = str(class_row.get("class_label", "")).strip()
    subscriber_row = conn.execute(
        "SELECT COUNT(1) AS c FROM user_class_subscriptions WHERE class_id=?",
        (class_id,),
    ).fetchone()
    member_ids = list_class_member_student_ids(class_label)
    payload: Dict[str, Any] = {
        "classId": class_id,
        "classLabel": class_label,
        "currentCode": str(class_row.get("current_code", "")).strip(),
        "active": bool(class_row.get("active")),
        "memberCount": len(member_ids),
        "subscriberCount": normalize_int_value(subscriber_row["c"] if subscriber_row else 0, 0),
        "createdAt": normalize_int_value(class_row.get("created_at"), 0),
        "updatedAt": normalize_int_value(class_row.get("updated_at"), 0),
    }
    if with_members:
        payload["members"] = [
            build_social_user_payload(student_id, include_random_code=False, reveal_sensitive=True)
            for student_id in member_ids
        ]
    return payload


def list_class_payloads(conn: sqlite3.Connection, include_inactive: bool = True) -> List[Dict[str, Any]]:
    where_clause = "" if include_inactive else "WHERE active=1"
    rows = conn.execute(
        f"""
        SELECT class_id, class_label, current_code, active, created_at, updated_at
        FROM classes
        {where_clause}
        ORDER BY active DESC, class_label ASC
        """
    ).fetchall()
    return [build_class_payload(conn, dict(row), with_members=False) for row in rows]


def get_user_subscriptions(student_id: str) -> List[str]:
    with db_connection() as conn:
        class_student_ids = list_user_subscribed_student_ids_from_classes(conn, student_id)
        rows = conn.execute(
            """
            SELECT target_student_id
            FROM user_subscriptions
            WHERE subscriber_student_id=?
            ORDER BY created_at DESC
            """,
            (student_id,),
        ).fetchall()
    result: List[str] = []
    for value in class_student_ids + [str(row["target_student_id"]) for row in rows]:
        normalized_value = normalize_student_id(value)
        if not normalized_value or normalized_value == student_id:
            continue
        if normalized_value in result:
            continue
        result.append(normalized_value)
    return result


def get_user_subscribers(student_id: str) -> List[str]:
    with db_connection() as conn:
        class_subscribers = list_subscriber_student_ids_for_target_class(conn, get_student_class_label(student_id))
        rows = conn.execute(
            """
            SELECT subscriber_student_id
            FROM user_subscriptions
            WHERE target_student_id=?
            ORDER BY created_at DESC
            """,
            (student_id,),
        ).fetchall()
    result: List[str] = []
    for value in class_subscribers + [str(row["subscriber_student_id"]) for row in rows]:
        normalized_value = normalize_student_id(value)
        if not normalized_value or normalized_value == student_id:
            continue
        if normalized_value in result:
            continue
        result.append(normalized_value)
    return result


def subscribe_student(subscriber_student_id: str, target_student_id: str) -> None:
    ensure_student_exists(subscriber_student_id)
    ensure_student_exists(target_student_id)
    if subscriber_student_id == target_student_id:
        raise HTTPException(status_code=400, detail="不能订阅自己")
    ensure_user_profile(subscriber_student_id)
    if not get_user_profile_optional(target_student_id):
        raise HTTPException(status_code=400, detail="对方尚未注册账号")
    with db_connection() as conn:
        class_label = get_student_class_label(target_student_id)
        class_row = ensure_class_for_label(conn, class_label, active=True)
        subscribe_student_to_class(conn, subscriber_student_id, str(class_row["class_id"]))
        conn.execute(
            """
            INSERT OR IGNORE INTO user_subscriptions (subscriber_student_id, target_student_id, created_at)
            VALUES (?, ?, ?)
            """,
            (subscriber_student_id, target_student_id, int(time.time())),
        )


def unsubscribe_student(subscriber_student_id: str, target_student_id: str) -> None:
    with db_connection() as conn:
        class_label = get_student_class_label(target_student_id)
        class_row = get_class_by_label(conn, class_label)
        if class_row:
            unsubscribe_student_from_class(conn, subscriber_student_id, str(class_row["class_id"]))
        conn.execute(
            """
            DELETE FROM user_subscriptions
            WHERE subscriber_student_id=? AND target_student_id=?
            """,
            (subscriber_student_id, target_student_id),
        )


def get_subscriber_key_for_student_notify(student_id: str) -> str:
    return f"mini-notify::{student_id}"


def unbind_notify_channel(student_id: str) -> None:
    subscriber_key = get_subscriber_key_for_student_notify(student_id)
    set_subscriber_active(subscriber_key, False)
    set_user_notify_channel(student_id, "")


def is_user_admin(student_id: str) -> bool:
    profile = ensure_user_profile(student_id)
    return bool(profile.get("is_admin"))


def get_user_admin_role(student_id: str) -> str:
    profile = ensure_user_profile(student_id)
    return normalize_admin_role(profile.get("admin_role"), bool(profile.get("is_admin")))


def is_user_super_admin(student_id: str) -> bool:
    return get_user_admin_role(student_id) == ADMIN_ROLE_SUPER_ADMIN


def set_user_admin_role(student_id: str, role: str) -> None:
    ensure_user_profile(student_id)
    normalized_role = normalize_admin_role(role, is_admin=True)
    with db_connection() as conn:
        conn.execute(
            """
            UPDATE user_profiles
            SET admin_role=?, is_admin=1, updated_at=?
            WHERE student_id=?
            """,
            (normalized_role, int(time.time()), student_id),
        )


def set_user_admin(student_id: str, is_admin: bool) -> None:
    ensure_user_profile(student_id)
    if not is_admin and count_admin_users() <= 1 and is_user_admin(student_id):
        raise HTTPException(status_code=400, detail="至少保留一个管理员")
    role = ADMIN_ROLE_NONE
    if is_admin:
        role = ADMIN_ROLE_SUPER_ADMIN if student_id == DEFAULT_ADMIN_STUDENT_ID else ADMIN_ROLE_OPERATOR
    with db_connection() as conn:
        conn.execute(
            """
            UPDATE user_profiles
            SET is_admin=?, admin_role=?, updated_at=?
            WHERE student_id=?
            """,
            (1 if is_admin else 0, role, int(time.time()), student_id),
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


def assert_student_no_available(conn: sqlite3.Connection, student_no: str, exclude_student_id: str = "") -> None:
    normalized = trim_profile_text(student_no, max_length=32)
    if not normalized:
        raise HTTPException(status_code=400, detail="student_no 不能为空")
    sql = "SELECT student_id FROM user_profiles WHERE student_no=?"
    params: List[Any] = [normalized]
    if exclude_student_id:
        sql += " AND student_id<>?"
        params.append(exclude_student_id)
    row = conn.execute(f"{sql} LIMIT 1", tuple(params)).fetchone()
    if row:
        raise HTTPException(status_code=409, detail=f"学号已被占用：{normalized}")


def set_user_student_no(student_id: str, student_no: str) -> None:
    ensure_user_profile(student_id)
    normalized = trim_profile_text(student_no, max_length=32)
    with db_connection() as conn:
        assert_student_no_available(conn, normalized, exclude_student_id=student_id)
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
        "adminRole": normalize_admin_role(profile.get("admin_role"), bool(profile.get("is_admin"))),
        "notifyBound": bool(str(profile.get("notify_channel_url", "")).strip()),
        "practiceCourseKeys": practice_course_keys,
    }


def build_social_dashboard_payload(student_id: str) -> Dict[str, Any]:
    viewer_is_admin = is_user_admin(student_id)
    subscribed_ids = get_user_subscriptions(student_id)
    subscribed_set = set(subscribed_ids)
    with db_connection() as conn:
        class_subscriptions = [build_class_payload(conn, row, with_members=False) for row in list_user_subscribed_class_rows(conn, student_id)]

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
        "classSubscriptions": class_subscriptions,
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


def has_wecom_user_student_binding(user_id: str, student_id: str) -> bool:
    normalized_user_id = (user_id or "").strip()
    normalized_student_id = (student_id or "").strip()
    if not normalized_user_id or not normalized_student_id:
        return False
    channel = build_wecom_channel(normalized_user_id)
    with db_connection() as conn:
        row = conn.execute(
            """
            SELECT 1
            FROM subscribers
            WHERE channel_url=? AND student_id=? AND active=1
            LIMIT 1
            """,
            (channel, normalized_student_id),
        ).fetchone()
    return row is not None


def resolve_student_by_bind_target_or_raise(target: str) -> Tuple[str, str]:
    student_id = resolve_student_id_for_bind_target(target)
    if not student_id:
        raise RuntimeError("未找到该姓名或学号，请发送正确的姓名或学号（如：蔡子菱 / 2305200133）")
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


def bind_wecom_user_to_student(user_id: str, target: str) -> Dict[str, Any]:
    student_id, canonical_name = resolve_student_by_bind_target_or_raise(target)
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


def sub_wecom_user_to_student(user_id: str, target: str) -> Dict[str, Any]:
    student_id, canonical_name = resolve_student_by_bind_target_or_raise(target)
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


def unsub_wecom_user_from_student(user_id: str, target: str) -> Tuple[int, str]:
    student_id, canonical_name = resolve_student_by_bind_target_or_raise(target)
    subscriber_key = f"wecom-{user_id.strip()}-{student_id}"
    with db_connection() as conn:
        conn.execute("DELETE FROM subscribers WHERE subscriber_key=?", (subscriber_key,))
    return len(get_wecom_user_subscribers(user_id, active_only=False)), canonical_name


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
        raise RuntimeError("你还没绑定课表，请先发送：bind 学号或姓名")
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
        raise RuntimeError("你还没绑定课表，请先发送：bind 学号或姓名")
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
        target = bind_match.group(1).strip()
        bound = bind_wecom_user_to_student(user_id, target)
        return f"已绑定：{build_bound_text(bound)}\n发送 sub 学号或姓名 可追加订阅。"

    sub_match = re.match(r"^sub\s+(.+)$", cmd, flags=re.IGNORECASE)
    if sub_match:
        target = sub_match.group(1).strip()
        bound = sub_wecom_user_to_student(user_id, target)
        return f"已追加订阅：{build_bound_text(bound)}\n{build_wecom_subscriptions_text(user_id)}"

    unsub_match = re.match(r"^unsub\s+(.+)$", cmd, flags=re.IGNORECASE)
    if unsub_match:
        target = unsub_match.group(1).strip()
        left, canonical_name = unsub_wecom_user_from_student(user_id, target)
        return f"已取消订阅：{canonical_name}\n剩余订阅 {left} 个。"

    if lowered == "subs":
        return build_wecom_subscriptions_text(user_id)

    if lowered == "offsets":
        primary = find_subscriber_by_wecom_userid(user_id)
        if not primary:
            return "你还没绑定课表，请先发送：bind 学号或姓名"
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
        target = (test_match.group(1) or "").strip()
        subscribers = get_wecom_user_subscribers(user_id, active_only=False)
        if not subscribers:
            return "你还没绑定课表，请先发送：bind 学号或姓名"
        target_sub = subscribers[0]
        if target:
            target_student_id, canonical_name = resolve_student_by_bind_target_or_raise(target)
            for sub in subscribers:
                if sub["student_id"] == target_student_id:
                    target_sub = sub
                    break
            else:
                return f"你尚未订阅 {canonical_name}，请先发送：sub {target}"
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
    ensure_schedule_csv_storage_ready()
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
        window.location.href = "/admin";
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
    textarea, input[type=text], select { width:100%; box-sizing:border-box; border:1px solid #d1d5db; border-radius:8px; padding:8px; font-size:14px; background:#fff; }
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
          <p class="header-sub">管理企业微信鉴权、小程序登录、用户资料与管理员权限、主题图片、食物竞选和推送文案模板。</p>
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
        <a id="tabBtn-wecom" class="btn tab-btn active" href="/admin-legacy/wecom" onclick="onTabLinkClick(event, 'wecom')">企业微信鉴权</a>
        <a id="tabBtn-users" class="btn tab-btn" href="/admin-legacy/users" onclick="onTabLinkClick(event, 'users')">用户管理</a>
        <a id="tabBtn-themes" class="btn tab-btn" href="/admin-legacy/themes" onclick="onTabLinkClick(event, 'themes')">主题图片</a>
        <a id="tabBtn-foods" class="btn tab-btn" href="/admin-legacy/foods" onclick="onTabLinkClick(event, 'foods')">食物竞选</a>
        <a id="tabBtn-templates" class="btn tab-btn" href="/admin-legacy/templates" onclick="onTabLinkClick(event, 'templates')">文案模板</a>
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

    <div id="tabPanel-foods" class="card tab-panel">
      <h2 style="margin:0 0 6px;">食物竞选管理</h2>
      <p class="muted">管理食物库、人数锚定定价规则与竞选监控（含强制截止）。</p>
      <div class="top-actions">
        <button class="btn gray" onclick="refreshFoods()">刷新食物数据</button>
      </div>
      <div id="foodMsg" class="muted" style="margin-top:8px;"></div>

      <div class="card" style="margin-top:12px; padding:12px;">
        <h3 style="margin:0 0 8px; font-size:16px;">食物库</h3>
        <div class="form-grid" style="margin-top:0;">
          <div>
            <label class="label" for="foodFormFoodKey">food_key</label>
            <input id="foodFormFoodKey" type="text" placeholder="例如：fried_rice" />
          </div>
          <div>
            <label class="label" for="foodFormName">名称</label>
            <input id="foodFormName" type="text" placeholder="例如：蛋炒饭" />
          </div>
          <div>
            <label class="label" for="foodFormCategoryKey">分类 key</label>
            <input id="foodFormCategoryKey" type="text" placeholder="例如：stir_fry" />
          </div>
          <div>
            <label class="label" for="foodFormCandidateStatus">候选状态</label>
            <select id="foodFormCandidateStatus">
              <option value="approved">approved（已通过）</option>
              <option value="pending_eat">pending_eat（待吃）</option>
              <option value="pending_review">pending_review（待审核）</option>
              <option value="rejected">rejected（已拒绝）</option>
            </select>
          </div>
          <div>
            <label class="label" for="foodFormDistanceKm">距离(km)</label>
            <input id="foodFormDistanceKm" type="text" placeholder="例如：1.6" />
          </div>
          <div>
            <label class="label" for="foodFormDailyMin">日常人均最小</label>
            <input id="foodFormDailyMin" type="text" placeholder="例如：12" />
          </div>
          <div>
            <label class="label" for="foodFormDailyMax">日常人均最大</label>
            <input id="foodFormDailyMax" type="text" placeholder="例如：15" />
          </div>
          <div>
            <label class="label" for="foodFormPartyMin">聚会人均最小</label>
            <input id="foodFormPartyMin" type="text" placeholder="例如：35" />
          </div>
          <div>
            <label class="label" for="foodFormPartyMax">聚会人均最大</label>
            <input id="foodFormPartyMax" type="text" placeholder="例如：45" />
          </div>
          <div style="grid-column:1 / -1;">
            <label class="label" for="foodFormOverrideJson">单品覆盖策略（JSON，可选）</label>
            <textarea id="foodFormOverrideJson" style="min-height:88px;" placeholder='例如：{"trend_mode":"increase","anchor_headcount":3,"slope":0.04,"min_factor":0.9,"max_factor":1.3}'></textarea>
          </div>
          <div style="grid-column:1 / -1;">
            <label class="label" for="foodFormNote">备注（可选）</label>
            <textarea id="foodFormNote" style="min-height:80px;" placeholder="例如：历史说明、门店变更、待吃备注"></textarea>
          </div>
        </div>
        <div class="top-actions">
          <label style="font-size:13px; display:flex; align-items:center; gap:6px;">
            <input id="foodFormEnabled" type="checkbox" checked />
            启用
          </label>
          <button class="btn" onclick="createFoodItem()">新增食物</button>
          <button class="btn gray" onclick="updateFoodItem()">更新当前 food_key</button>
          <button class="btn gray" onclick="resetFoodForm()">重置表单</button>
        </div>
        <table style="margin-top:10px;">
          <thead>
            <tr>
              <th style="width:120px;">food_key</th>
              <th style="width:120px;">名称</th>
              <th style="width:90px;">分类</th>
              <th style="width:100px;">候选状态</th>
              <th style="width:80px;">距离(km)</th>
              <th style="width:130px;">日常价</th>
              <th style="width:130px;">聚会价</th>
              <th style="width:80px;">状态</th>
              <th style="width:220px;">备注</th>
              <th style="width:260px;">操作</th>
            </tr>
          </thead>
          <tbody id="foodRows"></tbody>
        </table>
      </div>

      <div class="card" style="margin-top:12px; padding:12px;">
        <h3 style="margin:0 0 8px; font-size:16px;">分类定价锚定规则</h3>
        <p class="muted">规则字段：trend_mode(decrease|increase|flat)、anchor_headcount、slope、min_factor、max_factor</p>
        <div class="top-actions">
          <button class="btn gray" onclick="refreshFoodRules()">刷新规则</button>
        </div>
        <table style="margin-top:10px;">
          <thead>
            <tr>
              <th style="width:110px;">分类</th>
              <th style="width:110px;">名称</th>
              <th style="width:120px;">趋势</th>
              <th style="width:110px;">锚点人数</th>
              <th style="width:90px;">斜率</th>
              <th style="width:95px;">最小系数</th>
              <th style="width:95px;">最大系数</th>
              <th style="width:80px;">操作</th>
            </tr>
          </thead>
          <tbody id="foodRuleRows"></tbody>
        </table>
      </div>

      <div class="card" style="margin-top:12px; padding:12px;">
        <h3 style="margin:0 0 8px; font-size:16px;">竞选监控</h3>
        <div class="top-actions" style="align-items:center; flex-wrap:wrap;">
          <label class="label" for="foodCampaignStatusFilter" style="margin:0;">状态筛选</label>
          <select id="foodCampaignStatusFilter" onchange="refreshFoodCampaigns()">
            <option value="all" selected>全部</option>
            <option value="open">进行中</option>
            <option value="closed">已结束</option>
          </select>
          <button class="btn gray" onclick="refreshFoodCampaigns()">刷新竞选</button>
        </div>
        <table style="margin-top:10px;">
          <thead>
            <tr>
              <th style="width:160px;">竞选ID</th>
              <th style="width:130px;">标题</th>
              <th style="width:90px;">模板</th>
              <th style="width:110px;">发起者</th>
              <th style="width:80px;">人数</th>
              <th style="width:80px;">候选</th>
              <th style="width:80px;">状态</th>
              <th style="width:220px;">操作</th>
            </tr>
          </thead>
          <tbody id="foodCampaignRows"></tbody>
        </table>
        <div style="margin-top:10px;">
          <label class="label" for="foodCampaignDetail">竞选详情</label>
          <textarea id="foodCampaignDetail" style="min-height:220px;" readonly placeholder="点击“查看详情”后展示 JSON"></textarea>
        </div>
      </div>
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
    const TABS = ["wecom", "users", "themes", "foods", "templates"];
    const TAB_ROUTES = {
      wecom: "/admin-legacy/wecom",
      users: "/admin-legacy/users",
      themes: "/admin-legacy/themes",
      foods: "/admin-legacy/foods",
      templates: "/admin-legacy/templates"
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
      foods: [],
      foodRules: [],
      foodCampaigns: [],
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
      if (path === "/admin-legacy") return "wecom";
      if (!path.startsWith("/admin-legacy/")) return "";
      const segment = path.slice("/admin-legacy/".length).split("/")[0];
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
        const targetPath = TAB_ROUTES[tabName] || "/admin-legacy/wecom";
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
      const [templateData, wecomData, miniProgramData, themeImageData, adminUserData, foodData, foodRuleData, foodCampaignData, healthData] = await Promise.all([
        request("/api/settings/templates"),
        request("/api/settings/wecom"),
        request("/api/settings/mini-program"),
        request("/api/settings/theme-images"),
        request("/api/admin/users"),
        request("/api/admin/foods?include_disabled=1"),
        request("/api/admin/food-pricing-rules"),
        request("/api/admin/food-campaigns?status=all"),
        request("/health")
      ]);
      state.templates = templateData || {};
      state.wecom = wecomData || {};
      state.miniProgram = miniProgramData || {};
      state.runtime = healthData || {};
      state.themeImages = (themeImageData && themeImageData.images) || {};
      state.themeImageKeys = (themeImageData && themeImageData.themeKeys) || Object.keys(THEME_LABELS);
      state.users = (adminUserData && adminUserData.items) || [];
      state.foods = (foodData && foodData.items) || [];
      state.foodRules = (foodRuleData && foodRuleData.items) || [];
      state.foodCampaigns = (foodCampaignData && foodCampaignData.items) || [];
      state.usersCsvPath = String((adminUserData && adminUserData.csvPath) || "");
      renderRuntimeBadge();
      renderTemplates();
      renderWecom();
      renderMiniProgram();
      renderThemeImages();
      renderUsers();
      renderFoodItems();
      renderFoodRules();
      renderFoodCampaigns();
      setThemeImageMsg("主题图片列表已刷新", false);
      setUserMsg(`当前用户数：${state.users.length}，管理员：${state.users.filter(item => !!item.isAdmin).length}`, false);
      setFoodMsg(`食物 ${state.foods.length} 个，竞选 ${state.foodCampaigns.length} 场`, false);
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

    function setFoodMsg(text, isError) {
      const el = document.getElementById("foodMsg");
      if (!el) return;
      el.textContent = String(text || "");
      el.className = isError ? "err" : "ok";
    }

    function parseFoodNumberInput(inputId, label) {
      const raw = String((document.getElementById(inputId)?.value || "")).trim();
      const num = Number(raw);
      if (!Number.isFinite(num) || num < 0) {
        throw new Error(`${label} 必须是 >= 0 的数字`);
      }
      return num;
    }

    function collectFoodFormPayload(includeFoodKey = true) {
      const foodKey = String(document.getElementById("foodFormFoodKey")?.value || "").trim();
      const name = String(document.getElementById("foodFormName")?.value || "").trim();
      const categoryKey = String(document.getElementById("foodFormCategoryKey")?.value || "").trim();
      const candidateStatus = String(document.getElementById("foodFormCandidateStatus")?.value || "").trim() || "approved";
      if (includeFoodKey) {
        if (!foodKey) throw new Error("food_key 不能为空");
        if (!/^[a-z0-9_-]{2,40}$/.test(foodKey)) throw new Error("food_key 仅支持小写字母/数字/下划线/中划线，长度 2-40");
      }
      if (!name) throw new Error("名称不能为空");
      if (!categoryKey) throw new Error("分类 key 不能为空");
      if (!["approved", "pending_review", "pending_eat", "rejected"].includes(candidateStatus)) {
        throw new Error("候选状态非法");
      }
      const dailyMin = parseFoodNumberInput("foodFormDailyMin", "日常人均最小");
      const dailyMax = parseFoodNumberInput("foodFormDailyMax", "日常人均最大");
      const partyMin = parseFoodNumberInput("foodFormPartyMin", "聚会人均最小");
      const partyMax = parseFoodNumberInput("foodFormPartyMax", "聚会人均最大");
      const distanceKm = parseFoodNumberInput("foodFormDistanceKm", "距离(km)");
      if (dailyMax < dailyMin) throw new Error("日常人均最大不能小于最小");
      if (partyMax < partyMin) throw new Error("聚会人均最大不能小于最小");
      const overrideText = String(document.getElementById("foodFormOverrideJson")?.value || "").trim();
      let strategyOverrideJson = null;
      if (overrideText) {
        try {
          const parsed = JSON.parse(overrideText);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("覆盖策略必须是 JSON 对象");
          }
          strategyOverrideJson = parsed;
        } catch (error) {
          throw new Error("单品覆盖策略 JSON 格式非法");
        }
      }
      const payload = {
        name,
        category_key: categoryKey,
        candidate_status: candidateStatus,
        note: String(document.getElementById("foodFormNote")?.value || "").trim(),
        daily_price_min: dailyMin,
        daily_price_max: dailyMax,
        party_price_min: partyMin,
        party_price_max: partyMax,
        distance_km: distanceKm,
        enabled: Boolean(document.getElementById("foodFormEnabled")?.checked),
      };
      if (strategyOverrideJson) {
        payload.strategy_override_json = strategyOverrideJson;
      }
      if (includeFoodKey) {
        payload.food_key = foodKey;
      }
      return payload;
    }

    function resetFoodForm() {
      const setValue = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = String(value);
      };
      setValue("foodFormFoodKey", "");
      setValue("foodFormName", "");
      setValue("foodFormCategoryKey", "");
      setValue("foodFormCandidateStatus", "approved");
      setValue("foodFormDistanceKm", "");
      setValue("foodFormDailyMin", "");
      setValue("foodFormDailyMax", "");
      setValue("foodFormPartyMin", "");
      setValue("foodFormPartyMax", "");
      setValue("foodFormOverrideJson", "");
      setValue("foodFormNote", "");
      const enabled = document.getElementById("foodFormEnabled");
      if (enabled) enabled.checked = true;
    }

    function fillFoodForm(item) {
      if (!item) return;
      const setValue = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = String(value ?? "");
      };
      setValue("foodFormFoodKey", item.foodKey || "");
      setValue("foodFormName", item.name || "");
      setValue("foodFormCategoryKey", item.categoryKey || "");
      setValue("foodFormCandidateStatus", item.candidateStatus || "approved");
      setValue("foodFormDistanceKm", item.distanceKm ?? "");
      setValue("foodFormDailyMin", item.dailyPriceMin ?? "");
      setValue("foodFormDailyMax", item.dailyPriceMax ?? "");
      setValue("foodFormPartyMin", item.partyPriceMin ?? "");
      setValue("foodFormPartyMax", item.partyPriceMax ?? "");
      setValue("foodFormOverrideJson", item.strategyOverride ? JSON.stringify(item.strategyOverride, null, 2) : "");
      setValue("foodFormNote", item.note || "");
      const enabled = document.getElementById("foodFormEnabled");
      if (enabled) enabled.checked = Boolean(item.enabled);
    }

    function renderFoodItems() {
      const rows = Array.isArray(state.foods) ? state.foods : [];
      const el = document.getElementById("foodRows");
      if (!el) return;
      if (!rows.length) {
        el.innerHTML = '<tr><td colspan="10" class="muted">暂无食物数据</td></tr>';
        return;
      }
      el.innerHTML = rows.map((item, index) => {
        const enabled = Boolean(item.enabled);
        const candidateStatus = String(item.candidateStatus || "approved");
        const candidateStatusLabel = String(item.candidateStatusLabel || candidateStatus || "-");
        const canReview = candidateStatus === "pending_review";
        return `
          <tr>
            <td>${escapeHtml(item.foodKey || "-")}</td>
            <td>${escapeHtml(item.name || "-")}</td>
            <td>${escapeHtml(item.categoryKey || "-")}</td>
            <td>${escapeHtml(candidateStatusLabel)}<span class="muted">(${escapeHtml(candidateStatus)})</span></td>
            <td>${Number(item.distanceKm || 0).toFixed(2)}</td>
            <td>${Number(item.dailyPriceMin || 0).toFixed(2)} ~ ${Number(item.dailyPriceMax || 0).toFixed(2)}</td>
            <td>${Number(item.partyPriceMin || 0).toFixed(2)} ~ ${Number(item.partyPriceMax || 0).toFixed(2)}</td>
            <td>${enabled ? "启用" : "停用"}</td>
            <td>${escapeHtml(item.note || "-")}</td>
            <td>
              <button class="btn gray" onclick="openEditFood(${index})">编辑</button>
              <button class="btn gray" onclick="toggleFoodItemActive(${index})">${enabled ? "停用" : "启用"}</button>
              <button class="btn gray" onclick="reviewFoodItem(${index}, 'approved')" ${canReview ? "" : "disabled"}>审核通过</button>
              <button class="btn gray" onclick="reviewFoodItem(${index}, 'rejected')" ${canReview ? "" : "disabled"}>拒绝</button>
            </td>
          </tr>
        `;
      }).join("");
    }

    async function reviewFoodItem(index, candidateStatus) {
      const item = (state.foods || [])[index];
      if (!item || !item.foodKey) {
        setFoodMsg("食物不存在，请刷新后重试", true);
        return;
      }
      try {
        await request(`/api/admin/foods/${encodeURIComponent(item.foodKey)}/review`, {
          method: "POST",
          body: JSON.stringify({ candidate_status: String(candidateStatus || "") }),
        });
        await refreshFoods();
        const statusTextMap = {
          approved: "已通过",
          rejected: "已拒绝",
          pending_review: "待审核",
          pending_eat: "待吃",
        };
        const statusLabel = statusTextMap[String(candidateStatus || "")] || String(candidateStatus || "");
        setFoodMsg(`审核状态已更新：${item.name || item.foodKey} -> ${statusLabel}`, false);
      } catch (e) {
        setFoodMsg(String(e.message || e), true);
      }
    }

    async function createFoodItem() {
      try {
        const payload = collectFoodFormPayload(true);
        await request("/api/admin/foods", { method: "POST", body: JSON.stringify(payload) });
        await refreshFoods();
        setFoodMsg("食物新增成功", false);
      } catch (e) {
        setFoodMsg(String(e.message || e), true);
      }
    }

    async function updateFoodItem() {
      const foodKey = String(document.getElementById("foodFormFoodKey")?.value || "").trim();
      if (!foodKey) {
        setFoodMsg("请先填写 food_key 再更新", true);
        return;
      }
      try {
        const payload = collectFoodFormPayload(false);
        await request(`/api/admin/foods/${encodeURIComponent(foodKey)}`, { method: "PUT", body: JSON.stringify(payload) });
        await refreshFoods();
        setFoodMsg("食物更新成功", false);
      } catch (e) {
        setFoodMsg(String(e.message || e), true);
      }
    }

    function openEditFood(index) {
      const item = (state.foods || [])[index];
      if (!item) {
        setFoodMsg("食物不存在，请刷新后重试", true);
        return;
      }
      fillFoodForm(item);
      setFoodMsg(`已载入食物：${item.name || item.foodKey}`, false);
    }

    async function toggleFoodItemActive(index) {
      const item = (state.foods || [])[index];
      if (!item || !item.foodKey) {
        setFoodMsg("食物不存在，请刷新后重试", true);
        return;
      }
      try {
        await request(`/api/admin/foods/${encodeURIComponent(item.foodKey)}/active`, {
          method: "POST",
          body: JSON.stringify({ enabled: !Boolean(item.enabled) }),
        });
        await refreshFoods();
        setFoodMsg(`已${Boolean(item.enabled) ? "停用" : "启用"}：${item.name || item.foodKey}`, false);
      } catch (e) {
        setFoodMsg(String(e.message || e), true);
      }
    }

    function renderFoodRules() {
      const rows = Array.isArray(state.foodRules) ? state.foodRules : [];
      const el = document.getElementById("foodRuleRows");
      if (!el) return;
      if (!rows.length) {
        el.innerHTML = '<tr><td colspan="8" class="muted">暂无分类规则</td></tr>';
        return;
      }
      el.innerHTML = rows.map((item) => {
        const categoryKey = String(item.category_key || item.categoryKey || "").trim();
        const safeKey = categoryKey.replace(/[^a-zA-Z0-9_-]/g, "_");
        const encoded = encodeURIComponent(categoryKey);
        return `
          <tr>
            <td>${escapeHtml(categoryKey)}</td>
            <td><input id="foodRuleName-${safeKey}" type="text" value="${escapeHtml(item.category_name || item.categoryName || "")}" /></td>
            <td>
              <select id="foodRuleTrend-${safeKey}">
                <option value="decrease" ${String(item.trend_mode || item.trendMode) === "decrease" ? "selected" : ""}>decrease</option>
                <option value="increase" ${String(item.trend_mode || item.trendMode) === "increase" ? "selected" : ""}>increase</option>
                <option value="flat" ${String(item.trend_mode || item.trendMode) === "flat" ? "selected" : ""}>flat</option>
              </select>
            </td>
            <td><input id="foodRuleAnchor-${safeKey}" type="text" value="${escapeHtml(item.anchor_headcount ?? item.anchorHeadcount ?? 4)}" /></td>
            <td><input id="foodRuleSlope-${safeKey}" type="text" value="${escapeHtml(item.slope ?? 0)}" /></td>
            <td><input id="foodRuleMin-${safeKey}" type="text" value="${escapeHtml(item.min_factor ?? item.minFactor ?? 0.75)}" /></td>
            <td><input id="foodRuleMax-${safeKey}" type="text" value="${escapeHtml(item.max_factor ?? item.maxFactor ?? 1.45)}" /></td>
            <td><button class="btn gray" onclick="saveFoodRule('${encoded}')">保存</button></td>
          </tr>
        `;
      }).join("");
    }

    async function saveFoodRule(encodedCategoryKey) {
      const categoryKey = decodeURIComponent(String(encodedCategoryKey || ""));
      const safeKey = categoryKey.replace(/[^a-zA-Z0-9_-]/g, "_");
      const parseNumber = (id, name) => {
        const num = Number(String(document.getElementById(id)?.value || "").trim());
        if (!Number.isFinite(num)) throw new Error(`${name} 必须是数字`);
        return num;
      };
      try {
        const payload = {
          items: [
            {
              category_key: categoryKey,
              category_name: String(document.getElementById(`foodRuleName-${safeKey}`)?.value || "").trim(),
              trend_mode: String(document.getElementById(`foodRuleTrend-${safeKey}`)?.value || "").trim(),
              anchor_headcount: parseInt(String(parseNumber(`foodRuleAnchor-${safeKey}`, "锚点人数")), 10),
              slope: parseNumber(`foodRuleSlope-${safeKey}`, "斜率"),
              min_factor: parseNumber(`foodRuleMin-${safeKey}`, "最小系数"),
              max_factor: parseNumber(`foodRuleMax-${safeKey}`, "最大系数"),
            },
          ],
        };
        if (!payload.items[0].category_name) throw new Error("分类名称不能为空");
        const data = await request("/api/admin/food-pricing-rules", { method: "POST", body: JSON.stringify(payload) });
        state.foodRules = (data && data.items) || [];
        renderFoodRules();
        setFoodMsg(`分类规则已保存：${categoryKey}`, false);
      } catch (e) {
        setFoodMsg(String(e.message || e), true);
      }
    }

    function renderFoodCampaigns() {
      const rows = Array.isArray(state.foodCampaigns) ? state.foodCampaigns : [];
      const el = document.getElementById("foodCampaignRows");
      if (!el) return;
      if (!rows.length) {
        el.innerHTML = '<tr><td colspan="8" class="muted">暂无竞选数据</td></tr>';
        return;
      }
      el.innerHTML = rows.map((item) => {
        const campaignId = String(item.campaignId || "").trim();
        const status = String(item.status || "").trim();
        const open = status === "open";
        return `
          <tr>
            <td>${escapeHtml(campaignId)}</td>
            <td>${escapeHtml(item.title || "-")}</td>
            <td>${escapeHtml(item.templateKey || "-")}</td>
            <td>${escapeHtml(item.initiatorStudentId || "-")}</td>
            <td>${Number(item.headcount || 0)}</td>
            <td>${Number(item.candidateCount || 0)}</td>
            <td>${escapeHtml(status || "-")}</td>
            <td>
              <button class="btn gray" onclick="viewFoodCampaignDetail('${escapeHtml(campaignId)}')">查看详情</button>
              <button class="btn gray" onclick="forceCloseFoodCampaign('${escapeHtml(campaignId)}')" ${open ? "" : "disabled"}>强制截止</button>
            </td>
          </tr>
        `;
      }).join("");
    }

    async function viewFoodCampaignDetail(campaignId) {
      const id = String(campaignId || "").trim();
      if (!id) return;
      try {
        const data = await request(`/api/admin/food-campaigns/${encodeURIComponent(id)}`);
        const editor = document.getElementById("foodCampaignDetail");
        if (editor) {
          editor.value = JSON.stringify((data && data.campaign) || {}, null, 2);
        }
        setFoodMsg(`已加载竞选详情：${id}`, false);
      } catch (e) {
        setFoodMsg(String(e.message || e), true);
      }
    }

    async function forceCloseFoodCampaign(campaignId) {
      const id = String(campaignId || "").trim();
      if (!id) return;
      if (!window.confirm(`确认强制截止竞选 ${id} 吗？`)) {
        return;
      }
      try {
        await request(`/api/admin/food-campaigns/${encodeURIComponent(id)}/force-close`, { method: "POST" });
        await refreshFoodCampaigns();
        await viewFoodCampaignDetail(id);
        setFoodMsg(`已强制截止：${id}`, false);
      } catch (e) {
        setFoodMsg(String(e.message || e), true);
      }
    }

    async function refreshFoodRules() {
      try {
        const data = await request("/api/admin/food-pricing-rules");
        state.foodRules = (data && data.items) || [];
        renderFoodRules();
        setFoodMsg("分类规则已刷新", false);
      } catch (e) {
        setFoodMsg(String(e.message || e), true);
      }
    }

    async function refreshFoodCampaigns() {
      const filterValue = String(document.getElementById("foodCampaignStatusFilter")?.value || "all").trim() || "all";
      try {
        const data = await request(`/api/admin/food-campaigns?status=${encodeURIComponent(filterValue)}`);
        state.foodCampaigns = (data && data.items) || [];
        renderFoodCampaigns();
        setFoodMsg(`竞选列表已刷新（${filterValue}）`, false);
      } catch (e) {
        setFoodMsg(String(e.message || e), true);
      }
    }

    async function refreshFoods() {
      const filterValue = String(document.getElementById("foodCampaignStatusFilter")?.value || "all").trim() || "all";
      try {
        const [foodData, ruleData, campaignData] = await Promise.all([
          request("/api/admin/foods?include_disabled=1"),
          request("/api/admin/food-pricing-rules"),
          request(`/api/admin/food-campaigns?status=${encodeURIComponent(filterValue)}`),
        ]);
        state.foods = (foodData && foodData.items) || [];
        state.foodRules = (ruleData && ruleData.items) || [];
        state.foodCampaigns = (campaignData && campaignData.items) || [];
        renderFoodItems();
        renderFoodRules();
        renderFoodCampaigns();
        const pendingReviewCount = state.foods.filter((item) => String(item.candidateStatus || "") === "pending_review").length;
        setFoodMsg(`食物 ${state.foods.length} 个（待审核 ${pendingReviewCount}），规则 ${state.foodRules.length} 条，竞选 ${state.foodCampaigns.length} 场`, false);
      } catch (e) {
        setFoodMsg(String(e.message || e), true);
      }
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
        return RedirectResponse(url="/admin", status_code=302)
    return RedirectResponse(url="/login", status_code=302)


def build_admin_spa_missing_html() -> str:
    return """<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>TouchX Admin</title>
  <style>
    body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; background:#f4f6fb; color:#0f172a; }
    .wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px; box-sizing:border-box; }
    .card { width:min(92vw,560px); border:1px solid #e5e7eb; border-radius:14px; background:#fff; padding:22px; }
    h1 { margin:0 0 10px; font-size:22px; }
    p { margin:8px 0; color:#475569; line-height:1.6; }
    a { color:#2563eb; text-decoration:none; }
    code { background:#f1f5f9; border-radius:6px; padding:2px 6px; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>Vue 管理后台尚未构建</h1>
      <p>未找到 <code>backends/legacy-fastapi/admin_dist/index.html</code>。</p>
      <p>请在仓库根目录执行 <code>pnpm admin:build</code> 后刷新。</p>
      <p>你也可以先使用旧版后台：<a href="/admin-legacy/wecom">/admin-legacy/wecom</a></p>
    </div>
  </div>
</body>
</html>"""


def resolve_admin_dist_asset_path(asset_path: str) -> Path:
    normalized = str(asset_path or "").strip().lstrip("/")
    if not normalized:
        return (ADMIN_DIST_DIR / "index.html").resolve()
    candidate = (ADMIN_DIST_DIR / normalized).resolve()
    try:
        candidate.relative_to(ADMIN_DIST_DIR.resolve())
    except ValueError as error:
        raise HTTPException(status_code=404, detail="资源不存在") from error
    return candidate


@app.get("/admin", response_class=HTMLResponse)
@app.get("/admin/{asset_path:path}", response_class=HTMLResponse)
def admin_spa_page(asset_path: str = ""):
    index_path = (ADMIN_DIST_DIR / "index.html").resolve()
    if not index_path.exists():
        return HTMLResponse(build_admin_spa_missing_html(), status_code=503)

    candidate = resolve_admin_dist_asset_path(asset_path)
    if asset_path and candidate.exists() and candidate.is_file():
        return FileResponse(candidate)

    asset_name = Path(str(asset_path or "")).name
    if asset_name and "." in asset_name:
        raise HTTPException(status_code=404, detail="资源不存在")
    return FileResponse(index_path)


@app.get("/admin-legacy", response_class=HTMLResponse)
def admin_legacy_page() -> HTMLResponse:
    return RedirectResponse(url="/admin-legacy/wecom", status_code=302)


@app.get("/admin-legacy/{tab_name}", response_class=HTMLResponse)
def admin_legacy_page_with_tab(tab_name: str) -> HTMLResponse:
    normalized = (tab_name or "").strip().lower()
    if normalized not in ADMIN_SECOND_LEVEL_TABS:
        raise HTTPException(status_code=404, detail="页面不存在")
    return HTMLResponse(build_admin_html())


@app.get("/login", response_class=HTMLResponse)
def admin_login_page(request: Request):
    if is_admin_authenticated(request):
        return RedirectResponse(url="/admin", status_code=302)
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
    persisted_student_id = resolve_bound_student_for_open_id(open_id)
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
            "studentNo": session.get("studentNo", ""),
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
            "studentNo": session.get("studentNo", ""),
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
    clear_wecom_subscriptions(open_id)
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
    open_id = str(session.get("openId") or "").strip()
    if not student_id:
        candidates = [
            build_social_user_payload(other_id, include_random_code=False, reveal_sensitive=False)
            for other_id in SCHEDULES.keys()
        ]
        return {
            "ok": True,
            "me": None,
            "classSubscriptions": [],
            "subscriptions": [],
            "subscribers": [],
            "candidates": candidates,
            "bound": False,
        }
    payload = build_social_dashboard_payload(student_id)
    me_payload = payload.get("me")
    if isinstance(me_payload, dict):
        me_payload["notifyBound"] = bool(me_payload.get("notifyBound")) or has_wecom_user_student_binding(open_id, student_id)
    return {"ok": True, **payload, "bound": True}


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


@app.get("/api/social/classes/subscriptions")
def social_list_class_subscriptions(request: Request) -> Dict[str, Any]:
    session = require_auth_session(request)
    student_id = require_bound_student_id(session)
    with db_connection() as conn:
        rows = list_user_subscribed_class_rows(conn, student_id)
        items = [build_class_payload(conn, row, with_members=True) for row in rows]
    return {"ok": True, "items": items}


@app.post("/api/social/classes/subscribe-by-code")
def social_subscribe_class_by_code(body: SocialSubscribeClassByCodeRequest, request: Request) -> Dict[str, Any]:
    session = require_auth_session(request)
    student_id = require_bound_student_id(session)
    class_code = normalize_class_code(body.class_code)
    if not is_valid_class_code(class_code):
        raise HTTPException(status_code=400, detail=f"班级随机码必须是 {CLASS_RANDOM_CODE_LENGTH} 位数字")
    with db_connection() as conn:
        class_row = get_class_by_code(conn, class_code)
        if not class_row:
            raise HTTPException(status_code=404, detail="班级随机码无效")
        if not bool(class_row.get("active")):
            raise HTTPException(status_code=400, detail="班级已停用")
        subscribe_student_to_class(conn, student_id, str(class_row["class_id"]))
        payload = build_class_payload(conn, class_row, with_members=True)
    return {"ok": True, "item": payload}


@app.post("/api/social/classes/unsubscribe")
def social_unsubscribe_class(body: SocialUnsubscribeClassRequest, request: Request) -> Dict[str, Any]:
    session = require_auth_session(request)
    student_id = require_bound_student_id(session)
    class_id = normalize_class_id(body.class_id)
    if not class_id:
        raise HTTPException(status_code=400, detail="class_id 不能为空")
    with db_connection() as conn:
        unsubscribe_student_from_class(conn, student_id, class_id)
    return {"ok": True, "classId": class_id}


@app.post("/api/social/subscribe")
def social_subscribe(body: SocialSubscribeRequest, request: Request) -> Dict[str, Any]:
    session = require_auth_session(request)
    current_student_id = require_bound_student_id(session)
    target_student_id = body.target_student_id.strip()
    require_target_random_code_if_needed(current_student_id, target_student_id, body.target_random_code)
    subscribe_student(current_student_id, target_student_id)
    class_label = get_student_class_label(target_student_id)
    with db_connection() as conn:
        class_row = get_class_by_label(conn, class_label) or ensure_class_for_label(conn, class_label, active=True)
        class_payload = build_class_payload(conn, class_row, with_members=True)
    return {
        "ok": True,
        "targetStudentId": target_student_id,
        "deprecated": True,
        "message": "旧接口已兼容迁移到班级订阅，请改用 /api/social/classes/subscribe-by-code",
        "classSubscription": class_payload,
    }


@app.post("/api/social/upload/avatar")
def social_upload_avatar(request: Request, file: UploadFile = File(...)) -> Dict[str, Any]:
    session = require_auth_session(request)
    student_id = require_bound_student_id(session)
    avatar_url = save_uploaded_image(
        request,
        file,
        usage="avatar",
        max_bytes=MAX_AVATAR_UPLOAD_BYTES,
        owner_student_id=student_id,
        owner_scope="user_profile",
    )
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
    wallpaper_url = save_uploaded_image(
        request,
        file,
        usage="wallpaper",
        max_bytes=MAX_WALLPAPER_UPLOAD_BYTES,
        owner_student_id=student_id,
        owner_scope="user_profile",
    )
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
    class_id = ""
    with db_connection() as conn:
        class_row = get_class_by_label(conn, get_student_class_label(target_student_id))
        class_id = str(class_row.get("class_id", "") if class_row else "")
    return {
        "ok": True,
        "targetStudentId": target_student_id,
        "classId": class_id,
        "deprecated": True,
        "message": "旧接口已兼容迁移到班级订阅，请改用 /api/social/classes/unsubscribe",
    }


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


@app.post("/api/social/notify/unbind")
def social_unbind_notify(request: Request) -> Dict[str, Any]:
    session = require_auth_session(request)
    student_id = require_bound_student_id(session)
    open_id = str(session.get("openId") or "").strip()
    if open_id:
        clear_wecom_subscriptions(open_id)
    unbind_notify_channel(student_id)
    return {"ok": True}


@app.get("/api/social/foods")
def social_list_foods(
    request: Request,
    template_key: str = FOOD_TEMPLATE_DAILY,
    headcount: int = 1,
    category_key: str = "",
    brand_key: str = "",
    keyword: str = "",
) -> Dict[str, Any]:
    session = require_auth_session(request)
    require_bound_student_id(session)
    normalized_template = normalize_food_template_key(template_key)
    normalized_headcount = max(1, min(200, int(headcount or 1)))
    normalized_category_key = trim_profile_text(category_key, max_length=40).lower()
    normalized_brand_key = normalize_food_brand_key(brand_key)
    normalized_keyword = trim_profile_text(keyword, max_length=50)
    with db_connection() as conn:
        category_rules = get_food_category_pricing_rule_map(conn)
        food_items = list_food_items_from_db(
            conn,
            include_disabled=False,
            category_key=normalized_category_key,
            brand_key=normalized_brand_key,
            keyword=normalized_keyword,
        )
        items = [
            build_food_item_payload(item, template_key=normalized_template, headcount=normalized_headcount, category_rules=category_rules)
            for item in food_items
        ]
        category_options = list_food_category_options(conn)
        brand_options = list_food_brand_options(conn, category_key=normalized_category_key)
    return {
        "ok": True,
        "templateKey": normalized_template,
        "headcount": normalized_headcount,
        "categoryKey": normalized_category_key,
        "brandKey": normalized_brand_key,
        "keyword": normalized_keyword,
        "tiers": get_food_template_tiers(normalized_template),
        "categories": category_options,
        "brands": brand_options,
        "items": items,
    }


@app.get("/api/social/food-candidates")
def social_list_food_candidates(
    request: Request,
    status: str = "all",
    category_key: str = "",
    brand_key: str = "",
    keyword: str = "",
    mine_only: bool = False,
) -> Dict[str, Any]:
    session = require_auth_session(request)
    student_id = require_bound_student_id(session)
    normalized_status = str(status or "").strip().lower() or "all"
    allowed_status = {
        "all",
        FOOD_CANDIDATE_STATUS_APPROVED,
        FOOD_CANDIDATE_STATUS_PENDING_REVIEW,
        FOOD_CANDIDATE_STATUS_PENDING_EAT,
        FOOD_CANDIDATE_STATUS_REJECTED,
    }
    if normalized_status not in allowed_status:
        raise HTTPException(status_code=400, detail="status 非法")
    with db_connection() as conn:
        category_rules = get_food_category_pricing_rule_map(conn)
        items = list_food_items_from_db(
            conn,
            include_disabled=True,
            category_key=category_key,
            brand_key=brand_key,
            keyword=keyword,
        )
        if normalized_status == "all":
            items = [
                item
                for item in items
                if normalize_food_candidate_status(item.get("candidate_status")) in {
                    FOOD_CANDIDATE_STATUS_APPROVED,
                    FOOD_CANDIDATE_STATUS_PENDING_REVIEW,
                    FOOD_CANDIDATE_STATUS_PENDING_EAT,
                }
            ]
        else:
            items = [item for item in items if normalize_food_candidate_status(item.get("candidate_status")) == normalized_status]
        if mine_only:
            items = [item for item in items if str(item.get("created_by_student_id", "")).strip() == student_id]
        payloads = [
            build_food_item_payload(item, template_key=FOOD_TEMPLATE_DAILY, headcount=1, category_rules=category_rules)
            for item in items
        ]
    return {
        "ok": True,
        "status": normalized_status,
        "categoryKey": trim_profile_text(category_key, max_length=40).lower(),
        "brandKey": normalize_food_brand_key(brand_key),
        "keyword": trim_profile_text(keyword, max_length=50),
        "mineOnly": bool(mine_only),
        "items": payloads,
    }


@app.post("/api/social/food-candidates")
def social_submit_food_candidate(body: SocialCreateFoodCandidateRequest, request: Request) -> Dict[str, Any]:
    session = require_auth_session(request)
    student_id = require_bound_student_id(session)
    name = trim_profile_text(body.name, max_length=50)
    category_key = trim_profile_text(body.category_key, max_length=40).lower()
    brand_key = normalize_food_brand_key(body.brand_key)
    brand_name = trim_profile_text(body.brand_name, max_length=40) or FOOD_BRAND_NAME_MAP.get(brand_key, "")
    brand_combo = trim_profile_text(body.brand_combo, max_length=80)
    note = trim_profile_text(body.note, max_length=240)
    if not name:
        raise HTTPException(status_code=400, detail="名称不能为空")
    if not category_key:
        raise HTTPException(status_code=400, detail="分类 key 不能为空")
    if body.daily_price_max < body.daily_price_min:
        raise HTTPException(status_code=400, detail="daily_price_max 不能小于 daily_price_min")
    if body.party_price_max < body.party_price_min:
        raise HTTPException(status_code=400, detail="party_price_max 不能小于 party_price_min")
    now_ts = int(time.time())
    with db_connection() as conn:
        existing_row = conn.execute(
            """
            SELECT id, food_key, candidate_status
            FROM food_items
            WHERE name=?
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
            """,
            (name,),
        ).fetchone()
        if existing_row:
            existing_status = normalize_food_candidate_status(existing_row["candidate_status"], FOOD_CANDIDATE_STATUS_APPROVED)
            if existing_status == FOOD_CANDIDATE_STATUS_PENDING_REVIEW:
                raise HTTPException(status_code=400, detail="该店铺已在待审核列表，请勿重复提交")
            if existing_status in {FOOD_CANDIDATE_STATUS_APPROVED, FOOD_CANDIDATE_STATUS_PENDING_EAT}:
                raise HTTPException(status_code=400, detail="该店铺已存在，可直接在待选池查看")
        prefix = re.sub(r"[^a-z0-9_-]+", "_", category_key).strip("_") or "user_food"
        food_key = build_unique_food_key(conn, prefix=prefix)
        conn.execute(
            """
            INSERT INTO food_items
            (food_key, name, category_key, brand_key, brand_name, brand_combo, candidate_status, note, enabled, daily_price_min, daily_price_max, party_price_min, party_price_max, distance_km, strategy_override_json, created_by_student_id, approved_by_student_id, approved_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                food_key,
                name,
                category_key,
                brand_key,
                brand_name,
                brand_combo,
                FOOD_CANDIDATE_STATUS_PENDING_REVIEW,
                note,
                0,
                float(body.daily_price_min),
                float(body.daily_price_max),
                float(body.party_price_min),
                float(body.party_price_max),
                float(body.distance_km),
                "{}",
                student_id,
                "",
                0,
                now_ts,
                now_ts,
            ),
        )
        item = get_food_item_by_key(conn, food_key)
        category_rules = get_food_category_pricing_rule_map(conn)
        payload = build_food_item_payload(item or {}, template_key=FOOD_TEMPLATE_DAILY, headcount=1, category_rules=category_rules)
    return {"ok": True, "item": payload}


@app.get("/api/social/food-campaigns/preview")
def social_preview_food_campaign(share_token: str = "", campaign_id: str = "", include_detail: bool = False) -> Dict[str, Any]:
    normalized_share_token = str(share_token or "").strip()
    normalized_campaign_id = str(campaign_id or "").strip()
    if not normalized_share_token and not normalized_campaign_id:
        raise HTTPException(status_code=400, detail="share_token 或 campaign_id 至少提供一个")
    with db_connection() as conn:
        campaign: Optional[Dict[str, Any]] = None
        if normalized_share_token:
            campaign = get_food_campaign_row_by_share_token(conn, normalized_share_token)
        elif normalized_campaign_id:
            campaign = get_food_campaign_row_by_id(conn, normalized_campaign_id)
        if not campaign:
            raise HTTPException(status_code=404, detail="食物竞选不存在或已失效")
        summary = build_food_campaign_summary_payload(campaign)
        summary["candidateCount"] = int(
            conn.execute("SELECT COUNT(1) AS c FROM food_campaign_candidates WHERE campaign_id=?", (summary["campaignId"],)).fetchone()["c"]
        )
        summary["headcount"] = get_food_campaign_vote_headcount(conn, summary["campaignId"])
        summary["categoryHighlights"] = get_food_campaign_category_highlights(conn, summary["campaignId"], limit=3)
        if include_detail:
            if not normalized_share_token:
                raise HTTPException(status_code=400, detail="include_detail 需要 share_token")
            if normalized_share_token != str(campaign.get("share_token", "")):
                raise HTTPException(status_code=403, detail="share_token 无效")
            detail = build_food_campaign_detail_payload(
                conn=conn,
                campaign=campaign,
                viewer_student_id="",
                share_token_granted=True,
            )
            detail["candidateCount"] = summary["candidateCount"]
            detail["categoryHighlights"] = summary["categoryHighlights"]
            return {"ok": True, "campaign": detail}
    return {"ok": True, "campaign": summary}


@app.post("/api/social/food-campaigns")
def social_create_food_campaign(body: SocialCreateFoodCampaignRequest, request: Request) -> Dict[str, Any]:
    session = require_auth_session(request)
    initiator_student_id = require_bound_student_id(session)
    template_key = normalize_food_template_key(body.template_key)
    join_mode = normalize_food_campaign_join_mode(body.join_mode)
    raw_join_password = str(body.join_password or "").strip()
    join_password = normalize_food_campaign_password(raw_join_password) if raw_join_password else ""
    selected_tier_ids = normalize_selected_tier_ids(template_key, body.selected_tier_ids)
    selected_category_keys = normalize_food_filter_keys(body.category_keys)
    selected_brand_keys = normalize_food_filter_keys(body.brand_keys)
    deadline_at = parse_deadline_timestamp(body.deadline_at)
    max_votes_per_user = max(
        FOOD_CAMPAIGN_MIN_VOTE_LIMIT,
        min(FOOD_CAMPAIGN_MAX_VOTE_LIMIT, int(body.max_votes_per_user or FOOD_CAMPAIGN_MIN_VOTE_LIMIT)),
    )
    title = normalize_food_campaign_title(body.title)
    invitee_student_ids = [item for item in normalize_student_id_list(body.invitee_student_ids) if item != initiator_student_id]
    if join_mode == FOOD_CAMPAIGN_JOIN_MODE_INVITE and not invitee_student_ids:
        raise HTTPException(status_code=400, detail="邀请模式至少需要选择 1 位参与人")
    if join_mode == FOOD_CAMPAIGN_JOIN_MODE_PASSWORD and not join_password:
        raise HTTPException(status_code=400, detail="密码模式必须设置参与密码")
    if join_mode != FOOD_CAMPAIGN_JOIN_MODE_PASSWORD:
        join_password = ""
    is_anonymous = True if body.is_anonymous is None else bool(body.is_anonymous)
    join_password_salt = ""
    join_password_hash = ""
    if join_mode == FOOD_CAMPAIGN_JOIN_MODE_PASSWORD:
        join_password_salt = secrets.token_hex(8)
        join_password_hash = build_food_campaign_password_hash(join_password, join_password_salt)

    with db_connection() as conn:
        open_campaigns = list_open_food_campaigns_by_initiator(conn, initiator_student_id)
        if open_campaigns:
            raise HTTPException(status_code=400, detail="你已有进行中的食物竞选，同一时间段仅可创建 1 场")

        for invitee_id in invitee_student_ids:
            ensure_user_profile(invitee_id)

        candidate_pool = get_food_candidate_pool(
            conn=conn,
            template_key=template_key,
            headcount=1,
            selected_tier_ids=selected_tier_ids,
            exclude_food_ids=set(),
            selected_category_keys=selected_category_keys,
            selected_brand_keys=selected_brand_keys,
        )
        picked_candidates = pick_food_candidates(
            pool=candidate_pool,
            selected_tier_ids=selected_tier_ids,
            target_count=FOOD_CAMPAIGN_INITIAL_CANDIDATE_COUNT,
        )
        if len(picked_candidates) < FOOD_CAMPAIGN_INITIAL_CANDIDATE_COUNT:
            raise HTTPException(status_code=400, detail="可用食物不足，无法生成 3 个候选，请先在后台补充食物")

        campaign_id = generate_food_campaign_id()
        while conn.execute("SELECT 1 FROM food_campaigns WHERE campaign_id=? LIMIT 1", (campaign_id,)).fetchone():
            campaign_id = generate_food_campaign_id()
        share_token = generate_food_campaign_share_token()
        while conn.execute("SELECT 1 FROM food_campaigns WHERE share_token=? LIMIT 1", (share_token,)).fetchone():
            share_token = generate_food_campaign_share_token()
        now_ts = int(time.time())
        conn.execute(
            """
            INSERT INTO food_campaigns
            (campaign_id, title, initiator_student_id, template_key, selected_tier_ids, selected_category_keys, selected_brand_keys, max_votes_per_user, deadline_at, status, share_token, join_mode, join_password_salt, join_password_hash, is_anonymous, reveal_after_close, reveal_scope, supplement_used, created_at, updated_at, closed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, ?, ?, 0)
            """,
            (
                campaign_id,
                title,
                initiator_student_id,
                template_key,
                json.dumps(selected_tier_ids, ensure_ascii=False),
                json.dumps(selected_category_keys, ensure_ascii=False),
                json.dumps(selected_brand_keys, ensure_ascii=False),
                max_votes_per_user,
                deadline_at,
                FOOD_CAMPAIGN_STATUS_OPEN,
                share_token,
                join_mode,
                join_password_salt,
                join_password_hash,
                1 if is_anonymous else 0,
                FOOD_REVEAL_SCOPE_SHARE_TOKEN,
                now_ts,
                now_ts,
            ),
        )
        conn.execute(
            """
            INSERT OR IGNORE INTO food_campaign_participants
            (campaign_id, student_id, source, approval_status, approved_by_student_id, approved_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                campaign_id,
                initiator_student_id,
                FOOD_PARTICIPANT_SOURCE_INITIATOR,
                FOOD_CAMPAIGN_PARTICIPANT_APPROVED,
                initiator_student_id,
                now_ts,
                now_ts,
                now_ts,
            ),
        )
        for invitee_id in invitee_student_ids:
            conn.execute(
                """
                INSERT OR IGNORE INTO food_campaign_participants
                (campaign_id, student_id, source, approval_status, approved_by_student_id, approved_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    campaign_id,
                    invitee_id,
                    FOOD_PARTICIPANT_SOURCE_INVITE,
                    FOOD_CAMPAIGN_PARTICIPANT_APPROVED,
                    initiator_student_id,
                    now_ts,
                    now_ts,
                    now_ts,
                ),
            )

        for index, item in enumerate(picked_candidates, start=1):
            conn.execute(
                """
                INSERT INTO food_campaign_candidates
                (campaign_id, food_id, slot_index, source, tier_id_snapshot, dynamic_price_min, dynamic_price_max, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    campaign_id,
                    int(item.get("id", 0)),
                    index,
                    FOOD_CANDIDATE_SOURCE_INITIAL,
                    str(item.get("tierId", "")),
                    float(item.get("dynamicPriceMin", 0.0)),
                    float(item.get("dynamicPriceMax", 0.0)),
                    now_ts,
                ),
            )

        campaign = require_food_campaign(conn, campaign_id)
        detail = build_food_campaign_detail_payload(conn, campaign, viewer_student_id=initiator_student_id)
    return {"ok": True, "campaign": detail}


@app.post("/api/social/food-campaigns/join")
def social_join_food_campaign(body: SocialJoinFoodCampaignRequest, request: Request) -> Dict[str, Any]:
    session = require_auth_session(request)
    student_id = require_bound_student_id(session)
    access_password = str(body.access_password or "").strip()
    with db_connection() as conn:
        campaign = get_food_campaign_row_by_share_token(conn, body.share_token)
        if not campaign:
            raise HTTPException(status_code=404, detail="竞选链接无效或已失效")
        require_food_campaign_open(campaign)
        campaign_id = str(campaign.get("campaign_id", "")).strip()
        join_mode = normalize_food_campaign_join_mode(campaign.get("join_mode"))
        initiator_student_id = str(campaign.get("initiator_student_id", "")).strip()
        now_ts = int(time.time())
        participant = get_food_campaign_participant(conn, campaign_id, student_id)
        is_initiator = initiator_student_id == student_id
        is_invited = bool(participant) and str(participant.get("source", "")).strip() == FOOD_PARTICIPANT_SOURCE_INVITE
        if join_mode == FOOD_CAMPAIGN_JOIN_MODE_INVITE and not is_invited and not is_initiator:
            raise HTTPException(status_code=403, detail="该竞选仅限受邀用户参与")
        if join_mode == FOOD_CAMPAIGN_JOIN_MODE_PASSWORD and not is_invited and not is_initiator:
            if not access_password:
                raise HTTPException(status_code=400, detail="该竞选需要参与密码")
            access_password = normalize_food_campaign_password(access_password)
            if not verify_food_campaign_password(
                access_password,
                str(campaign.get("join_password_salt") or ""),
                str(campaign.get("join_password_hash") or ""),
            ):
                raise HTTPException(status_code=403, detail="参与密码错误")

        if is_initiator:
            target_source = FOOD_PARTICIPANT_SOURCE_INITIATOR
            approved_by_student_id = initiator_student_id
        elif is_invited:
            target_source = FOOD_PARTICIPANT_SOURCE_INVITE
            approved_by_student_id = initiator_student_id
        else:
            target_source = FOOD_PARTICIPANT_SOURCE_JOIN_REQUEST
            approved_by_student_id = student_id

        if participant:
            conn.execute(
                """
                UPDATE food_campaign_participants
                SET source=?, approval_status=?, approved_by_student_id=?, approved_at=?, updated_at=?
                WHERE campaign_id=? AND student_id=?
                """,
                (
                    target_source,
                    FOOD_CAMPAIGN_PARTICIPANT_APPROVED,
                    approved_by_student_id,
                    now_ts,
                    now_ts,
                    campaign_id,
                    student_id,
                ),
            )
        else:
            conn.execute(
                """
                INSERT INTO food_campaign_participants
                (campaign_id, student_id, source, approval_status, approved_by_student_id, approved_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    campaign_id,
                    student_id,
                    target_source,
                    FOOD_CAMPAIGN_PARTICIPANT_APPROVED,
                    approved_by_student_id,
                    now_ts,
                    now_ts,
                    now_ts,
                ),
            )
        conn.execute("UPDATE food_campaigns SET updated_at=? WHERE campaign_id=?", (now_ts, campaign_id))
        campaign = require_food_campaign(conn, campaign_id)
        detail = build_food_campaign_detail_payload(conn, campaign, viewer_student_id=student_id)
    return {"ok": True, "campaign": detail}


@app.get("/api/social/food-campaigns")
def social_list_food_campaigns(request: Request, status: str = "open") -> Dict[str, Any]:
    session = require_auth_session(request)
    student_id = require_bound_student_id(session)
    normalized_status = str(status or "open").strip().lower()
    if normalized_status not in {"open", "closed", "all"}:
        raise HTTPException(status_code=400, detail="status 仅支持 open|closed|all")
    with db_connection() as conn:
        rows = list_user_visible_food_campaigns(conn, student_id)
        items: List[Dict[str, Any]] = []
        for row in rows:
            status_value = normalize_food_campaign_status(row.get("status"))
            if normalized_status == "open" and status_value != FOOD_CAMPAIGN_STATUS_OPEN:
                continue
            if normalized_status == "closed" and status_value == FOOD_CAMPAIGN_STATUS_OPEN:
                continue
            summary = build_food_campaign_summary_payload(row)
            summary["candidateCount"] = int(
                conn.execute("SELECT COUNT(1) AS c FROM food_campaign_candidates WHERE campaign_id=?", (summary["campaignId"],)).fetchone()["c"]
            )
            summary["headcount"] = get_food_campaign_vote_headcount(conn, summary["campaignId"])
            summary["categoryHighlights"] = get_food_campaign_category_highlights(conn, summary["campaignId"], limit=3)
            summary["viewerApprovalStatus"] = str(row.get("viewer_approval_status") or "")
            items.append(summary)
    return {"ok": True, "items": items}


@app.get("/api/social/food-campaigns/stats")
def social_food_campaign_stats(request: Request, recent_days: int = 30) -> Dict[str, Any]:
    session = require_auth_session(request)
    student_id = require_bound_student_id(session)
    with db_connection() as conn:
        stats = build_food_campaign_stats_payload(conn, student_id, recent_days=recent_days)
    return {"ok": True, "stats": stats}


@app.get("/api/social/food-campaigns/{campaign_id}")
def social_get_food_campaign_detail(campaign_id: str, request: Request, share_token: str = "") -> Dict[str, Any]:
    session = require_auth_session(request)
    student_id = require_bound_student_id(session)
    normalized_share_token = str(share_token or "").strip()
    with db_connection() as conn:
        campaign = require_food_campaign(conn, campaign_id)
        require_food_campaign_read_permission(conn, campaign, student_id)
        detail = build_food_campaign_detail_payload(
            conn,
            campaign,
            viewer_student_id=student_id,
            share_token_granted=bool(normalized_share_token) and normalized_share_token == str(campaign.get("share_token", "")),
        )
    return {"ok": True, "campaign": detail}


@app.post("/api/social/food-campaigns/{campaign_id}/participants/{target_student_id}/approve")
def social_approve_food_campaign_participant(campaign_id: str, target_student_id: str, request: Request) -> Dict[str, Any]:
    session = require_auth_session(request)
    actor_student_id = require_bound_student_id(session)
    normalized_target_student_id = normalize_student_id(target_student_id)
    ensure_student_exists(normalized_target_student_id)
    with db_connection() as conn:
        campaign = require_food_campaign(conn, campaign_id)
        require_food_campaign_open(campaign)
        require_food_campaign_manage_permission(conn, campaign, actor_student_id)
        participant = get_food_campaign_participant(conn, campaign_id, normalized_target_student_id)
        if not participant:
            raise HTTPException(status_code=404, detail="目标参与者不存在")
        now_ts = int(time.time())
        conn.execute(
            """
            UPDATE food_campaign_participants
            SET approval_status=?, approved_by_student_id=?, approved_at=?, updated_at=?
            WHERE campaign_id=? AND student_id=?
            """,
            (FOOD_CAMPAIGN_PARTICIPANT_APPROVED, actor_student_id, now_ts, now_ts, campaign_id, normalized_target_student_id),
        )
        conn.execute("UPDATE food_campaigns SET updated_at=? WHERE campaign_id=?", (now_ts, campaign_id))
        campaign = require_food_campaign(conn, campaign_id)
        detail = build_food_campaign_detail_payload(conn, campaign, viewer_student_id=actor_student_id)
    return {"ok": True, "campaign": detail}


@app.post("/api/social/food-campaigns/{campaign_id}/participants/{target_student_id}/reject")
def social_reject_food_campaign_participant(campaign_id: str, target_student_id: str, request: Request) -> Dict[str, Any]:
    session = require_auth_session(request)
    actor_student_id = require_bound_student_id(session)
    normalized_target_student_id = normalize_student_id(target_student_id)
    ensure_student_exists(normalized_target_student_id)
    with db_connection() as conn:
        campaign = require_food_campaign(conn, campaign_id)
        require_food_campaign_open(campaign)
        require_food_campaign_manage_permission(conn, campaign, actor_student_id)
        participant = get_food_campaign_participant(conn, campaign_id, normalized_target_student_id)
        if not participant:
            raise HTTPException(status_code=404, detail="目标参与者不存在")
        now_ts = int(time.time())
        conn.execute(
            """
            UPDATE food_campaign_participants
            SET approval_status=?, approved_by_student_id=?, approved_at=?, updated_at=?
            WHERE campaign_id=? AND student_id=?
            """,
            (FOOD_CAMPAIGN_PARTICIPANT_REJECTED, actor_student_id, now_ts, now_ts, campaign_id, normalized_target_student_id),
        )
        conn.execute("UPDATE food_campaigns SET updated_at=? WHERE campaign_id=?", (now_ts, campaign_id))
        campaign = require_food_campaign(conn, campaign_id)
        detail = build_food_campaign_detail_payload(conn, campaign, viewer_student_id=actor_student_id)
    return {"ok": True, "campaign": detail}


@app.post("/api/social/food-campaigns/{campaign_id}/vote")
def social_vote_food_campaign(campaign_id: str, body: SocialFoodCampaignVoteRequest, request: Request) -> Dict[str, Any]:
    session = require_auth_session(request)
    student_id = require_bound_student_id(session)
    selected_food_ids = normalize_food_id_list(body.selected_food_ids)
    if not selected_food_ids:
        raise HTTPException(status_code=400, detail="请至少选择 1 个食物")
    with db_connection() as conn:
        campaign = require_food_campaign(conn, campaign_id)
        require_food_campaign_open(campaign)
        participant = get_food_campaign_participant(conn, campaign_id, student_id)
        if not participant or str(participant.get("approval_status", "")) != FOOD_CAMPAIGN_PARTICIPANT_APPROVED:
            raise HTTPException(status_code=403, detail="你还没有投票权限，请先通过参与审批")
        max_votes_per_user = max(
            FOOD_CAMPAIGN_MIN_VOTE_LIMIT,
            min(FOOD_CAMPAIGN_MAX_VOTE_LIMIT, normalize_int_value(campaign.get("max_votes_per_user"), FOOD_CAMPAIGN_MIN_VOTE_LIMIT)),
        )
        if len(selected_food_ids) > max_votes_per_user:
            raise HTTPException(status_code=400, detail=f"本场竞选最多可投 {max_votes_per_user} 票")
        placeholders = ",".join(["?"] * len(selected_food_ids))
        rows = conn.execute(
            f"SELECT food_id FROM food_campaign_candidates WHERE campaign_id=? AND food_id IN ({placeholders})",
            tuple([campaign_id] + selected_food_ids),
        ).fetchall()
        existing_food_ids = {normalize_int_value(row["food_id"], 0) for row in rows}
        if len(existing_food_ids) != len(selected_food_ids):
            raise HTTPException(status_code=400, detail="包含无效候选食物，请刷新后重试")
        apply_food_campaign_vote(conn, campaign_id=campaign_id, voter_student_id=student_id, selected_food_ids=selected_food_ids)
        campaign = require_food_campaign(conn, campaign_id)
        detail = build_food_campaign_detail_payload(conn, campaign, viewer_student_id=student_id)
    return {"ok": True, "campaign": detail}


@app.post("/api/social/food-campaigns/{campaign_id}/supplement")
def social_supplement_food_campaign_candidate(campaign_id: str, request: Request) -> Dict[str, Any]:
    session = require_auth_session(request)
    student_id = require_bound_student_id(session)
    with db_connection() as conn:
        campaign = require_food_campaign(conn, campaign_id)
        require_food_campaign_open(campaign)
        require_food_campaign_manage_permission(conn, campaign, student_id)
        if bool(campaign.get("supplement_used")):
            raise HTTPException(status_code=400, detail="本场竞选已使用过补抽机会")

        template_key = str(campaign.get("template_key", FOOD_TEMPLATE_DAILY))
        selected_tier_ids = parse_tier_id_list_from_json(campaign.get("selected_tier_ids"), template_key=template_key)
        selected_category_keys = parse_food_filter_keys_from_json(campaign.get("selected_category_keys"))
        selected_brand_keys = parse_food_filter_keys_from_json(campaign.get("selected_brand_keys"))
        headcount = get_food_campaign_vote_headcount(conn, campaign_id)
        candidate_rows = conn.execute(
            "SELECT food_id, slot_index, tier_id_snapshot FROM food_campaign_candidates WHERE campaign_id=? ORDER BY slot_index ASC",
            (campaign_id,),
        ).fetchall()
        used_food_ids = {normalize_int_value(row["food_id"], 0) for row in candidate_rows}
        covered_tier_ids = {str(row["tier_id_snapshot"] or "").strip() for row in candidate_rows if str(row["tier_id_snapshot"] or "").strip()}
        uncovered_tier_ids = [tier_id for tier_id in selected_tier_ids if tier_id not in covered_tier_ids]

        pool = get_food_candidate_pool(
            conn=conn,
            template_key=template_key,
            headcount=headcount,
            selected_tier_ids=selected_tier_ids,
            exclude_food_ids=used_food_ids,
            selected_category_keys=selected_category_keys,
            selected_brand_keys=selected_brand_keys,
        )
        if not pool:
            raise HTTPException(status_code=400, detail="暂无可补抽食物，请先在后台新增食物")
        preferred_pool = [item for item in pool if str(item.get("tierId", "")).strip() in uncovered_tier_ids] if uncovered_tier_ids else []
        picked = randomize_items(preferred_pool or pool)[0]
        max_slot_index = max([normalize_int_value(row["slot_index"], 0) for row in candidate_rows], default=0)
        now_ts = int(time.time())
        conn.execute(
            """
            INSERT INTO food_campaign_candidates
            (campaign_id, food_id, slot_index, source, tier_id_snapshot, dynamic_price_min, dynamic_price_max, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                campaign_id,
                int(picked.get("id", 0)),
                max_slot_index + 1,
                FOOD_CANDIDATE_SOURCE_SUPPLEMENT,
                str(picked.get("tierId", "")),
                float(picked.get("dynamicPriceMin", 0.0)),
                float(picked.get("dynamicPriceMax", 0.0)),
                now_ts,
            ),
        )
        conn.execute(
            """
            UPDATE food_campaigns
            SET supplement_used=1, updated_at=?
            WHERE campaign_id=?
            """,
            (now_ts, campaign_id),
        )
        campaign = require_food_campaign(conn, campaign_id)
        detail = build_food_campaign_detail_payload(conn, campaign, viewer_student_id=student_id)
    return {"ok": True, "campaign": detail}


@app.post("/api/social/food-campaigns/{campaign_id}/close")
def social_close_food_campaign(campaign_id: str, request: Request) -> Dict[str, Any]:
    session = require_auth_session(request)
    student_id = require_bound_student_id(session)
    with db_connection() as conn:
        campaign = require_food_campaign(conn, campaign_id)
        require_food_campaign_manage_permission(conn, campaign, student_id)
        if normalize_food_campaign_status(campaign.get("status")) == FOOD_CAMPAIGN_STATUS_OPEN:
            close_food_campaign(conn, campaign_id)
        campaign = require_food_campaign(conn, campaign_id)
        detail = build_food_campaign_detail_payload(conn, campaign, viewer_student_id=student_id)
    return {"ok": True, "campaign": detail}


@app.get("/api/theme-images")
def get_theme_images() -> Dict[str, Any]:
    images, updated_at = get_theme_image_settings()
    return {"ok": True, "images": images, "updatedAt": updated_at, "themeKeys": list(THEME_KEYS)}


@app.get("/api/admin/classes")
def admin_list_classes(request: Request, include_inactive: bool = True) -> Dict[str, Any]:
    require_admin_session(request)
    with db_connection() as conn:
        items = list_class_payloads(conn, include_inactive=bool(include_inactive))
    return {"ok": True, "items": items}


@app.post("/api/admin/classes")
def admin_save_class(body: AdminSaveClassRequest, request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    class_label = normalize_class_label(body.class_label)
    if not class_label:
        raise HTTPException(status_code=400, detail="class_label 不能为空")
    normalized_class_id = normalize_class_id(body.class_id)
    with db_connection() as conn:
        if normalized_class_id:
            class_row = get_class_by_id(conn, normalized_class_id)
            if not class_row:
                raise HTTPException(status_code=404, detail="班级不存在")
            same_label = get_class_by_label(conn, class_label)
            if same_label and str(same_label.get("class_id", "")) != normalized_class_id:
                raise HTTPException(status_code=400, detail="class_label 已存在")
            now_ts = int(time.time())
            active_value = 1 if (body.active if body.active is not None else bool(class_row.get("active"))) else 0
            conn.execute(
                """
                UPDATE classes
                SET class_label=?, active=?, updated_at=?
                WHERE class_id=?
                """,
                (class_label, active_value, now_ts, normalized_class_id),
            )
            target = get_class_by_id(conn, normalized_class_id)
        else:
            target = ensure_class_for_label(conn, class_label, active=bool(body.active if body.active is not None else True))
        if not target:
            raise HTTPException(status_code=500, detail="保存班级失败")
        item = build_class_payload(conn, target, with_members=True)
    return {"ok": True, "item": item}


@app.post("/api/admin/classes/{class_id}/rotate-code")
def admin_rotate_class_code(class_id: str, request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    normalized_class_id = normalize_class_id(class_id)
    if not normalized_class_id:
        raise HTTPException(status_code=400, detail="class_id 非法")
    with db_connection() as conn:
        class_row = rotate_class_code(conn, normalized_class_id, actor_student_id=DEFAULT_ADMIN_STUDENT_ID)
        item = build_class_payload(conn, class_row, with_members=True)
    return {"ok": True, "item": item}


@app.get("/api/admin/classes/{class_id}/members")
def admin_get_class_members(class_id: str, request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    normalized_class_id = normalize_class_id(class_id)
    if not normalized_class_id:
        raise HTTPException(status_code=400, detail="class_id 非法")
    with db_connection() as conn:
        class_row = get_class_by_id(conn, normalized_class_id)
        if not class_row:
            raise HTTPException(status_code=404, detail="班级不存在")
        item = build_class_payload(conn, class_row, with_members=True)
        subscriber_rows = conn.execute(
            """
            SELECT subscriber_student_id
            FROM user_class_subscriptions
            WHERE class_id=?
            ORDER BY created_at DESC
            """,
            (normalized_class_id,),
        ).fetchall()
        subscribers = [
            build_social_user_payload(normalize_student_id(row["subscriber_student_id"]), include_random_code=False, reveal_sensitive=True)
            for row in subscriber_rows
            if normalize_student_id(row["subscriber_student_id"]) in SCHEDULES
        ]
    return {"ok": True, "item": item, "subscribers": subscribers}


@app.get("/api/admin/media-assets")
def admin_list_media_assets(
    request: Request,
    usage: str = "",
    owner_student_id: str = "",
    referenced: str = "all",
    keyword: str = "",
    limit: int = 200,
) -> Dict[str, Any]:
    require_admin_session(request)
    normalized_usage = trim_profile_text(usage, max_length=60)
    normalized_owner_student_id = normalize_student_id(owner_student_id)
    normalized_keyword = trim_profile_text(keyword, max_length=60)
    normalized_limit = max(1, min(500, int(limit or 200)))
    normalized_referenced = str(referenced or "all").strip().lower()
    where_parts: List[str] = []
    params: List[Any] = []
    if normalized_usage:
        where_parts.append("usage=?")
        params.append(normalized_usage)
    if normalized_owner_student_id:
        where_parts.append("owner_student_id=?")
        params.append(normalized_owner_student_id)
    if normalized_referenced in {"yes", "true", "1"}:
        where_parts.append("is_referenced=1")
    elif normalized_referenced in {"no", "false", "0"}:
        where_parts.append("is_referenced=0")
    if normalized_keyword:
        like_keyword = f"%{normalized_keyword}%"
        where_parts.append("(file_name LIKE ? OR owner_student_id LIKE ? OR usage LIKE ?)")
        params.extend([like_keyword, like_keyword, like_keyword])
    where_clause = f"WHERE {' AND '.join(where_parts)}" if where_parts else ""
    with db_connection() as conn:
        scan_result = scan_storage_media_assets(conn)
        reference_result = reconcile_media_asset_references(conn)
        rows = conn.execute(
            f"""
            SELECT id, file_name, usage, owner_scope, owner_student_id, media_url, mime_type, extension, size_bytes, is_referenced, created_at, updated_at
            FROM media_assets
            {where_clause}
            ORDER BY created_at DESC, id DESC
            LIMIT ?
            """,
            tuple([*params, normalized_limit]),
        ).fetchall()
        orphan_row = conn.execute("SELECT COUNT(1) AS c FROM media_assets WHERE is_referenced=0").fetchone()
        total_row = conn.execute("SELECT COUNT(1) AS c FROM media_assets").fetchone()
    items: List[Dict[str, Any]] = []
    for row in rows:
        file_name = str(row["file_name"] or "").strip()
        file_path = MEDIA_STORAGE_DIR / file_name
        created_at = normalize_int_value(row["created_at"], 0)
        updated_at = normalize_int_value(row["updated_at"], 0)
        items.append(
            {
                "id": normalize_int_value(row["id"], 0),
                "fileName": file_name,
                "usage": str(row["usage"] or ""),
                "ownerScope": str(row["owner_scope"] or ""),
                "ownerStudentId": str(row["owner_student_id"] or ""),
                "mediaUrl": str(row["media_url"] or ""),
                "mimeType": str(row["mime_type"] or ""),
                "extension": str(row["extension"] or ""),
                "sizeBytes": normalize_int_value(row["size_bytes"], 0),
                "referenced": bool(row["is_referenced"]),
                "existsOnDisk": file_path.exists() and file_path.is_file(),
                "createdAt": created_at,
                "updatedAt": updated_at,
                "createdAtIso": datetime.fromtimestamp(created_at, tz=get_timezone()).isoformat() if created_at > 0 else "",
                "updatedAtIso": datetime.fromtimestamp(updated_at, tz=get_timezone()).isoformat() if updated_at > 0 else "",
            }
        )
    return {
        "ok": True,
        "items": items,
        "total": normalize_int_value(total_row["c"] if total_row else 0, 0),
        "orphanCount": normalize_int_value(orphan_row["c"] if orphan_row else 0, 0),
        "scan": scan_result,
        "reference": reference_result,
    }


@app.post("/api/admin/media-assets/reconcile")
def admin_reconcile_media_assets(request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    with db_connection() as conn:
        scan_result = scan_storage_media_assets(conn)
        reference_result = reconcile_media_asset_references(conn)
        orphan_row = conn.execute("SELECT COUNT(1) AS c FROM media_assets WHERE is_referenced=0").fetchone()
        total_row = conn.execute("SELECT COUNT(1) AS c FROM media_assets").fetchone()
    return {
        "ok": True,
        "scan": scan_result,
        "reference": reference_result,
        "total": normalize_int_value(total_row["c"] if total_row else 0, 0),
        "orphanCount": normalize_int_value(orphan_row["c"] if orphan_row else 0, 0),
    }


@app.post("/api/admin/media-assets/cleanup")
def admin_cleanup_media_assets(body: AdminMediaCleanupRequest, request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    max_age_hours = max(1, min(24 * 365, int(body.max_age_hours or 24 * 7)))
    dry_run = True if body.dry_run is None else bool(body.dry_run)
    now_ts = int(time.time())
    threshold_ts = now_ts - max_age_hours * 60 * 60
    removed: List[Dict[str, Any]] = []
    candidates: List[Dict[str, Any]] = []
    with db_connection() as conn:
        scan_storage_media_assets(conn)
        reconcile_media_asset_references(conn)
        rows = conn.execute(
            """
            SELECT id, file_name, usage, owner_scope, owner_student_id, media_url, size_bytes, created_at
            FROM media_assets
            WHERE is_referenced=0 AND created_at<=?
            ORDER BY created_at ASC, id ASC
            """,
            (threshold_ts,),
        ).fetchall()
        for row in rows:
            file_name = str(row["file_name"] or "").strip()
            file_path = MEDIA_STORAGE_DIR / file_name
            candidate = {
                "id": normalize_int_value(row["id"], 0),
                "fileName": file_name,
                "usage": str(row["usage"] or ""),
                "ownerScope": str(row["owner_scope"] or ""),
                "ownerStudentId": str(row["owner_student_id"] or ""),
                "mediaUrl": str(row["media_url"] or ""),
                "sizeBytes": normalize_int_value(row["size_bytes"], 0),
                "createdAt": normalize_int_value(row["created_at"], 0),
                "existsOnDisk": file_path.exists() and file_path.is_file(),
            }
            candidates.append(candidate)
            if dry_run:
                continue
            if file_path.exists() and file_path.is_file():
                try:
                    file_path.unlink()
                except OSError:
                    continue
            conn.execute("DELETE FROM media_assets WHERE id=?", (candidate["id"],))
            removed.append(candidate)
        if not dry_run:
            reconcile_media_asset_references(conn)
    return {
        "ok": True,
        "dryRun": dry_run,
        "maxAgeHours": max_age_hours,
        "thresholdAt": threshold_ts,
        "candidateCount": len(candidates),
        "removedCount": len(removed),
        "candidates": candidates,
        "removed": removed,
    }


def resolve_preview_student_id(student_id: str = "", student_no: str = "") -> str:
    normalized_student_id = normalize_student_id(student_id)
    if normalized_student_id:
        if normalized_student_id not in SCHEDULES:
            raise HTTPException(status_code=404, detail="student_id 不存在")
        return normalized_student_id
    normalized_student_no = trim_profile_text(student_no, max_length=32)
    if not normalized_student_no:
        raise HTTPException(status_code=400, detail="student_id 或 student_no 至少提供一个")
    resolved_student_id = resolve_student_id_by_student_no(normalized_student_no)
    if not resolved_student_id or resolved_student_id not in SCHEDULES:
        raise HTTPException(status_code=404, detail="student_no 未匹配到用户")
    return resolved_student_id


@app.get("/api/admin/preview/profile-card")
def admin_preview_profile_card(request: Request, student_no: str = "", student_id: str = "") -> Dict[str, Any]:
    require_admin_session(request)
    resolved_student_id = resolve_preview_student_id(student_id=student_id, student_no=student_no)
    with db_connection() as conn:
        class_subscriptions = [build_class_payload(conn, row, with_members=True) for row in list_user_subscribed_class_rows(conn, resolved_student_id)]
    profile = build_social_user_payload(
        resolved_student_id,
        include_random_code=True,
        reveal_sensitive=True,
        include_practice_course_keys=True,
    )
    return {"ok": True, "studentId": resolved_student_id, "profile": profile, "classSubscriptions": class_subscriptions}


@app.get("/api/admin/preview/class-subscriptions")
def admin_preview_class_subscriptions(request: Request, student_no: str = "", student_id: str = "") -> Dict[str, Any]:
    require_admin_session(request)
    resolved_student_id = resolve_preview_student_id(student_id=student_id, student_no=student_no)
    with db_connection() as conn:
        items = [build_class_payload(conn, row, with_members=True) for row in list_user_subscribed_class_rows(conn, resolved_student_id)]
    return {"ok": True, "studentId": resolved_student_id, "items": items}


@app.get("/api/admin/preview/food-vote-state")
def admin_preview_food_vote_state(
    request: Request,
    campaign_id: str,
    student_no: str = "",
    student_id: str = "",
    share_token: str = "",
) -> Dict[str, Any]:
    require_admin_session(request)
    normalized_campaign_id = trim_profile_text(campaign_id, max_length=64)
    if not normalized_campaign_id:
        raise HTTPException(status_code=400, detail="campaign_id 不能为空")
    resolved_student_id = ""
    if trim_profile_text(student_id, max_length=64) or trim_profile_text(student_no, max_length=32):
        resolved_student_id = resolve_preview_student_id(student_id=student_id, student_no=student_no)
    normalized_share_token = trim_profile_text(share_token, max_length=16)
    with db_connection() as conn:
        campaign = require_food_campaign(conn, normalized_campaign_id)
        token_granted = bool(normalized_share_token) and normalized_share_token == str(campaign.get("share_token", ""))
        viewer_detail = build_food_campaign_detail_payload(
            conn=conn,
            campaign=campaign,
            viewer_student_id=resolved_student_id,
            share_token_granted=token_granted,
        )
        share_token_detail = build_food_campaign_detail_payload(
            conn=conn,
            campaign=campaign,
            viewer_student_id="",
            share_token_granted=True,
        )
    return {
        "ok": True,
        "campaignId": normalized_campaign_id,
        "viewerStudentId": resolved_student_id,
        "viewerDetail": viewer_detail,
        "shareTokenDetail": share_token_detail,
    }


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


@app.get("/api/admin/foods")
def admin_list_food_items(request: Request, include_disabled: bool = True) -> Dict[str, Any]:
    require_admin_session(request)
    with db_connection() as conn:
        category_rules = get_food_category_pricing_rule_map(conn)
        items = [
            build_food_item_payload(
                food_item,
                template_key=FOOD_TEMPLATE_DAILY,
                headcount=1,
                category_rules=category_rules,
            )
            for food_item in list_food_items_from_db(conn, include_disabled=bool(include_disabled))
        ]
    return {"ok": True, "items": items}


@app.post("/api/admin/foods")
def admin_create_food_item(body: AdminSaveFoodItemRequest, request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    food_key = trim_profile_text(body.food_key, max_length=40).lower().replace(" ", "_")
    if not re.fullmatch(r"[a-z0-9_-]{2,40}", food_key):
        raise HTTPException(status_code=400, detail="food_key 格式非法，仅支持小写字母/数字/下划线/中划线")
    name = trim_profile_text(body.name, max_length=50)
    category_key = trim_profile_text(body.category_key, max_length=40).lower()
    brand_key = normalize_food_brand_key(body.brand_key)
    brand_name = trim_profile_text(body.brand_name, max_length=40) or FOOD_BRAND_NAME_MAP.get(brand_key, "")
    brand_combo = trim_profile_text(body.brand_combo, max_length=80)
    if body.daily_price_max < body.daily_price_min:
        raise HTTPException(status_code=400, detail="daily_price_max 不能小于 daily_price_min")
    if body.party_price_max < body.party_price_min:
        raise HTTPException(status_code=400, detail="party_price_max 不能小于 party_price_min")
    candidate_status = normalize_food_candidate_status(body.candidate_status, FOOD_CANDIDATE_STATUS_APPROVED)
    note = trim_profile_text(body.note, max_length=240)
    override_payload = normalize_food_pricing_override(body.strategy_override_json or {})
    now_ts = int(time.time())
    enabled_value = 1 if body.enabled is None else (1 if body.enabled else 0)
    if candidate_status == FOOD_CANDIDATE_STATUS_PENDING_REVIEW:
        enabled_value = 0
    approved_by_student_id = "admin" if candidate_status != FOOD_CANDIDATE_STATUS_PENDING_REVIEW else ""
    approved_at = now_ts if candidate_status in {FOOD_CANDIDATE_STATUS_APPROVED, FOOD_CANDIDATE_STATUS_PENDING_EAT} else 0
    version_id = ""
    with db_connection() as conn:
        if get_food_item_by_key(conn, food_key):
            raise HTTPException(status_code=400, detail="food_key 已存在")
        conn.execute(
            """
            INSERT INTO food_items
            (food_key, name, category_key, brand_key, brand_name, brand_combo, candidate_status, note, enabled, daily_price_min, daily_price_max, party_price_min, party_price_max, distance_km, strategy_override_json, created_by_student_id, approved_by_student_id, approved_at, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                food_key,
                name,
                category_key,
                brand_key,
                brand_name,
                brand_combo,
                candidate_status,
                note,
                enabled_value,
                float(body.daily_price_min),
                float(body.daily_price_max),
                float(body.party_price_min),
                float(body.party_price_max),
                float(body.distance_km),
                json.dumps(override_payload, ensure_ascii=False),
                "",
                approved_by_student_id,
                approved_at,
                now_ts,
                now_ts,
            ),
        )
        item = get_food_item_by_key(conn, food_key)
        category_rules = get_food_category_pricing_rule_map(conn)
        payload = build_food_item_payload(item or {}, template_key=FOOD_TEMPLATE_DAILY, headcount=1, category_rules=category_rules)
        version_id = record_food_item_pricing_override_version(
            conn,
            food_key=food_key,
            strategy_override_json=override_payload,
            operator_student_id=DEFAULT_ADMIN_STUDENT_ID,
        )
    return {"ok": True, "item": payload, "versionId": version_id}


@app.put("/api/admin/foods/{food_key}")
def admin_update_food_item(food_key: str, body: AdminUpdateFoodItemRequest, request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    normalized_path_key = trim_profile_text(food_key, max_length=40).lower()
    if not normalized_path_key:
        raise HTTPException(status_code=400, detail="food_key 不能为空")
    if body.daily_price_max < body.daily_price_min:
        raise HTTPException(status_code=400, detail="daily_price_max 不能小于 daily_price_min")
    if body.party_price_max < body.party_price_min:
        raise HTTPException(status_code=400, detail="party_price_max 不能小于 party_price_min")
    now_ts = int(time.time())
    version_id = ""
    with db_connection() as conn:
        current = get_food_item_by_key(conn, normalized_path_key)
        if not current:
            raise HTTPException(status_code=404, detail="食物不存在")
        override_payload = (
            normalize_food_pricing_override(body.strategy_override_json)
            if body.strategy_override_json is not None
            else normalize_food_pricing_override(current.get("strategy_override_json"))
        )
        candidate_status = (
            normalize_food_candidate_status(body.candidate_status, FOOD_CANDIDATE_STATUS_APPROVED)
            if body.candidate_status is not None
            else normalize_food_candidate_status(current.get("candidate_status"), FOOD_CANDIDATE_STATUS_APPROVED)
        )
        note = trim_profile_text(body.note, max_length=240) if body.note is not None else trim_profile_text(current.get("note"), max_length=240)
        next_brand_key = (
            normalize_food_brand_key(body.brand_key)
            if body.brand_key is not None
            else normalize_food_brand_key(current.get("brand_key"))
        )
        if body.brand_name is not None:
            next_brand_name = trim_profile_text(body.brand_name, max_length=40) or FOOD_BRAND_NAME_MAP.get(next_brand_key, "")
        else:
            next_brand_name = trim_profile_text(current.get("brand_name"), max_length=40) or FOOD_BRAND_NAME_MAP.get(next_brand_key, "")
        next_brand_combo = (
            trim_profile_text(body.brand_combo, max_length=80)
            if body.brand_combo is not None
            else trim_profile_text(current.get("brand_combo"), max_length=80)
        )
        enabled_value = 1 if (body.enabled if body.enabled is not None else bool(current.get("enabled"))) else 0
        if candidate_status == FOOD_CANDIDATE_STATUS_PENDING_REVIEW:
            enabled_value = 0
        approved_by_student_id = trim_profile_text(current.get("approved_by_student_id"), max_length=40)
        approved_at = normalize_int_value(current.get("approved_at"), 0)
        if body.candidate_status is not None:
            if candidate_status in {FOOD_CANDIDATE_STATUS_APPROVED, FOOD_CANDIDATE_STATUS_PENDING_EAT, FOOD_CANDIDATE_STATUS_REJECTED}:
                approved_by_student_id = "admin"
                approved_at = now_ts
            else:
                approved_by_student_id = ""
                approved_at = 0
        conn.execute(
            """
            UPDATE food_items
            SET name=?, category_key=?, brand_key=?, brand_name=?, brand_combo=?, candidate_status=?, note=?, enabled=?, daily_price_min=?, daily_price_max=?, party_price_min=?, party_price_max=?, distance_km=?, strategy_override_json=?, approved_by_student_id=?, approved_at=?, updated_at=?
            WHERE food_key=?
            """,
            (
                trim_profile_text(body.name, max_length=50),
                trim_profile_text(body.category_key, max_length=40).lower(),
                next_brand_key,
                next_brand_name,
                next_brand_combo,
                candidate_status,
                note,
                enabled_value,
                float(body.daily_price_min),
                float(body.daily_price_max),
                float(body.party_price_min),
                float(body.party_price_max),
                float(body.distance_km),
                json.dumps(override_payload, ensure_ascii=False),
                approved_by_student_id,
                approved_at,
                now_ts,
                normalized_path_key,
            ),
        )
        item = get_food_item_by_key(conn, normalized_path_key)
        category_rules = get_food_category_pricing_rule_map(conn)
        payload = build_food_item_payload(item or {}, template_key=FOOD_TEMPLATE_DAILY, headcount=1, category_rules=category_rules)
        version_id = record_food_item_pricing_override_version(
            conn,
            food_key=normalized_path_key,
            strategy_override_json=override_payload,
            operator_student_id=DEFAULT_ADMIN_STUDENT_ID,
        )
    return {"ok": True, "item": payload, "versionId": version_id}


@app.post("/api/admin/foods/{food_key}/active")
def admin_toggle_food_item_active(food_key: str, body: SocialToggleFoodItemActiveRequest, request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    normalized_key = trim_profile_text(food_key, max_length=40).lower()
    with db_connection() as conn:
        item = get_food_item_by_key(conn, normalized_key)
        if not item:
            raise HTTPException(status_code=404, detail="食物不存在")
        conn.execute(
            "UPDATE food_items SET enabled=?, updated_at=? WHERE food_key=?",
            (1 if body.enabled else 0, int(time.time()), normalized_key),
        )
        item = get_food_item_by_key(conn, normalized_key)
        category_rules = get_food_category_pricing_rule_map(conn)
        payload = build_food_item_payload(item or {}, template_key=FOOD_TEMPLATE_DAILY, headcount=1, category_rules=category_rules)
    return {"ok": True, "item": payload}


@app.post("/api/admin/foods/{food_key}/review")
def admin_review_food_item(food_key: str, body: AdminReviewFoodItemRequest, request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    normalized_key = trim_profile_text(food_key, max_length=40).lower()
    if not normalized_key:
        raise HTTPException(status_code=400, detail="food_key 不能为空")
    target_status = normalize_food_candidate_status(body.candidate_status, "")
    if target_status not in FOOD_CANDIDATE_STATUS_KEYS:
        raise HTTPException(status_code=400, detail="candidate_status 非法")
    now_ts = int(time.time())
    with db_connection() as conn:
        item = get_food_item_by_key(conn, normalized_key)
        if not item:
            raise HTTPException(status_code=404, detail="食物不存在")
        enabled_value = bool(item.get("enabled"))
        if body.enabled is not None:
            enabled_value = bool(body.enabled)
        elif target_status == FOOD_CANDIDATE_STATUS_APPROVED:
            enabled_value = True
        elif target_status == FOOD_CANDIDATE_STATUS_PENDING_REVIEW:
            enabled_value = False
        approved_by_student_id = "admin"
        approved_at = now_ts
        if target_status == FOOD_CANDIDATE_STATUS_PENDING_REVIEW:
            approved_by_student_id = ""
            approved_at = 0
        conn.execute(
            """
            UPDATE food_items
            SET candidate_status=?, enabled=?, approved_by_student_id=?, approved_at=?, updated_at=?
            WHERE food_key=?
            """,
            (
                target_status,
                1 if enabled_value else 0,
                approved_by_student_id,
                approved_at,
                now_ts,
                normalized_key,
            ),
        )
        item = get_food_item_by_key(conn, normalized_key)
        category_rules = get_food_category_pricing_rule_map(conn)
        payload = build_food_item_payload(item or {}, template_key=FOOD_TEMPLATE_DAILY, headcount=1, category_rules=category_rules)
    return {"ok": True, "item": payload}


@app.get("/api/admin/food-pricing-rules")
def admin_get_food_pricing_rules(request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    with db_connection() as conn:
        items = list_food_category_pricing_rules(conn)
    return {"ok": True, "globalDefault": FOOD_GLOBAL_PRICING_DEFAULT, "items": items}


@app.post("/api/admin/food-pricing-rules")
def admin_save_food_pricing_rules(body: AdminSaveFoodCategoryRulesRequest, request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    now_ts = int(time.time())
    version_payloads: List[Dict[str, Any]] = []
    with db_connection() as conn:
        for item in body.items:
            normalized = normalize_food_pricing_rule(
                trend_mode=item.trend_mode,
                anchor_headcount=item.anchor_headcount,
                slope=item.slope,
                min_factor=item.min_factor,
                max_factor=item.max_factor,
            )
            normalized_category_key = trim_profile_text(item.category_key, max_length=40).lower()
            normalized_category_name = trim_profile_text(item.category_name, max_length=40)
            conn.execute(
                """
                INSERT INTO food_category_pricing_rules
                (category_key, category_name, trend_mode, anchor_headcount, slope, min_factor, max_factor, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(category_key) DO UPDATE SET
                  category_name=excluded.category_name,
                  trend_mode=excluded.trend_mode,
                  anchor_headcount=excluded.anchor_headcount,
                  slope=excluded.slope,
                  min_factor=excluded.min_factor,
                  max_factor=excluded.max_factor,
                  updated_at=excluded.updated_at
                """,
                (
                    normalized_category_key,
                    normalized_category_name,
                    normalized["trend_mode"],
                    normalized["anchor_headcount"],
                    normalized["slope"],
                    normalized["min_factor"],
                    normalized["max_factor"],
                    now_ts,
                ),
            )
            version_payloads.append(
                {
                    "category_key": normalized_category_key,
                    "category_name": normalized_category_name,
                    **normalized,
                }
            )
        version_id = record_food_category_rule_versions(
            conn,
            items=version_payloads,
            operator_student_id=DEFAULT_ADMIN_STUDENT_ID,
        )
        rows = list_food_category_pricing_rules(conn)
    return {"ok": True, "globalDefault": FOOD_GLOBAL_PRICING_DEFAULT, "items": rows, "versionId": version_id}


@app.post("/api/admin/food-pricing-rules/preview")
def admin_preview_food_pricing_rules(body: AdminFoodPricingPreviewRequest, request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    template_key = normalize_food_template_key(body.template_key)
    headcount_start = max(1, min(200, int(body.headcount_start or 1)))
    headcount_end = max(1, min(200, int(body.headcount_end or 50)))
    headcount_step = max(1, min(20, int(body.headcount_step or 1)))
    normalized_food_key = trim_profile_text(body.food_key, max_length=40).lower()
    normalized_category_key = trim_profile_text(body.category_key, max_length=40).lower()
    with db_connection() as conn:
        category_rules = get_food_category_pricing_rule_map(conn)
        food_item: Optional[Dict[str, Any]] = None
        if normalized_food_key:
            food_item = get_food_item_by_key(conn, normalized_food_key)
            if not food_item:
                raise HTTPException(status_code=404, detail="food_key 对应的食物不存在")

        if not normalized_category_key and food_item:
            normalized_category_key = trim_profile_text(food_item.get("category_key"), max_length=40).lower()
        if not normalized_category_key:
            raise HTTPException(status_code=400, detail="category_key 不能为空（可直接传 food_key 自动推导）")

        if food_item:
            base_price_min, base_price_max = resolve_food_base_price_range(food_item, template_key)
        else:
            if body.base_price_min is None or body.base_price_max is None:
                raise HTTPException(status_code=400, detail="未提供 food_key 时，base_price_min 与 base_price_max 必填")
            base_price_min = max(0.0, float(body.base_price_min))
            base_price_max = max(base_price_min, float(body.base_price_max))

        if body.base_price_min is not None:
            base_price_min = max(0.0, float(body.base_price_min))
        if body.base_price_max is not None:
            base_price_max = max(base_price_min, float(body.base_price_max))
        if base_price_max < base_price_min:
            raise HTTPException(status_code=400, detail="base_price_max 不能小于 base_price_min")

        strategy_override = normalize_food_pricing_override(
            body.strategy_override_json
            if body.strategy_override_json is not None
            else (food_item.get("strategy_override_json") if food_item else {})
        )
        preview_food_item = build_food_pricing_preview_food_item(
            template_key=template_key,
            category_key=normalized_category_key,
            strategy_override_json=strategy_override,
            base_price_min=base_price_min,
            base_price_max=base_price_max,
        )
        points = build_food_pricing_curve_points(
            food_item=preview_food_item,
            template_key=template_key,
            headcount_start=headcount_start,
            headcount_end=headcount_end,
            headcount_step=headcount_step,
            category_rules=category_rules,
        )
        merged_rule = merge_food_pricing_rule(
            category_rule=category_rules.get(normalized_category_key),
            strategy_override=strategy_override,
        )
        category_name = str((category_rules.get(normalized_category_key) or {}).get("category_name") or normalized_category_key)
    return {
        "ok": True,
        "preview": {
            "templateKey": template_key,
            "foodKey": normalized_food_key,
            "categoryKey": normalized_category_key,
            "categoryName": category_name,
            "basePriceMin": round(base_price_min, 2),
            "basePriceMax": round(base_price_max, 2),
            "headcountStart": min(headcount_start, headcount_end),
            "headcountEnd": max(headcount_start, headcount_end),
            "headcountStep": headcount_step,
            "rule": merged_rule,
            "strategyOverride": strategy_override,
            "points": points,
        },
    }


@app.get("/api/admin/food-pricing-rules/history")
def admin_get_food_pricing_rule_history(
    request: Request,
    category_key: str = "",
    limit: int = 200,
) -> Dict[str, Any]:
    require_admin_session(request)
    with db_connection() as conn:
        items = list_food_category_pricing_rule_version_history(conn, category_key=category_key, limit=limit)
    return {"ok": True, "items": items}


@app.get("/api/admin/foods/{food_key}/pricing-history")
def admin_get_food_item_pricing_history(food_key: str, request: Request, limit: int = 200) -> Dict[str, Any]:
    require_admin_session(request)
    normalized_food_key = trim_profile_text(food_key, max_length=40).lower()
    if not normalized_food_key:
        raise HTTPException(status_code=400, detail="food_key 不能为空")
    with db_connection() as conn:
        if not get_food_item_by_key(conn, normalized_food_key):
            raise HTTPException(status_code=404, detail="食物不存在")
        items = list_food_item_pricing_override_version_history(conn, normalized_food_key, limit=limit)
    return {"ok": True, "foodKey": normalized_food_key, "items": items}


@app.post("/api/admin/food-pricing-rules/rollback")
def admin_rollback_food_pricing_rules(body: AdminFoodPricingRollbackRequest, request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    source_version_id = trim_profile_text(body.version_id, max_length=80)
    if not source_version_id:
        raise HTTPException(status_code=400, detail="version_id 不能为空")
    now_ts = int(time.time())
    with db_connection() as conn:
        rows = conn.execute(
            """
            SELECT category_key, category_name, trend_mode, anchor_headcount, slope, min_factor, max_factor
            FROM food_category_pricing_rule_versions
            WHERE version_id=?
            ORDER BY id ASC
            """,
            (source_version_id,),
        ).fetchall()
        if not rows:
            raise HTTPException(status_code=404, detail="未找到对应的分类规则版本")
        rollback_payloads: List[Dict[str, Any]] = []
        for row in rows:
            normalized = normalize_food_pricing_rule(
                trend_mode=row["trend_mode"],
                anchor_headcount=row["anchor_headcount"],
                slope=row["slope"],
                min_factor=row["min_factor"],
                max_factor=row["max_factor"],
            )
            category_key = trim_profile_text(row["category_key"], max_length=40).lower()
            category_name = trim_profile_text(row["category_name"], max_length=40) or category_key
            conn.execute(
                """
                INSERT INTO food_category_pricing_rules
                (category_key, category_name, trend_mode, anchor_headcount, slope, min_factor, max_factor, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(category_key) DO UPDATE SET
                  category_name=excluded.category_name,
                  trend_mode=excluded.trend_mode,
                  anchor_headcount=excluded.anchor_headcount,
                  slope=excluded.slope,
                  min_factor=excluded.min_factor,
                  max_factor=excluded.max_factor,
                  updated_at=excluded.updated_at
                """,
                (
                    category_key,
                    category_name,
                    normalized["trend_mode"],
                    normalized["anchor_headcount"],
                    normalized["slope"],
                    normalized["min_factor"],
                    normalized["max_factor"],
                    now_ts,
                ),
            )
            rollback_payloads.append(
                {
                    "category_key": category_key,
                    "category_name": category_name,
                    **normalized,
                }
            )
        new_version_id = record_food_category_rule_versions(
            conn,
            items=rollback_payloads,
            operator_student_id=DEFAULT_ADMIN_STUDENT_ID,
        )
        items = list_food_category_pricing_rules(conn)
    return {
        "ok": True,
        "sourceVersionId": source_version_id,
        "versionId": new_version_id,
        "globalDefault": FOOD_GLOBAL_PRICING_DEFAULT,
        "items": items,
    }


@app.post("/api/admin/foods/{food_key}/pricing-rollback")
def admin_rollback_food_item_pricing(
    food_key: str,
    body: AdminFoodPricingRollbackRequest,
    request: Request,
) -> Dict[str, Any]:
    require_admin_session(request)
    normalized_food_key = trim_profile_text(food_key, max_length=40).lower()
    if not normalized_food_key:
        raise HTTPException(status_code=400, detail="food_key 不能为空")
    source_version_id = trim_profile_text(body.version_id, max_length=80)
    if not source_version_id:
        raise HTTPException(status_code=400, detail="version_id 不能为空")
    with db_connection() as conn:
        current = get_food_item_by_key(conn, normalized_food_key)
        if not current:
            raise HTTPException(status_code=404, detail="食物不存在")
        row = conn.execute(
            """
            SELECT strategy_override_json
            FROM food_item_pricing_override_versions
            WHERE version_id=? AND food_key=?
            ORDER BY id DESC
            LIMIT 1
            """,
            (source_version_id, normalized_food_key),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="未找到对应的食物定价版本")
        override_payload = normalize_food_pricing_override(row["strategy_override_json"])
        now_ts = int(time.time())
        conn.execute(
            """
            UPDATE food_items
            SET strategy_override_json=?, updated_at=?
            WHERE food_key=?
            """,
            (json.dumps(override_payload, ensure_ascii=False), now_ts, normalized_food_key),
        )
        item = get_food_item_by_key(conn, normalized_food_key)
        category_rules = get_food_category_pricing_rule_map(conn)
        payload = build_food_item_payload(item or {}, template_key=FOOD_TEMPLATE_DAILY, headcount=1, category_rules=category_rules)
        new_version_id = record_food_item_pricing_override_version(
            conn,
            food_key=normalized_food_key,
            strategy_override_json=override_payload,
            operator_student_id=DEFAULT_ADMIN_STUDENT_ID,
        )
    return {"ok": True, "sourceVersionId": source_version_id, "versionId": new_version_id, "item": payload}


@app.get("/api/admin/food-campaigns")
def admin_list_food_campaigns(request: Request, status: str = "all") -> Dict[str, Any]:
    require_admin_session(request)
    normalized_status = str(status or "all").strip().lower()
    if normalized_status not in {"open", "closed", "all"}:
        raise HTTPException(status_code=400, detail="status 仅支持 open|closed|all")
    with db_connection() as conn:
        rows = conn.execute("SELECT * FROM food_campaigns ORDER BY created_at DESC").fetchall()
        items: List[Dict[str, Any]] = []
        for row in rows:
            campaign = auto_close_food_campaign_if_needed(conn, dict(row))
            status_value = normalize_food_campaign_status(campaign.get("status"))
            if normalized_status == "open" and status_value != FOOD_CAMPAIGN_STATUS_OPEN:
                continue
            if normalized_status == "closed" and status_value == FOOD_CAMPAIGN_STATUS_OPEN:
                continue
            summary = build_food_campaign_summary_payload(campaign)
            summary["candidateCount"] = int(
                conn.execute("SELECT COUNT(1) AS c FROM food_campaign_candidates WHERE campaign_id=?", (summary["campaignId"],)).fetchone()["c"]
            )
            summary["headcount"] = get_food_campaign_vote_headcount(conn, summary["campaignId"])
            items.append(summary)
    return {"ok": True, "items": items}


@app.get("/api/admin/food-campaigns/{campaign_id}")
def admin_get_food_campaign_detail(campaign_id: str, request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    with db_connection() as conn:
        campaign = require_food_campaign(conn, campaign_id)
        detail = build_food_campaign_detail_payload(
            conn,
            campaign,
            viewer_student_id=DEFAULT_ADMIN_STUDENT_ID,
            share_token_granted=True,
            force_reveal_realname=True,
        )
    return {"ok": True, "campaign": detail}


@app.post("/api/admin/food-campaigns/{campaign_id}/force-close")
def admin_force_close_food_campaign(campaign_id: str, request: Request) -> Dict[str, Any]:
    require_admin_session(request)
    with db_connection() as conn:
        campaign = require_food_campaign(conn, campaign_id)
        if normalize_food_campaign_status(campaign.get("status")) == FOOD_CAMPAIGN_STATUS_OPEN:
            close_food_campaign(conn, campaign_id)
        campaign = require_food_campaign(conn, campaign_id)
        detail = build_food_campaign_detail_payload(
            conn,
            campaign,
            viewer_student_id=DEFAULT_ADMIN_STUDENT_ID,
            share_token_granted=True,
            force_reveal_realname=True,
        )
    return {"ok": True, "campaign": detail}


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
        owner_scope="theme",
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
    student_id = resolve_student_id_for_bind_target(body.name)
    if not student_id:
        raise HTTPException(status_code=404, detail="未找到对应课表（姓名/学号）")

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
