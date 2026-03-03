from __future__ import annotations

import asyncio
import base64
import csv
import hashlib
import json
import os
import re
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

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, PlainTextResponse
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
PUSH_MODE = os.getenv("PUSH_MODE", "xizhi")  # xizhi | wecom | mock
XIZHI_DEFAULT_CHANNEL_URL = os.getenv("XIZHI_DEFAULT_CHANNEL_URL", "")
WECOM_API_BASE = os.getenv("WECOM_API_BASE", "https://qyapi.weixin.qq.com").rstrip("/")
WECOM_CORP_ID = os.getenv("WECOM_CORP_ID", "").strip()
WECOM_AGENT_ID = os.getenv("WECOM_AGENT_ID", "").strip()
WECOM_CORP_SECRET = os.getenv("WECOM_CORP_SECRET", "").strip()
WECOM_DEFAULT_TOUSER = os.getenv("WECOM_DEFAULT_TOUSER", "").strip()
WECOM_CALLBACK_TOKEN = os.getenv("WECOM_CALLBACK_TOKEN", "").strip()
WECOM_CALLBACK_AES_KEY = os.getenv("WECOM_CALLBACK_AES_KEY", "").strip()
CORS_ALLOW_ORIGINS = os.getenv("CORS_ALLOW_ORIGINS", "*")
COURSE_CSV_PATH = Path(os.getenv("COURSE_CSV_PATH", str(BASE_DIR.parent.parent / "src/data/normalized/courses.normalized.csv")))

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
    11: {"start": "20:50", "end": "21:35", "part": "晚上"},
    12: {"start": "21:40", "end": "22:25", "part": "晚上"},
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

SCHEDULES: Dict[str, Dict[str, Any]] = {
    "caiziling": {"name": "蔡子菱", "courses": CAIZILING_COURSES},
    "mawanqing": {
        "name": "马晚晴",
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
    "wuxinyu": {"name": "伍鑫宇", "courses": CAIZILING_COURSES},
}

NAME_ALIASES: Dict[str, str] = {
    "蔡子菱": "caiziling",
    "马晚晴": "mawanqing",
    "唐子贤": "tangzixian",
    "伍鑫宇": "wuxinyu",
    "caiziling": "caiziling",
    "mawanqing": "mawanqing",
    "tangzixian": "tangzixian",
    "wuxinyu": "wuxinyu",
}


def normalize_course_name(name: str) -> str:
    return re.sub(r"\s+", "", (name or "")).strip().lower()


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
        if not rows and student_id == "wuxinyu":
            rows = overrides.get("caiziling")
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


apply_course_overrides_to_schedules(load_course_overrides_from_csv(COURSE_CSV_PATH))

DAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]

