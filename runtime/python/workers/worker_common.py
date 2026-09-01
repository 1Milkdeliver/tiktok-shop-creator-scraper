"""Protocol-v1 skeleton for local, platform-specific collector workers.

This module deliberately contains no web collection or login automation.  It only
implements the parent-process contract so each platform can be connected later
without changing task supervision, authentication boundaries, or event handling.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from typing import Any, Dict


PROTOCOL_VERSION = 1


def _timestamp() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


class LocalPlatformWorker:
    """A JSONL worker that produces safe placeholder lifecycle events only."""

    def __init__(self, platform: str) -> None:
        self.platform = platform
        self.sequence = 0
        self.tasks: Dict[str, Dict[str, Any]] = {}
        self.running = True

    def emit(self, event_type: str, *, task_id: str | None = None, payload: Dict[str, Any] | None = None) -> None:
        message: Dict[str, Any] = {
            "protocolVersion": PROTOCOL_VERSION,
            "type": event_type,
            "seq": self.sequence,
            "timestamp": _timestamp(),
            "payload": payload or {},
        }
        self.sequence += 1
        if task_id is not None:
            message["taskId"] = task_id
            message["platform"] = self.platform
        sys.stdout.write(json.dumps(message, separators=(",", ":")) + "\n")
        sys.stdout.flush()

    def fail_task(self, task_id: str, code: str, message: str) -> None:
        task = self.tasks.get(task_id)
        if not task or task["terminal"]:
            return
        task["terminal"] = True
        self.emit("task.failed", task_id=task_id, payload={"code": code, "message": message})

    def complete_placeholder_task(self, task_id: str) -> None:
        task = self.tasks.get(task_id)
        if not task or task["terminal"]:
            return
        # These values are explicitly non-production placeholders. They must not
        # be persisted as a collected creator record by a future adapter.
        self.emit("session.updated", task_id=task_id, payload={"state": "ready", "source": "skeleton"})
        self.emit(
            "item",
            task_id=task_id,
            payload={
                "nativeId": f"{self.platform}-placeholder-{task_id}",
                "isPlaceholder": True,
                "source": "skeleton",
            },
        )
        self.emit("checkpoint", task_id=task_id, payload={"cursor": None, "source": "skeleton"})
        self.emit("progress", task_id=task_id, payload={"completed": 1, "total": 1, "source": "skeleton"})
        task["terminal"] = True
        self.emit("task.completed", task_id=task_id, payload={"items": 0, "source": "skeleton"})

    def handle(self, command: Dict[str, Any]) -> None:
        if command.get("protocolVersion") != PROTOCOL_VERSION:
            return
        command_type = command.get("type")
        if command_type == "hello":
            self.emit("worker.ready", payload={"protocolVersion": PROTOCOL_VERSION, "platform": self.platform, "mode": "skeleton"})
            return
        if command_type == "shutdown":
            self.running = False
            return
        if command_type not in {"task.start", "task.cancel", "auth.provide", "ping"}:
            return
        if command_type == "ping":
            return

        task_id = command.get("taskId")
        if not isinstance(task_id, str) or not task_id:
            return
        if command.get("platform") != self.platform:
            return

        if command_type == "task.start":
            if task_id in self.tasks:
                return
            self.tasks[task_id] = {"terminal": False, "authenticated": False}
            self.emit("task.accepted", task_id=task_id, payload={"mode": "skeleton"})
            # Credentials are supplied only through a later auth.provide command.
            # The event names the requirement but never serializes secret values.
            self.emit(
                "auth.required",
                task_id=task_id,
                payload={"provider": self.platform, "reason": "collector_not_authenticated", "mode": "skeleton"},
            )
            return

        task = self.tasks.get(task_id)
        if not task or task["terminal"]:
            return
        if command_type == "task.cancel":
            self.fail_task(task_id, "cancelled", "Task cancelled before collection started")
        elif command_type == "auth.provide":
            # Never read, log, or echo credential payloads. Actual credential use
            # will be introduced with a platform adapter and encrypted broker.
            task["authenticated"] = True
            self.complete_placeholder_task(task_id)

    def run(self) -> None:
        for line in sys.stdin:
            try:
                value = json.loads(line)
                if isinstance(value, dict):
                    self.handle(value)
            except (json.JSONDecodeError, TypeError, ValueError):
                # Avoid printing raw input: it can contain credential material.
                sys.stderr.write("Worker received an invalid protocol command\n")
                sys.stderr.flush()
            if not self.running:
                break
