"""X creator collector with a deterministic offline fixture mode.

The live path deliberately accepts only an opaque broker reference after the
parent process has resolved an account locally.  It never accepts, prints, or
persists cookies, passwords, tokens, or account identifiers.  A platform
adapter is injected at runtime; this keeps the worker testable without network
access and makes a missing bundled adapter a clear, safe failure.
"""

from __future__ import annotations

import importlib
import json
import threading
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, Optional, Tuple

from worker_common import LocalPlatformWorker


FIXTURE_PATH = Path(__file__).with_name("fixtures") / "x-fixtures.json"
MAX_WAIT_MS = 5_000
MAX_RESULTS = 500


def _string(value: Any) -> Optional[str]:
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def _safe_wait_ms(value: Any) -> int:
    """Clamp fixture retry waits; this worker never performs an unbounded sleep."""
    try:
        return max(0, min(int(value), MAX_WAIT_MS))
    except (TypeError, ValueError):
        return 0


class PrivateAccountPool:
    """Private runtime-only account-pool reference, never a business DB record."""

    def __init__(self, reference: str = "x-local-pool") -> None:
        self.reference = reference
        self._lock = threading.RLock()

    def state(self) -> Dict[str, str]:
        # Do not add account IDs, cookie values, or secrets here.
        with self._lock:
            return {"accountPoolRef": self.reference, "accountState": "unassigned"}