DEFAULT_TITLE_TEMPLATE = "{display_name}提醒您，{offset} 分钟后即将上课"
DEFAULT_CONTENT_TEMPLATE = "\n".join(
    [
        "课程：{course_name}",
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
        "3) test - 测试推送",
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


class RunOnceResponse(BaseModel):
    sent: int


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


def ensure_channel_url(channel_url: Optional[str]) -> str:
    url = (channel_url or XIZHI_DEFAULT_CHANNEL_URL).strip()
    if not url:
        raise HTTPException(status_code=400, detail="缺少 channel_url，且未配置 XIZHI_DEFAULT_CHANNEL_URL")
    if not url.startswith("http"):
        raise HTTPException(status_code=400, detail="channel_url 格式错误")
    return url


def build_channel_url_from_token(channel_token: Optional[str]) -> Optional[str]:
    token = (channel_token or "").strip()
    if not token:
        return None
    if token.startswith("http://") or token.startswith("https://"):
        return token
    return f"https://xizhi.qqoq.net/{token}.channel"


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


def serialize_subscriber_row(row: sqlite3.Row) -> Dict[str, Any]:
    item = dict(row)
    item["active"] = bool(item.get("active", 0))
    item["disabled_days"] = parse_disabled_days(item.get("disabled_days"))
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


def init_db() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
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
            CREATE TABLE IF NOT EXISTS app_settings (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL,
              updated_at INTEGER NOT NULL
            )
            """
        )

        columns = {row[1] for row in conn.execute("PRAGMA table_info(subscribers)").fetchall()}
        if "display_name" not in columns:
            conn.execute("ALTER TABLE subscribers ADD COLUMN display_name TEXT NOT NULL DEFAULT ''")
        if "disabled_days" not in columns:
            conn.execute("ALTER TABLE subscribers ADD COLUMN disabled_days TEXT NOT NULL DEFAULT '[]'")

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

        for key, value in {
            "wecom_api_base": WECOM_API_BASE,
            "wecom_corp_id": WECOM_CORP_ID,
            "wecom_agent_id": WECOM_AGENT_ID,
            "wecom_corp_secret": WECOM_CORP_SECRET,
            "wecom_default_touser": WECOM_DEFAULT_TOUSER,
            "wecom_callback_token": WECOM_CALLBACK_TOKEN,
            "wecom_callback_aes_key": WECOM_CALLBACK_AES_KEY,
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


def upsert_subscriber(
    subscriber_key: str,
    name: str,
    student_id: str,
    channel_url: str,
    display_name: str,
    disabled_days: List[int],
) -> None:
    now_ts = int(time.time())
    disabled_days_json = encode_disabled_days(disabled_days)
    with db_connection() as conn:
        conn.execute(
            """
            INSERT INTO subscribers
            (subscriber_key, name, student_id, channel_url, display_name, disabled_days, active, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(subscriber_key) DO UPDATE SET
              name=excluded.name,
              student_id=excluded.student_id,
              channel_url=excluded.channel_url,
              display_name=excluded.display_name,
              disabled_days=excluded.disabled_days,
              active=1,
              updated_at=excluded.updated_at
            """,
            (subscriber_key, name, student_id, channel_url, display_name, disabled_days_json, now_ts, now_ts),
        )


def set_subscriber_active(subscriber_key: str, active: bool) -> bool:
    with db_connection() as conn:
        cur = conn.execute(
            "UPDATE subscribers SET active=?, updated_at=? WHERE subscriber_key=?",
            (1 if active else 0, int(time.time()), subscriber_key),
        )
    return cur.rowcount > 0


def list_subscribers() -> List[Dict[str, Any]]:
    with db_connection() as conn:
        rows = conn.execute(
            """
            SELECT subscriber_key, name, student_id, channel_url, display_name, disabled_days, active, updated_at
            FROM subscribers
            ORDER BY id DESC
            """
        ).fetchall()
    return [serialize_subscriber_row(row) for row in rows]


def list_active_subscribers() -> List[Dict[str, Any]]:
    with db_connection() as conn:
        rows = conn.execute(
            """
            SELECT subscriber_key, name, student_id, channel_url, display_name, disabled_days
            FROM subscribers
            WHERE active=1
            """
        ).fetchall()
    return [serialize_subscriber_row(row) for row in rows]


def get_subscriber_by_key(subscriber_key: str) -> Optional[Dict[str, Any]]:
    with db_connection() as conn:
        row = conn.execute(
            """
            SELECT subscriber_key, name, student_id, channel_url, display_name, disabled_days, active
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
    now_ts = int(now.timestamp())
    current_week = get_week_by_datetime(now)
    due_items: List[Dict[str, Any]] = []

    for week_no in range(current_week, min(current_week + 2, 25) + 1):
        for course in get_week_courses(student_id, week_no):
            if int(course["day"]) in disabled_days:
                continue
            start_dt = lesson_start_datetime(week_no, course["day"], course["startSection"])
            start_ts = int(start_dt.timestamp())

            for offset in REMINDER_OFFSETS:
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
    start_section = SECTION_TIMES[course["startSection"]]
    end_section = SECTION_TIMES[course["endSection"]]
    now_text = (now or get_now()).strftime("%Y-%m-%d %H:%M:%S")
    day_label = DAY_LABELS[course["day"] - 1]
    return {
        "name": item["name"],
        "display_name": normalize_display_name(item.get("display_name"), item["name"]),
        "offset": item.get("offset", ""),
        "course_name": course["name"],
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


def find_subscriber_by_wecom_userid(user_id: str) -> Optional[Dict[str, Any]]:
    channel = build_wecom_channel(user_id)
    with db_connection() as conn:
        row = conn.execute(
            """
            SELECT subscriber_key, name, student_id, channel_url, display_name, disabled_days, active
            FROM subscribers
            WHERE channel_url=?
            LIMIT 1
            """,
            (channel,),
        ).fetchone()
    if row is None:
        return None
    return serialize_subscriber_row(row)


def bind_wecom_user_to_student(user_id: str, name: str) -> Dict[str, Any]:
    student_id = resolve_student_id_by_name(name)
    if not student_id:
        raise RuntimeError("未找到该姓名，请发送：bind 蔡子菱 / 马晚晴 / 唐子贤 / 伍鑫宇")

    canonical_name = SCHEDULES[student_id]["name"]
    subscriber_key = f"wecom-{user_id.strip()}"
    existing = get_subscriber_by_key(subscriber_key)
    display_name = normalize_display_name(existing.get("display_name") if existing else canonical_name, canonical_name)
    disabled_days = parse_disabled_days(existing.get("disabled_days") if existing else [])
    upsert_subscriber(
        subscriber_key=subscriber_key,
        name=canonical_name,
        student_id=student_id,
        channel_url=build_wecom_channel(user_id),
        display_name=display_name,
        disabled_days=disabled_days,
    )
    bound = get_subscriber_by_key(subscriber_key)
    if bound is None:
        raise RuntimeError("绑定失败，请稍后重试")
    return bound


def build_bound_text(subscriber: Dict[str, Any]) -> str:
    return f"{subscriber['name']}（student_id: {subscriber['student_id']}）"


def handle_wecom_text_command(user_id: str, content: str) -> str:
    cmd = (content or "").strip()
    if not cmd:
        return "未识别到内容，请发送 help 查看命令。"

    lowered = cmd.lower()
    if lowered == "help":
        current = find_subscriber_by_wecom_userid(user_id)
        if current:
            return f"{WECOM_HELP_TEXT}\n\n当前绑定：{build_bound_text(current)}"
        return f"{WECOM_HELP_TEXT}\n\n当前未绑定课表。"

    bind_match = re.match(r"^bind\s*(.+)$", cmd, flags=re.IGNORECASE)
    if bind_match:
        target_name = bind_match.group(1).strip()
        if not target_name:
            return "绑定格式错误，请发送：bind 姓名（例：bind 唐子贤）"
        bound = bind_wecom_user_to_student(user_id, target_name)
        return f"已绑定：{build_bound_text(bound)}\n发送 test 可测试推送。"

    if lowered == "test":
        sub = find_subscriber_by_wecom_userid(user_id)
        if not sub:
            return "你还没绑定课表，请先发送：bind 姓名"
        title, msg_content = build_test_push_payload(sub)
        send_wecom_text(title=title, content=msg_content, touser=user_id)
        return f"测试推送已发送。\n当前绑定：{build_bound_text(sub)}"

    return "未识别命令，请发送 help 查看菜单。"


def send_xizhi(channel_url: str, title: str, content: str) -> None:
    payload = urllib.parse.urlencode({"title": title, "content": content}).encode("utf-8")
    request = urllib.request.Request(
        url=channel_url,
        data=payload,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(request, timeout=8) as response:
            body = response.read().decode("utf-8", "ignore")
            if body:
                try:
                    parsed = json.loads(body)
                    code = parsed.get("code")
                    if code not in (None, 200, "200"):
                        raise RuntimeError(f"xizhi 返回异常: {parsed}")
                except json.JSONDecodeError:
                    pass
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"xizhi 请求失败: {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"xizhi 网络错误: {exc.reason}") from exc


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

    channel = (channel_url or "").strip()
    if is_wecom_channel_url(channel):
        send_wecom_text(title=title, content=content, touser=parse_wecom_userid(channel))
        return
    if channel.startswith("http://") or channel.startswith("https://"):
        send_xizhi(channel, title, content)
        return

    if PUSH_MODE == "xizhi":
        send_xizhi(channel_url, title, content)
        return
    if PUSH_MODE == "wecom":
        send_wecom_text(title=title, content=content, touser=parse_wecom_userid(channel_url))
        return
    raise RuntimeError(f"不支持的 PUSH_MODE: {PUSH_MODE}")


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
    return sent


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
    init_db()
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


def build_admin_html() -> str:
    return """<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TouchX 推送配置</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#f6f8fb; margin:0; color:#1f2937; }
    .wrap { max-width: 1180px; margin: 24px auto; padding: 0 16px; }
    .card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:16px; margin-bottom:14px; }
    .title { font-size:22px; font-weight:700; margin:0 0 8px; }
    .muted { color:#6b7280; font-size:13px; margin:0; }
    .btn { border:0; border-radius:8px; background:#2563eb; color:#fff; padding:8px 12px; cursor:pointer; font-size:14px; }
    .btn.gray { background:#4b5563; }
    .btn:disabled { background:#9ca3af; cursor:not-allowed; }
    textarea, input[type=text] { width:100%; box-sizing:border-box; border:1px solid #d1d5db; border-radius:8px; padding:8px; font-size:14px; }
    textarea { min-height:88px; resize:vertical; line-height:1.5; }
    .form-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:12px; }
    .label { font-size:13px; color:#374151; font-weight:600; margin-bottom:6px; display:block; }
    table { width:100%; border-collapse: collapse; font-size:14px; }
    th, td { border-bottom:1px solid #e5e7eb; padding:10px 8px; text-align:left; vertical-align:middle; }
    th { color:#374151; background:#f9fafb; }
    .row-actions { display:flex; gap:8px; }
    .day-grid { display:flex; flex-wrap:wrap; gap:6px; }
    .day-pill { border:1px solid #d1d5db; border-radius:999px; padding:3px 8px; font-size:12px; background:#fff; white-space:nowrap; }
    .day-pill input { margin-right:4px; vertical-align:middle; }
    .ok { color:#047857; font-size:13px; }
    .err { color:#b91c1c; font-size:13px; white-space: pre-wrap; }
    .top-actions { display:flex; gap:8px; margin-top:12px; }
    @media (max-width: 960px) {
      .form-grid { grid-template-columns:1fr; }
      table { font-size:13px; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1 class="title">TouchX 第三方推送配置</h1>
      <p class="muted">支持 xizhi 与企业微信自建应用。系统按课表在上课前 30 分钟和 15 分钟自动推送。</p>
      <div class="top-actions">
        <button class="btn gray" onclick="refreshAll()">刷新</button>
        <button class="btn" onclick="runOnce()">手动跑一轮提醒</button>
      </div>
      <div id="globalMsg" class="muted" style="margin-top:8px;"></div>
    </div>

    <div class="card">
      <h2 style="margin:0 0 6px;">企业微信自建应用鉴权</h2>
      <p class="muted">网页里可直接配置并自动存储：api_base、corp_id、agent_id、corp_secret、default_touser、callback_token、callback_aes_key。</p>
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
          <input id="wecomCorpSecret" type="text" placeholder="企业微信应用 Secret（可留空沿用旧值）" />
        </div>
        <div>
          <label class="label" for="wecomDefaultTouser">Default Touser</label>
          <input id="wecomDefaultTouser" type="text" placeholder="zhangsan 或 @all" />
        </div>
        <div>
          <label class="label" for="wecomCallbackToken">Callback Token</label>
          <input id="wecomCallbackToken" type="text" placeholder="回调校验 token（可留空沿用旧值）" />
        </div>
        <div style="grid-column:1 / -1;">
          <label class="label" for="wecomCallbackAesKey">Callback AES Key</label>
          <input id="wecomCallbackAesKey" type="text" placeholder="43位 EncodingAESKey（可留空沿用旧值）" />
        </div>
      </div>
      <div class="top-actions">
        <button class="btn" onclick="saveWecom()">保存配置</button>
        <button class="btn gray" onclick="testWecom()">测试连接</button>
      </div>
      <div id="wecomMsg" class="muted" style="margin-top:8px;"></div>
    </div>

    <div class="card">
      <h2 style="margin:0 0 6px;">企业微信绑定用户</h2>
      <p class="muted">这里展示通过消息命令 bind 绑定的用户，可直接点“测试推送”模拟发送。</p>
      <div class="top-actions">
        <button class="btn gray" onclick="refreshBindings()">刷新绑定列表</button>
      </div>
      <div id="wecomBindingMsg" class="muted" style="margin-top:8px;"></div>
      <table style="margin-top:10px;">
        <thead>
          <tr>
            <th style="width:130px;">WeCom UserID</th>
            <th style="width:100px;">姓名</th>
            <th style="width:120px;">课表ID</th>
            <th style="width:80px;">启用</th>
            <th style="width:170px;">更新时间</th>
            <th style="width:140px;">操作</th>
          </tr>
        </thead>
        <tbody id="wecomBindingRows"></tbody>
      </table>
    </div>

    <div class="card">
      <h2 style="margin:0 0 6px;">推送文案模板</h2>
      <p class="muted">支持变量：{display_name}、{offset}、{course_name}、{week_no}、{day_label}、{start_section}、{end_section}、{start_time}、{end_time}、{part}、{lesson_time}、{now_text}</p>
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

    <div class="card">
      <table>
        <thead>
          <tr>
            <th style="width:110px;">姓名</th>
            <th style="width:120px;">称呼</th>
            <th>token（或完整 channel URL）</th>
            <th style="width:260px;">关闭推送日</th>
            <th style="width:70px;">启用</th>
            <th style="width:240px;">操作</th>
          </tr>
        </thead>
        <tbody id="rows"></tbody>
      </table>
    </div>
  </div>

  <script>
    const DAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"];
    const state = { schedules: [], subscribers: {}, templates: null, wecom: null, wecomBindings: [] };

    async function request(url, options = {}) {
      const res = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || ("请求失败: " + res.status));
      return data;
    }

    function extractToken(channelUrl) {
      if (!channelUrl) return "";
      const m = String(channelUrl).match(/^https?:\\/\\/xizhi\\.qqoq\\.net\\/(.+)\\.channel$/);
      return m ? m[1] : channelUrl;
    }

    async function refreshAll() {
      const [scheduleData, subscriberData, templateData, wecomData, bindingData] = await Promise.all([
        request("/api/schedules"),
        request("/api/subscribers"),
        request("/api/settings/templates"),
        request("/api/settings/wecom"),
        request("/api/wecom/bindings")
      ]);
      state.schedules = scheduleData.students || [];
      state.subscribers = {};
      for (const item of (subscriberData.items || [])) {
        if (!state.subscribers[item.student_id]) {
          state.subscribers[item.student_id] = item;
        }
      }
      state.templates = templateData || {};
      state.wecom = wecomData || {};
      state.wecomBindings = (bindingData && bindingData.items) || [];
      renderRows();
      renderTemplates();
      renderWecom();
      renderWecomBindings();
      setBindingMsg(`当前绑定用户数：${state.wecomBindings.length}`, false);
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
      if (conf.configured) {
        const callbackState = conf.callback_configured ? "，回调参数已配置" : "，回调参数未配置";
        setWecomMsg("已配置（secret 已脱敏保存）" + callbackState, false);
      } else {
        setWecomMsg("尚未配置企业微信鉴权信息", true);
      }
    }

    function formatDateTime(unixTs) {
      const ts = Number(unixTs || 0);
      if (!ts) return "-";
      const d = new Date(ts * 1000);
      if (Number.isNaN(d.getTime())) return "-";
      const pad = (v) => String(v).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
    }

    function renderWecomBindings() {
      const rows = Array.isArray(state.wecomBindings) ? state.wecomBindings : [];
      const el = document.getElementById("wecomBindingRows");
      if (!rows.length) {
        el.innerHTML = '<tr><td colspan="6" class="muted">暂无绑定用户（先在企业微信发送：bind 姓名）</td></tr>';
        return;
      }
      el.innerHTML = rows.map((item, idx) => `
        <tr>
          <td>${escapeHtml(item.wecom_userid || "-")}</td>
          <td>${escapeHtml(item.name || "-")}</td>
          <td>${escapeHtml(item.student_id || "-")}</td>
          <td>${item.active ? "是" : "否"}</td>
          <td>${escapeHtml(formatDateTime(item.updated_at))}</td>
          <td>
            <button class="btn gray" onclick="testWecomBinding(${idx})">测试推送</button>
          </td>
        </tr>
      `).join("");
    }

    async function refreshBindings() {
      try {
        const data = await request("/api/wecom/bindings");
        state.wecomBindings = (data && data.items) || [];
        renderWecomBindings();
        setBindingMsg("绑定列表已刷新", false);
      } catch (e) {
        setBindingMsg(String(e.message || e), true);
      }
    }

    async function testWecomBinding(index) {
      const item = (state.wecomBindings || [])[index];
      if (!item) {
        setBindingMsg("绑定项不存在，请先刷新", true);
        return;
      }
      try {
        await request("/api/subscribers/test", {
          method: "POST",
          body: JSON.stringify({ subscriber_key: item.subscriber_key }),
        });
        setBindingMsg(`已发送测试推送：${item.name} (${item.wecom_userid})`, false);
      } catch (e) {
        setBindingMsg(String(e.message || e), true);
      }
    }

    function rowHtml(student) {
      const sub = state.subscribers[student.studentId];
      const token = extractToken(sub ? sub.channel_url : "");
      const displayName = sub && sub.display_name ? sub.display_name : student.name;
      const active = sub ? !!sub.active : true;
      const disabledDays = sub && Array.isArray(sub.disabled_days) ? sub.disabled_days : [];
      const daySelector = DAY_LABELS.map((label, idx) => {
        const dayNo = idx + 1;
        const checked = disabledDays.includes(dayNo) ? "checked" : "";
        return `<label class="day-pill"><input id="off-${student.studentId}-${dayNo}" type="checkbox" ${checked} />周${label}</label>`;
      }).join("");
      return `
        <tr>
          <td>${student.name}</td>
          <td><input id="display-${student.studentId}" type="text" value="${escapeHtml(displayName)}" placeholder="如：贤贤" /></td>
          <td>
            <input id="token-${student.studentId}" type="text" value="${escapeHtml(token)}" placeholder="输入 token 或完整 channel URL" />
            <div id="msg-${student.studentId}" class="muted" style="margin-top:6px;"></div>
          </td>
          <td><div class="day-grid">${daySelector}</div></td>
          <td>
            <input id="active-${student.studentId}" type="checkbox" ${active ? "checked" : ""} onchange="toggleActive('${student.studentId}')" />
          </td>
          <td>
            <div class="row-actions">
              <button class="btn" onclick="saveOne('${student.studentId}', '${student.name}')">保存</button>
              <button class="btn gray" onclick="testOne('${student.studentId}')">测试推送</button>
            </div>
          </td>
        </tr>
      `;
    }

    function renderRows() {
      document.getElementById("rows").innerHTML = state.schedules.map(rowHtml).join("");
    }

    async function saveOne(studentId, name) {
      const el = document.getElementById("token-" + studentId);
      const displayEl = document.getElementById("display-" + studentId);
      const token = (el.value || "").trim();
      const displayName = (displayEl.value || "").trim();
      const disabledDays = DAY_LABELS.map((_, idx) => idx + 1).filter(dayNo => {
        const dayEl = document.getElementById(`off-${studentId}-${dayNo}`);
        return !!dayEl && dayEl.checked;
      });
      if (!token) {
        setRowMsg(studentId, "请先输入 token 或 URL", true);
        return;
      }
      try {
        await request("/api/subscribers/register", {
          method: "POST",
          body: JSON.stringify({
            name,
            channel_token: token,
            subscriber_key: "student-" + studentId,
            display_name: displayName,
            disabled_days: disabledDays
          }),
        });
        await refreshAll();
        setRowMsg(studentId, "保存成功", false);
      } catch (e) {
        setRowMsg(studentId, String(e.message || e), true);
      }
    }

    async function toggleActive(studentId) {
      const sub = state.subscribers[studentId];
      if (!sub) return;
      const checked = document.getElementById("active-" + studentId).checked;
      try {
        await request("/api/subscribers/active", {
          method: "POST",
          body: JSON.stringify({
            subscriber_key: sub.subscriber_key,
            active: checked
          }),
        });
        setRowMsg(studentId, checked ? "已启用" : "已停用", false);
      } catch (e) {
        setRowMsg(studentId, String(e.message || e), true);
      }
    }

    async function testOne(studentId) {
      const sub = state.subscribers[studentId];
      if (!sub) {
        setRowMsg(studentId, "请先保存配置", true);
        return;
      }
      try {
        await request("/api/subscribers/test", {
          method: "POST",
          body: JSON.stringify({ subscriber_key: sub.subscriber_key }),
        });
        setRowMsg(studentId, "测试推送已发送", false);
      } catch (e) {
        setRowMsg(studentId, String(e.message || e), true);
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
        document.getElementById("wecomCorpSecret").value = "";
        document.getElementById("wecomCallbackToken").value = "";
        document.getElementById("wecomCallbackAesKey").value = "";
      } catch (e) {
        setWecomMsg(String(e.message || e), true);
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

    async function runOnce() {
      try {
        const data = await request("/api/reminders/run-once", { method: "POST" });
        setGlobal("手动扫描完成，发送数量: " + data.sent, false);
      } catch (e) {
        setGlobal(String(e.message || e), true);
      }
    }

    function setGlobal(text, isError) {
      const el = document.getElementById("globalMsg");
      el.textContent = text;
      el.className = isError ? "err" : "ok";
    }

    function setRowMsg(studentId, text, isError) {
      const el = document.getElementById("msg-" + studentId);
      el.textContent = text;
      el.className = isError ? "err" : "ok";
    }

    function setWecomMsg(text, isError) {
      const el = document.getElementById("wecomMsg");
      el.textContent = text;
      el.className = isError ? "err" : "ok";
    }

    function setBindingMsg(text, isError) {
      const el = document.getElementById("wecomBindingMsg");
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

    refreshAll().catch(err => setGlobal(String(err.message || err), true));
  </script>
</body>
</html>"""


@app.get("/", response_class=HTMLResponse)
def admin_home() -> HTMLResponse:
    return HTMLResponse(build_admin_html())


@app.get("/admin", response_class=HTMLResponse)
def admin_page() -> HTMLResponse:
    return HTMLResponse(build_admin_html())


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
    return {
        "status": "ok",
        "db": str(DB_PATH),
        "push_mode": PUSH_MODE,
        "timezone": TIMEZONE_NAME,
        "week1_monday": TERM_WEEK1_MONDAY,
        "worker_enabled": ENABLE_REMINDER_WORKER,
        "wecom_configured": wecom_info["configured"],
        "wecom_callback_configured": wecom_info["callback_configured"],
    }


@app.get("/api/schedules")
def schedules() -> Dict[str, Any]:
    return {
        "students": [
            {"studentId": student_id, "name": schedule["name"], "courseCount": len(schedule["courses"])}
            for student_id, schedule in SCHEDULES.items()
        ]
    }


@app.get("/api/today-brief")
def today_brief(student_id: str = "caiziling") -> Dict[str, Any]:
    now = get_now()
    return build_today_brief(student_id=student_id, now=now)


@app.get("/api/settings/templates")
def get_templates() -> Dict[str, Any]:
    return get_push_templates()


@app.post("/api/settings/templates")
def update_templates(body: SaveTemplatesRequest) -> Dict[str, Any]:
    save_push_templates(body)
    return {"ok": True, **get_push_templates()}


@app.get("/api/settings/wecom")
def get_wecom_settings() -> Dict[str, Any]:
    return get_wecom_config_public()


@app.post("/api/settings/wecom")
def update_wecom_settings(body: SaveWecomConfigRequest) -> Dict[str, Any]:
    save_wecom_config(body)
    return {"ok": True, **get_wecom_config_public()}


@app.post("/api/settings/wecom/test")
def test_wecom_settings() -> Dict[str, Any]:
    try:
        result = test_wecom_connection()
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return result


@app.get("/api/wecom/bindings")
def wecom_bindings() -> Dict[str, Any]:
    return {"items": list_wecom_bindings()}


@app.post("/api/subscribers/register")
def register_subscriber(body: RegisterSubscriberRequest) -> Dict[str, Any]:
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

    upsert_subscriber(
        subscriber_key=subscriber_key,
        name=canonical_name,
        student_id=student_id,
        channel_url=channel_url,
        display_name=display_name,
        disabled_days=disabled_days,
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
def update_subscriber_active(body: UpdateSubscriberRequest) -> Dict[str, Any]:
    ok = set_subscriber_active(body.subscriber_key, body.active)
    if not ok:
        raise HTTPException(status_code=404, detail="subscriber_key 不存在")
    return {"ok": True, "subscriberKey": body.subscriber_key, "active": body.active}


@app.get("/api/subscribers")
def subscribers() -> Dict[str, Any]:
    return {"items": list_subscribers()}


@app.post("/api/subscribers/test")
def test_subscriber_push(body: TestPushRequest) -> Dict[str, Any]:
    sub = get_subscriber_by_key(body.subscriber_key)
    if not sub:
        raise HTTPException(status_code=404, detail="subscriber_key 不存在")
    title, content = build_test_push_payload(sub)
    try:
        send_message(sub["channel_url"], title, content)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"ok": True, "subscriberKey": body.subscriber_key}


@app.post("/api/reminders/run-once", response_model=RunOnceResponse)
def run_once() -> RunOnceResponse:
    return RunOnceResponse(sent=run_reminder_scan())
