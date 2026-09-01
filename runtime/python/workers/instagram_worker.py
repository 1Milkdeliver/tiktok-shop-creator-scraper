"""Instagram public-profile collector with an offline fixture mode.

The production path has a deliberately unavailable default until a reviewed
local public-profile adapter is bundled.  Its injectable boundary accepts public
profile handles, never login or session material, and only maps fields exposed
by the returned public profile model.  The fixture path is fully offline and
remains the contract-test baseline.
"""

from __future__ import annotations

import json
import importlib
import re
import time
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple

from worker_common import LocalPlatformWorker


FIXTURE_PATH = Path(__file__).with_name("fixtures") / "instagram-fixtures.json"
MAX_HANDLES = 50
HANDLE_PATTERN = re.compile(r"^[A-Za-z0-9._]{1,30}$")


def _text(value: Any) -> str:
    """Convert public fixture fields to strings without serializing secrets."""
    if value is None:
        return ""
    return str(value).strip()


def _normalize_profile(profile: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    native_id = _text(profile.get("id") or profile.get("pk"))
    if not native_id:
        return None
    # Contact e-mail is included only when it is explicitly public fixture data.
    # A supplied session, password, or challenge response is never read here.
    email = _text(profile.get("publicEmail"))
    return {
        "nativeId": native_id,
        "displayName": _text(profile.get("fullName") or profile.get("username")),
        "handle": _text(profile.get("username")),
        "biography": _text(profile.get("biography")),
        "profileUrl": _text(profile.get("profileUrl")),
        "followers": _text(profile.get("followers")),
        "category": _text(profile.get("category")),
        "contact": {"email": email} if email else {},
        "source": "instagram-fixture",
    }


def _get_field(value: Any, *names: str) -> Any:
    if isinstance(value, dict):
        for name in names:
            if name in value:
                return value[name]
        return None
    for name in names:
        if hasattr(value, name):
            return getattr(value, name)
    return None


def _normalize_live_profile(profile: Any) -> Optional[Dict[str, Any]]:
    """Map only public-facing profile values from a local adapter model."""
    native_id = _text(_get_field(profile, "pk", "id"))
    username = _text(_get_field(profile, "username"))
    if not native_id or not username:
        return None
    public_email = _text(_get_field(profile, "public_email", "business_email"))
    category = _text(_get_field(profile, "category", "category_name"))
    result: Dict[str, Any] = {
        "nativeId": native_id,
        "displayName": _text(_get_field(profile, "full_name", "fullName")) or username,
        "handle": f"@{username.lstrip('@')}",
        "biography": _text(_get_field(profile, "biography")),
        "profileUrl": f"https://www.instagram.com/{username.lstrip('@')}/",
        "followers": _text(_get_field(profile, "follower_count", "followers")),
        "mediaCount": _text(_get_field(profile, "media_count", "mediaCount")),
        "category": category,
        "contact": {"email": public_email} if public_email else {},
        "source": "instagram-public-profile-adapter",
    }
    if public_email:
        result["emailProvenance"] = "instagram:public-profile"
    if category:
        result["categoryProvenance"] = "instagram:public-profile"
    return result


def _normalize_search_candidate(result: Any) -> Optional[Dict[str, Any]]:
    """Persist a search result without opening the creator's profile.

    Automatic discovery deliberately ends at this boundary.  A later directed
    refresh may request a public profile, but an unattended seed run must not
    turn every candidate into a detail-endpoint request.
    """
    username = _text(_get_field(result, "username", "handle")).lstrip("@")
    if not HANDLE_PATTERN.fullmatch(username):
        return None
    native_id = _text(_get_field(result, "pk", "id")) or f"instagram:{username.casefold()}"
    display_name = _text(_get_field(result, "full_name", "fullName", "name")) or username
    return {
        "nativeId": native_id,
        "displayName": display_name,
        "handle": f"@{username}",
        "profileUrl": f"https://www.instagram.com/{username}/",
        "source": "instagram-session-search-candidate",
        "discoveryStage": "candidate_discovered",
        "verificationStatus": "pending_profile_check",
    }


def _validate_live_config(payload: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Accept either a bounded public handle list or a bounded account search."""
    query = _text(payload.get("query"))
    raw_handles = payload.get("handles", payload.get("handle"))
    if isinstance(raw_handles, str):
        raw_handles = [raw_handles]
    if query and len(query) > 200:
        return None, "query must be 200 characters or fewer"
    if not query and (not isinstance(raw_handles, list) or not raw_handles):
        return None, "handles or a discovery query is required"
    if isinstance(raw_handles, list) and len(raw_handles) > MAX_HANDLES:
        return None, f"handles must contain at most {MAX_HANDLES} entries"

    handles: List[str] = []
    seen = set()
    for raw_handle in raw_handles or []:
        if not isinstance(raw_handle, str):
            return None, "each handle must be a string"
        handle = raw_handle.strip().lstrip("@")
        if not HANDLE_PATTERN.fullmatch(handle):
            return None, "each handle must contain only letters, numbers, periods, or underscores"
        key = handle.casefold()
        if key not in seen:
            seen.add(key)
            handles.append(handle)
    if not query and not handles:
        return None, "handles must include at least one public profile handle"

    raw_limit = payload.get("maxResults", MAX_HANDLES)
    if isinstance(raw_limit, bool):
        return None, "maxResults must be an integer"
    try:
        max_results = int(raw_limit)
    except (TypeError, ValueError):
        return None, "maxResults must be an integer"
    if not 1 <= max_results <= MAX_HANDLES:
        return None, f"maxResults must be between 1 and {MAX_HANDLES}"

    raw_delay = payload.get("requestDelaySeconds", 0)
    if isinstance(raw_delay, bool):
        return None, "requestDelaySeconds must be a number"
    try:
        request_delay = float(raw_delay)
    except (TypeError, ValueError):
        return None, "requestDelaySeconds must be a number"
    if not 0 <= request_delay <= 30:
        return None, "requestDelaySeconds must be between 0 and 30"

    raw_initial_pause = payload.get("initialProfilePauseSeconds", 0)
    if isinstance(raw_initial_pause, bool):
        return None, "initialProfilePauseSeconds must be a number"
    try:
        initial_profile_pause = float(raw_initial_pause)
    except (TypeError, ValueError):
        return None, "initialProfilePauseSeconds must be a number"
    if not 0 <= initial_profile_pause <= 60:
        return None, "initialProfilePauseSeconds must be between 0 and 60"

    discovery_only = payload.get("discoveryOnly", False)
    if not isinstance(discovery_only, bool):
        return None, "discoveryOnly must be a boolean"

    resume_after = payload.get("resumeAfter")
    if resume_after is not None:
        resume_after = _text(resume_after)
        if not resume_after or len(resume_after) > 256:
            return None, "resumeAfter must be a non-empty identifier"
    state_path = payload.get("sessionStatePath")
    if state_path is not None:
        if not isinstance(state_path, str) or not state_path.strip() or len(state_path) > 1024:
            return None, "sessionStatePath must be an opaque local state-file path"
        # The bundled adapter enforces that this path is beneath the parent
        # process's state root before opening it.  Do not echo it in events.
        state_path = state_path.strip()
    return {"handles": handles, "query": query, "maxResults": max_results, "requestDelaySeconds": request_delay, "initialProfilePauseSeconds": initial_profile_pause, "discoveryOnly": discovery_only, "resumeAfter": resume_after, "sessionStatePath": state_path}, None


def _classify_live_error(error: BaseException) -> Tuple[str, str, str]:
    """Return stable error metadata without exposing upstream exception text."""
    combined = f"{type(error).__name__} {str(error)}".lower()
    if any(marker in combined for marker in ("429", "throttl", "rate limit", "too many request")):
        return "THROTTLED", "transient", "Instagram temporarily throttled this collection"
    if any(marker in combined for marker in ("login", "challenge", "session", "authentication", "unauthorized", "forbidden")):
        return "AUTH_REQUIRED", "authentication", "Instagram requires account verification before collection can continue"
    if isinstance(error, (AttributeError, KeyError, IndexError, TypeError, ValueError)) or any(
        marker in combined for marker in ("parse", "schema", "unexpected response")
    ):
        return "UPSTREAM_CHANGED", "transient", "Instagram returned a response shape the collector cannot process"
    if isinstance(error, (ImportError, ModuleNotFoundError)):
        return "INSTAGRAM_ADAPTER_UNAVAILABLE", "permanent", "The bundled Instagram collector is unavailable"
    return "INSTAGRAM_COLLECTION_FAILED", "transient", "Instagram collection did not complete"


def _bundled_adapter() -> Any:
    """Load the fixed bundled adapter; task input never selects a module."""
    return importlib.import_module("instagram_collector_adapter")


class InstagramFixtureWorker(LocalPlatformWorker):
    def __init__(self) -> None:
        super().__init__("instagram")
        with FIXTURE_PATH.open("r", encoding="utf-8") as source:
            self.fixtures = json.load(source)["scenarios"]

    def _fixture_failure(self, task_id: str, error: Dict[str, Any]) -> None:
        task = self.tasks[task_id]
        task["terminal"] = True
        self.emit(
            "task.failed",
            task_id=task_id,
            payload={
                "code": _text(error.get("code")) or "INSTAGRAM_FIXTURE_ERROR",
                "classification": _text(error.get("classification")) or "permanent",
                "message": _text(error.get("message")) or "Instagram fixture failed",
                "mode": "fixture",
            },
        )

    def _emit_fixture_task(self, task_id: str, scenario_name: str, scenario: Dict[str, Any]) -> None:
        task = self.tasks[task_id]
        state = scenario.get("sessionState")
        if isinstance(state, str) and state:
            self.emit("session.updated", task_id=task_id, payload={"state": state, "mode": "fixture"})

        auth = scenario.get("authRequired")
        if isinstance(auth, dict):
            self.emit(
                "auth.required",
                task_id=task_id,
                payload={
                    "provider": "instagram",
                    "reason": _text(auth.get("reason")) or "authentication_required",
                    "mode": "fixture",
                },
            )

        error = scenario.get("error")
        if isinstance(error, dict):
            self._fixture_failure(task_id, error)
            return

        profile = scenario.get("profile")
        if isinstance(profile, dict):
            item = _normalize_profile(profile)
            if item is None:
                self.emit("warning", task_id=task_id, payload={"code": "INSTAGRAM_MISSING_NATIVE_ID", "mode": "fixture"})
            else:
                self.emit("item", task_id=task_id, payload=item)
                self.emit("checkpoint", task_id=task_id, payload={"cursor": item["nativeId"], "mode": "fixture"})
                self.emit("progress", task_id=task_id, payload={"completed": 1, "total": 1, "mode": "fixture"})

        # Auth/challenge-only fixtures intentionally remain non-terminal so the
        # parent can decide whether to prompt, retry, or cancel. They never
        # request or return a password, session value, or challenge code.
        if isinstance(auth, dict):
            return
        task["terminal"] = True
        self.emit(
            "task.completed",
            task_id=task_id,
            payload={"items": 1 if isinstance(profile, dict) and _normalize_profile(profile) else 0, "scenario": scenario_name, "mode": "fixture"},
        )

    def handle(self, command: Dict[str, Any]) -> None:
        if (
            command.get("protocolVersion") == 1
            and command.get("type") == "task.start"
            and command.get("platform") == self.platform
            and isinstance(command.get("taskId"), str)
            and command["taskId"]
            and isinstance(command.get("payload"), dict)
            and command["payload"].get("fixtureMode") is True
        ):
            task_id = command["taskId"]
            if task_id in self.tasks:
                return
            scenario_name = _text(command["payload"].get("fixtureScenario")) or "profile"
            scenario = self.fixtures.get(scenario_name)
            self.tasks[task_id] = {"terminal": False, "authenticated": True}
            self.emit("task.accepted", task_id=task_id, payload={"mode": "fixture", "scenario": scenario_name})
            if not isinstance(scenario, dict):
                self.fail_task(task_id, "INSTAGRAM_UNKNOWN_FIXTURE", "Unknown Instagram fixture scenario")
                return
            self._emit_fixture_task(task_id, scenario_name, scenario)
            return
        super().handle(command)


class InstagramWorker(InstagramFixtureWorker):
    """Bounded public-profile collection through an injectable local wrapper.

    The module loader is deliberately injectable for offline contract tests; it
    is not derived from task input.  This prevents a task from selecting an
    arbitrary module or passing credentials into the worker.
    """

    def __init__(self, module_loader: Callable[[], Any] = _bundled_adapter) -> None:
        super().__init__()
        self._module_loader = module_loader

    @staticmethod
    def _client_factory(module: Any, session_state_path: Optional[str]) -> Callable[[], Any]:
        create = getattr(module, "create_client", None)
        if callable(create):
            return lambda: create(session_state_path)
        factory = getattr(module, "Client", None)
        if not callable(factory):
            raise ImportError("Instagram public-profile adapter Client is unavailable")
        return factory

    @staticmethod
    def _fetch_profile(client: Any, handle: str) -> Any:
        fetch = getattr(client, "user_info_by_username", None)
        if not callable(fetch):
            raise AttributeError("Instagram public-profile adapter user_info_by_username is unavailable")
        return fetch(handle)

    @staticmethod
    def _search_candidates(client: Any, query: str, amount: int) -> List[Dict[str, Any]]:
        search = getattr(client, "search_users", None)
        if not callable(search):
            raise AttributeError("Instagram public-profile adapter search_users is unavailable")
        results = search(query, amount)
        if not isinstance(results, Iterable) or isinstance(results, (str, bytes, dict)):
            raise ValueError("Unexpected Instagram account search response")
        candidates: List[Dict[str, Any]] = []
        seen = set()
        for result in results:
            handle = _text(_get_field(result, "username", "handle")).lstrip("@")
            if not HANDLE_PATTERN.fullmatch(handle):
                continue
            key = handle.casefold()
            if key not in seen:
                seen.add(key)
                candidate = _normalize_search_candidate(result)
                if candidate is not None:
                    candidates.append(candidate)
            if len(candidates) >= amount:
                break
        return candidates

    def _emit_live_failure(self, task_id: str, error: BaseException) -> None:
        task = self.tasks.get(task_id)
        if not task or task["terminal"]:
            return
        code, classification, message = _classify_live_error(error)
        task["terminal"] = True
        self.emit("task.failed", task_id=task_id, payload={
            "code": code,
            "classification": classification,
            "message": message,
            "mode": "live",
            # This is a safe, local diagnostic label. It describes the
            # collection stage only; no URL, session value, or upstream body
            # is ever emitted.
            "stage": task.get("stage", "session_loading"),
        })

    def _emit_live_stage(self, task_id: str, stage: str, **extra: Any) -> None:
        task = self.tasks.get(task_id)
        if not task or task["terminal"]:
            return
        task["stage"] = stage
        self.emit("progress", task_id=task_id, payload={"phase": stage, "mode": "live", **extra})

    def _emit_live_task(self, task_id: str, config: Dict[str, Any]) -> None:
        task = self.tasks[task_id]
        self.emit("session.updated", task_id=task_id, payload={"state": "public", "mode": "live"})
        try:
            self._emit_live_stage(task_id, "session_loading")
            module = self._module_loader()
            client = self._client_factory(module, config.get("sessionStatePath"))()
            if config["handles"]:
                handles = config["handles"]
            else:
                self._emit_live_stage(task_id, "account_search", query=config["query"])
                candidates = self._search_candidates(client, config["query"], config["maxResults"])
                if config["discoveryOnly"]:
                    emitted = 0
                    for candidate in candidates:
                        if task["terminal"]:
                            return
                        emitted += 1
                        self.emit("item", task_id=task_id, payload=candidate)
                        self.emit("checkpoint", task_id=task_id, payload={"cursor": candidate["nativeId"], "mode": "live", "stage": "candidate_discovered"})
                        self.emit("progress", task_id=task_id, payload={
                            "completed": emitted, "total": len(candidates), "handle": candidate["handle"], "mode": "live", "phase": "candidate_discovered",
                        })
                    task["terminal"] = True
                    self.emit("task.completed", task_id=task_id, payload={"items": emitted, "mode": "live", "stage": "candidate_discovered"})
                    return
                handles = [candidate["handle"].lstrip("@") for candidate in candidates]
            # Emit each confirmed public profile immediately.  The parent
            # persists every ``item`` event before continuing, so a later
            # throttle/network failure cannot discard profiles already
            # collected in this task.
            resume_after = config.get("resumeAfter")
            skipping = bool(resume_after)
            emitted = 0
            total = len(handles)
            for index, handle in enumerate(handles):
                # The discovery request and the first profile lookup must not
                # be emitted back-to-back.  Further lookups retain the same
                # explicit pause.  This deliberately favours compliance and
                # resumability over throughput.
                pause = config["initialProfilePauseSeconds"] if index == 0 else config["requestDelaySeconds"]
                if pause:
                    self._emit_live_stage(task_id, "profile_pause", total=total, current=index + 1)
                    time.sleep(pause)
                self._emit_live_stage(task_id, "profile_lookup", total=total, current=index + 1, handle=f"@{handle}")
                profile = self._fetch_profile(client, handle)
                item = _normalize_live_profile(profile)
                if item is None:
                    self.emit("warning", task_id=task_id, payload={
                        "code": "INSTAGRAM_MISSING_PUBLIC_PROFILE_ID", "handle": f"@{handle}", "mode": "live",
                    })
                    continue
                if skipping:
                    if item["nativeId"] == resume_after:
                        skipping = False
                    continue
                if task["terminal"]:
                    return
                emitted += 1
                self.emit("item", task_id=task_id, payload=item)
                self.emit("checkpoint", task_id=task_id, payload={"cursor": item["nativeId"], "mode": "live"})
                self.emit("progress", task_id=task_id, payload={
                    "completed": emitted, "total": total, "handle": item["handle"], "mode": "live",
                })
        except BaseException as error:
            self._emit_live_failure(task_id, error)
            return

        if skipping:
            self.emit("warning", task_id=task_id, payload={"code": "INSTAGRAM_RESUME_CURSOR_NOT_FOUND", "mode": "live"})
        if task["terminal"]:
            return
        task["terminal"] = True
        self.emit("task.completed", task_id=task_id, payload={"items": emitted, "mode": "live"})

    def handle(self, command: Dict[str, Any]) -> None:
        if (
            command.get("protocolVersion") == 1
            and command.get("type") == "task.start"
            and command.get("platform") == self.platform
            and isinstance(command.get("taskId"), str)
            and command["taskId"]
            and isinstance(command.get("payload"), dict)
            and command["payload"].get("fixtureMode") is not True
        ):
            task_id = command["taskId"]
            if task_id in self.tasks:
                return
            config, error = _validate_live_config(command["payload"])
            self.tasks[task_id] = {"terminal": False, "authenticated": False}
            self.emit("task.accepted", task_id=task_id, payload={"mode": "live"})
            if error:
                self.tasks[task_id]["terminal"] = True
                self.emit("task.failed", task_id=task_id, payload={
                    "code": "INSTAGRAM_INVALID_CONFIG", "classification": "permanent", "message": error, "mode": "live",
                })
                return
            self._emit_live_task(task_id, config)
            return
        super().handle(command)


if __name__ == "__main__":
    InstagramWorker().run()