class XFixtureWorker(LocalPlatformWorker):
    def __init__(self) -> None:
        super().__init__("x")
        with FIXTURE_PATH.open("r", encoding="utf-8") as source:
            self.fixtures = json.load(source)["scenarios"]
        self.account_pool = PrivateAccountPool()
        self._task_lock = threading.RLock()

    def _normalize(self, raw: Dict[str, Any], source: str) -> Optional[Dict[str, Any]]:
        native_id = _string(raw.get("id") or raw.get("rest_id") or raw.get("userId"))
        if native_id is None:
            return None
        username = _string(raw.get("username") or raw.get("screen_name")) or ""
        inferred_category = _string(raw.get("inferred_category") or raw.get("category")) or ""
        public_email = _string(raw.get("public_email") or raw.get("contact_email")) or ""
        result = {
            "nativeId": native_id,
            "displayName": _string(raw.get("name") or raw.get("display_name")) or "",
            "handle": f"@{username.lstrip('@')}" if username else "",
            "description": _string(raw.get("description") or raw.get("bio")) or "",
            "stats": {
                "followerCount": _string(raw.get("followers_count") or raw.get("followers")) or "",
                "postCount": _string(raw.get("statuses_count") or raw.get("posts")) or "",
            },
            "source": source,
        }
        if inferred_category:
            result["inferredCategory"] = inferred_category
            result["categoryProvenance"] = _string(raw.get("category_provenance")) or "fixture:profile-inference"
        if public_email:
            result["publicEmail"] = public_email
            result["emailProvenance"] = _string(raw.get("email_provenance")) or "fixture:public-profile"
        return result

    def _emit_failure(self, task_id: str, error: Dict[str, Any]) -> None:
        with self._task_lock:
            task = self.tasks.get(task_id)
            if not task or task["terminal"]:
                return
            task["terminal"] = True
        self.emit("task.failed", task_id=task_id, payload={
            "code": _string(error.get("code")) or "X_FIXTURE_ERROR",
            "classification": _string(error.get("classification")) or "permanent",
            "message": _string(error.get("message")) or "X fixture failed",
            "mode": "fixture",
        })

    def _begin_fixture_task(self, task_id: str, scenario_name: str, scenario: Dict[str, Any]) -> None:
        error = scenario.get("error") if isinstance(scenario.get("error"), dict) else None
        session_state = "account_unavailable" if error and error.get("code") == "NO_ACCOUNT_AVAILABLE" else "ready"
        self.emit("session.updated", task_id=task_id, payload={
            "state": session_state, "mode": "fixture", **self.account_pool.state(),
        })
        if error:
            self._emit_failure(task_id, error)
            return

        wait_ms = _safe_wait_ms(scenario.get("waitMs"))
        if scenario.get("awaitCancel") is True:
            # This is a transition, not a blocking sleep. The parent can send
            # task.cancel immediately, so cancellation is never lock-blocked.
            with self._task_lock:
                self.tasks[task_id]["awaiting_cancel"] = True
            self.emit("warning", task_id=task_id, payload={"code": "X_FINITE_WAIT", "waitMs": wait_ms, "mode": "fixture"})
            self.emit("progress", task_id=task_id, payload={"completed": 0, "total": 0, "state": "waiting", "mode": "fixture"})
            return

        results = scenario.get("results")
        if not isinstance(results, list):
            self._emit_failure(task_id, {"code": "X_INVALID_FIXTURE", "message": "Fixture scenario has no results"})
            return
        count = 0
        for index, raw in enumerate(results):
            if not isinstance(raw, dict):
                self.emit("warning", task_id=task_id, payload={"code": "X_INVALID_ITEM", "item": index, "mode": "fixture"})
                continue
            item = self._normalize(raw, f"x-fixture-{scenario_name}")
            if item is None:
                self.emit("warning", task_id=task_id, payload={"code": "X_MISSING_NATIVE_ID", "item": index, "mode": "fixture"})
                continue
            count += 1
            self.emit("item", task_id=task_id, payload=item)
        self.emit("checkpoint", task_id=task_id, payload={"cursor": str(count), "mode": "fixture"})
        self.emit("progress", task_id=task_id, payload={"completed": count, "total": count, "mode": "fixture"})
        with self._task_lock:
            task = self.tasks.get(task_id)
            if not task or task["terminal"]:
                return
            task["terminal"] = True
        self.emit("task.completed", task_id=task_id, payload={"items": count, "scenario": scenario_name, "mode": "fixture"})

    def _cancel_fixture_task(self, task_id: str) -> None:
        with self._task_lock:
            task = self.tasks.get(task_id)
            if not task or task["terminal"]:
                return
            task["terminal"] = True
        self.emit("task.failed", task_id=task_id, payload={
            "code": "cancelled", "classification": "cancelled", "message": "Task cancelled", "mode": "fixture",
        })

    def handle(self, command: Dict[str, Any]) -> None:
        is_fixture_start = (
            command.get("protocolVersion") == 1 and command.get("type") == "task.start"
            and command.get("platform") == self.platform and isinstance(command.get("taskId"), str)
            and bool(command["taskId"]) and isinstance(command.get("payload"), dict)
            and command["payload"].get("fixtureMode") is True
        )
        if is_fixture_start:
            task_id = command["taskId"]
            with self._task_lock:
                if task_id in self.tasks:
                    return
                self.tasks[task_id] = {"terminal": False, "authenticated": True}
            scenario_name = _string(command["payload"].get("fixtureScenario")) or "profile"
            scenario = self.fixtures.get(scenario_name)
            self.emit("task.accepted", task_id=task_id, payload={"mode": "fixture", "scenario": scenario_name})
            if not isinstance(scenario, dict):
                self._emit_failure(task_id, {"code": "X_UNKNOWN_FIXTURE", "message": "Unknown X fixture scenario"})
                return
            self._begin_fixture_task(task_id, scenario_name, scenario)
            return

        is_fixture_cancel = (
            command.get("protocolVersion") == 1 and command.get("type") == "task.cancel"
            and command.get("platform") == self.platform and isinstance(command.get("taskId"), str)
        )
        if is_fixture_cancel:
            with self._task_lock:
                known = command["taskId"] in self.tasks
            if known:
                self._cancel_fixture_task(command["taskId"])
                return
        super().handle(command)


