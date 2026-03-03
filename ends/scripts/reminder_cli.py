#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

DEFAULT_BASE = os.getenv("TOUCHX_API_BASE", "http://127.0.0.1:9986")


def http_json(method: str, base: str, path: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    url = f"{base.rstrip('/')}{path}"
    data = None
    headers = {"Content-Type": "application/json"}
    if payload is not None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")

    req = urllib.request.Request(url=url, data=data, method=method.upper(), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = resp.read().decode("utf-8", "ignore")
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "ignore")
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"请求失败: {exc.reason}") from exc


def get_students(base: str) -> List[Dict[str, Any]]:
    data = http_json("GET", base, "/api/schedules")
    return data.get("students", [])


def get_subscribers(base: str) -> List[Dict[str, Any]]:
    data = http_json("GET", base, "/api/subscribers")
    return data.get("items", [])


def resolve_student(name_or_id: str, base: str) -> Dict[str, Any]:
    students = get_students(base)
    for item in students:
        if item.get("name") == name_or_id or item.get("studentId") == name_or_id:
            return item
    known = ", ".join([s.get("name", "") for s in students])
    raise RuntimeError(f"未找到学生: {name_or_id}。可选: {known}")


def find_subscriber_by_student(student_id: str, base: str) -> Optional[Dict[str, Any]]:
    for item in get_subscribers(base):
        if item.get("student_id") == student_id:
            return item
    return None


def parse_off_days(raw: Optional[str]) -> List[int]:
    if not raw:
        return []
    values: List[int] = []
    for part in str(raw).split(","):
        text = part.strip()
        if not text:
            continue
        day = int(text)
        if day < 1 or day > 7:
            raise RuntimeError("off-days 仅支持 1-7（周一到周日）")
        if day not in values:
            values.append(day)
    return sorted(values)


def cmd_serve(args: argparse.Namespace) -> int:
    cmd = [
        "uvicorn",
        "app.main:app",
        "--host",
        args.host,
        "--port",
        str(args.port),
    ]
    if args.reload:
        cmd.append("--reload")
    subprocess.run(cmd, check=True, cwd=args.cwd)
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    data = http_json("GET", args.base, "/health")
    print(json.dumps(data, ensure_ascii=False, indent=2))
    return 0


def cmd_list(args: argparse.Namespace) -> int:
    items = get_subscribers(args.base)
    print(json.dumps(items, ensure_ascii=False, indent=2))
    return 0


def cmd_set(args: argparse.Namespace) -> int:
    student = resolve_student(args.name, args.base)
    payload: Dict[str, Any] = {
        "name": student["name"],
        "subscriber_key": f"student-{student['studentId']}",
    }

    if args.token:
        payload["channel_token"] = args.token
    elif args.url:
        payload["channel_url"] = args.url
    else:
        raise RuntimeError("请提供 --token 或 --url")

    if args.display_name:
        payload["display_name"] = args.display_name
    if args.off_days is not None:
        payload["disabled_days"] = parse_off_days(args.off_days)

    result = http_json("POST", args.base, "/api/subscribers/register", payload)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def cmd_active(args: argparse.Namespace) -> int:
    student = resolve_student(args.name, args.base)
    sub = find_subscriber_by_student(student["studentId"], args.base)
    if not sub:
        raise RuntimeError("该学生尚未注册推送，请先执行 set")
    result = http_json(
        "POST",
        args.base,
        "/api/subscribers/active",
        {"subscriber_key": sub["subscriber_key"], "active": bool(args.active)},
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def cmd_test(args: argparse.Namespace) -> int:
    student = resolve_student(args.name, args.base)
    sub = find_subscriber_by_student(student["studentId"], args.base)
    if not sub:
        raise RuntimeError("该学生尚未注册推送，请先执行 set")
    result = http_json("POST", args.base, "/api/subscribers/test", {"subscriber_key": sub["subscriber_key"]})
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def cmd_run_once(args: argparse.Namespace) -> int:
    result = http_json("POST", args.base, "/api/reminders/run-once", {})
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="TouchX 提醒管理脚本")
    sub = p.add_subparsers(dest="command", required=True)

    serve = sub.add_parser("serve", help="启动后端服务")
    serve.add_argument("--cwd", default=os.path.join(os.path.dirname(__file__), ".."), help="ends 目录")
    serve.add_argument("--host", default="0.0.0.0")
    serve.add_argument("--port", type=int, default=9986)
    serve.add_argument("--reload", action="store_true")
    serve.set_defaults(func=cmd_serve)

    status = sub.add_parser("status", help="查看服务健康状态")
    status.add_argument("--base", default=DEFAULT_BASE)
    status.set_defaults(func=cmd_status)

    ls = sub.add_parser("list", help="查看订阅列表")
    ls.add_argument("--base", default=DEFAULT_BASE)
    ls.set_defaults(func=cmd_list)

    set_cmd = sub.add_parser("set", help="为指定学生设置 token/url")
    set_cmd.add_argument("--base", default=DEFAULT_BASE)
    set_cmd.add_argument("--name", required=True, help="姓名或 studentId")
    set_cmd.add_argument("--token", help="xizhi token")
    set_cmd.add_argument("--url", help="完整 channel URL")
    set_cmd.add_argument("--display-name", help="推送称呼，如：贤贤")
    set_cmd.add_argument("--off-days", help="关闭推送的星期，逗号分隔（1=周一 ... 7=周日）")
    set_cmd.set_defaults(func=cmd_set)

    active = sub.add_parser("active", help="启用/停用学生提醒")
    active.add_argument("--base", default=DEFAULT_BASE)
    active.add_argument("--name", required=True, help="姓名或 studentId")
    active.add_argument("--active", type=int, choices=[0, 1], required=True, help="1=启用, 0=停用")
    active.set_defaults(func=cmd_active)

    test = sub.add_parser("test", help="发送单人测试推送")
    test.add_argument("--base", default=DEFAULT_BASE)
    test.add_argument("--name", required=True, help="姓名或 studentId")
    test.set_defaults(func=cmd_test)

    run_once = sub.add_parser("run-once", help="手动触发一轮提醒扫描")
    run_once.add_argument("--base", default=DEFAULT_BASE)
    run_once.set_defaults(func=cmd_run_once)

    return p


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return int(args.func(args))
    except Exception as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