def _validate_live_config(payload: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Validate the deliberately small, non-secret X discovery contract."""
    query = _string(payload.get("query"))
    if query is None:
        return None, "query must be a non-empty string"
    if len(query) > 200:
        return None, "query must be 200 characters or fewer"
    raw_limit = payload.get("maxResults", payload.get("limit", 50))
    if isinstance(raw_limit, bool):
        return None, "maxResults must be an integer"
    try:
        limit = int(raw_limit)
    except (TypeError, ValueError):
        return None, "maxResults must be an integer"
    if not 1 <= limit <= MAX_RESULTS:
        return None, f"maxResults must be between 1 and {MAX_RESULTS}"
    result: Dict[str, Any] = {"query": query, "maxResults": limit}
    resume_after = payload.get("resumeAfter")
    if resume_after is not None:
        resume_after = _string(resume_after)
        if resume_after is None or len(resume_after) > 256:
            return None, "resumeAfter must be a non-empty identifier"
        result["resumeAfter"] = resume_after
    return result, None


def _classify_live_error(error: BaseException) -> Tuple[str, str, str]:
    """Turn adapter failures into stable messages that cannot expose account data."""
    kind = type(error).__name__.lower()
    text = str(error).lower()
    combined = f"{kind} {text}"
    if any(marker in combined for marker in ("429", "throttl", "rate limit", "too many request")):
        return "THROTTLED", "transient", "X temporarily throttled this collection"
    if any(marker in combined for marker in ("auth", "login", "credential", "session expired", "account state")):
        return "X_ACCOUNT_REAUTH_REQUIRED", "action_required", "The selected X account needs to be reconnected"
    if isinstance(error, (AttributeError, KeyError, IndexError, TypeError, ValueError)) or any(
        marker in combined for marker in ("parse", "schema", "unexpected response")
    ):
        return "UPSTREAM_CHANGED", "transient", "X returned a response shape the collector cannot process"
    if isinstance(error, (ImportError, ModuleNotFoundError)):
        return "X_COLLECTOR_UNAVAILABLE", "permanent", "The bundled X collector is unavailable"
    return "X_COLLECTION_FAILED", "transient", "X collection did not complete"


class XWorker(XFixtureWorker):
    """Live X collection boundary with fixture compatibility.

    ``collector_factory`` receives an opaque broker reference and returns a
    local adapter exposing ``search_creators(query, max_results)``.  The worker
    does not know how the broker resolves that reference and therefore cannot
    leak credential material into its event stream or creator records.
    """

    def __init__(self, collector_factory: Optional[Callable[[str], Any]] = None) -> None:
        super().__init__()
        self._collector_factory = collector_factory or self._load_bundled_collector

    @staticmethod
    def _load_bundled_collector(broker_ref: str) -> Any:
        module = importlib.import_module("x_collector_adapter")
        factory = getattr(module, "create_collector", None)
        if not callable(factory):
            raise ImportError("x_collector_adapter.create_collector is unavailable")
        return factory(broker_ref)

    def _emit_live_failure(self, task_id: str, error: BaseException) -> None:
        task = self.tasks.get(task_id)
        if not task or task["terminal"]:
            return
        code, classification, message = _classify_live_error(error)
        task["terminal"] = True
        self.emit("task.failed", task_id=task_id, payload={
            "code": code, "classification": classification, "message": message, "mode": "live",
        })

    def _run_live_collection(self, task_id: str, broker_ref: str) -> None:
        task = self.tasks[task_id]
        config = task["config"]
        self.emit("session.updated", task_id=task_id, payload={
            "state": "ready", "mode": "live", "accountPoolRef": "x-local-pool", "accountState": "assigned",
        })
        emitted = 0
        try:
            collector = self._collector_factory(broker_ref)
            search = getattr(collector, "search_creators", None)
            if not callable(search):
                raise AttributeError("X collector search_creators is unavailable")
            records = search(config["query"], max_results=config["maxResults"])
            if isinstance(records, dict):
                records = records.get("items", records.get("results"))
            if isinstance(records, (str, bytes)) or not isinstance(records, Iterable):
                raise ValueError("Unexpected X collector response")
            normalized = []
            for raw in records:
                if not isinstance(raw, dict):
                    self.emit("warning", task_id=task_id, payload={"code": "X_INVALID_ITEM", "mode": "live"})
                    continue
                item = self._normalize(raw, "x-local-adapter")
                if item is None:
                    self.emit("warning", task_id=task_id, payload={"code": "X_MISSING_NATIVE_ID", "mode": "live"})
                    continue
                normalized.append(item)
            start_index = 0
            resume_after = config.get("resumeAfter")
            if resume_after:
                positions = [index for index, item in enumerate(normalized) if item["nativeId"] == resume_after]
                if positions:
                    start_index = positions[-1] + 1
                else:
                    self.emit("warning", task_id=task_id, payload={"code": "X_RESUME_CURSOR_NOT_FOUND", "mode": "live"})
            for item in normalized[start_index:]:
                if task["terminal"]:
                    return
                emitted += 1
                self.emit("item", task_id=task_id, payload=item)
                self.emit("checkpoint", task_id=task_id, payload={"cursor": item["nativeId"], "mode": "live"})
                self.emit("progress", task_id=task_id, payload={
                    "completed": emitted, "total": len(normalized) - start_index, "mode": "live",
                })
        except BaseException as error:
            self._emit_live_failure(task_id, error)
            return
        if task["terminal"]:
            return
        task["terminal"] = True
        self.emit("task.completed", task_id=task_id, payload={"items": emitted, "mode": "live"})

    def handle(self, command: Dict[str, Any]) -> None:
        is_live_start = (
            command.get("protocolVersion") == 1 and command.get("type") == "task.start"
            and command.get("platform") == self.platform and isinstance(command.get("taskId"), str)
            and bool(command["taskId"]) and isinstance(command.get("payload"), dict)
            and command["payload"].get("fixtureMode") is not True
        )
        if is_live_start:
            task_id = command["taskId"]
            if task_id in self.tasks:
                return
            config, validation_error = _validate_live_config(command["payload"])
            self.tasks[task_id] = {"terminal": False, "authenticated": False, "mode": "live", "config": config}
            self.emit("task.accepted", task_id=task_id, payload={"mode": "live"})
            if validation_error:
                self.tasks[task_id]["terminal"] = True
                self.emit("task.failed", task_id=task_id, payload={
                    "code": "X_INVALID_CONFIG", "classification": "permanent", "message": validation_error, "mode": "live",
                })
            else:
                self.emit("auth.required", task_id=task_id, payload={
                    "provider": "x", "reason": "account_broker_reference_required", "mode": "live",
                })
            return

        is_live_auth = (
            command.get("protocolVersion") == 1 and command.get("type") == "auth.provide"
            and command.get("platform") == self.platform and isinstance(command.get("taskId"), str)
            and isinstance(command.get("payload"), dict)
        )
        if is_live_auth:
            task = self.tasks.get(command["taskId"])
            if not task or task["terminal"] or task.get("mode") != "live":
                return
            broker_ref = _string(command["payload"].get("brokerRef"))
            if broker_ref is None or len(broker_ref) > 256:
                task["terminal"] = True
                self.emit("task.failed", task_id=command["taskId"], payload={
                    "code": "X_BROKER_REFERENCE_REQUIRED", "classification": "action_required",
                    "message": "A local account broker reference is required", "mode": "live",
                })
                return
            task["authenticated"] = True
            self._run_live_collection(command["taskId"], broker_ref)
            return

        is_live_cancel = (
            command.get("protocolVersion") == 1 and command.get("type") == "task.cancel"
            and command.get("platform") == self.platform and isinstance(command.get("taskId"), str)
        )
        if is_live_cancel:
            task = self.tasks.get(command["taskId"])
            if task and not task["terminal"] and task.get("mode") == "live":
                task["terminal"] = True
                self.emit("task.failed", task_id=command["taskId"], payload={
                    "code": "cancelled", "classification": "cancelled", "message": "Task cancelled", "mode": "live",
                })
                return
        super().handle(command)


if __name__ == "__main__":
    XWorker().run()
