"""YouTube creator collector with an offline fixture mode.

Production collection uses :mod:`ytscrape` when it is bundled with the local
Python runtime.  It deliberately accepts no API key, account, cookie, proxy, or
other credential configuration.  ``fixtureMode: true`` remains a fully offline
contract test path and never imports ``ytscrape``.
"""

from __future__ import annotations

import hashlib
import importlib
import json
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, Iterator, List, Optional, Tuple

from worker_common import LocalPlatformWorker


FIXTURE_PATH = Path(__file__).with_name("fixtures") / "youtube-fixtures.json"
MAX_RESULTS = 500


def _as_non_empty_string(value: Any) -> Optional[str]:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _stable_fallback_id(item: Dict[str, Any]) -> Optional[str]:
    """Return a deterministic fixture-only identifier when a legacy shape has no id.

    A real collector must never persist this fallback as a platform-native ID.
    It exists only to make changed test payloads deterministic and visible.
    """
    snippet = item.get("snippet") if isinstance(item.get("snippet"), dict) else {}
    candidate = _as_non_empty_string(snippet.get("customUrl") or snippet.get("title"))
    if not candidate:
        return None
    digest = hashlib.sha256(candidate.casefold().encode("utf-8")).hexdigest()[:16]
    return f"fixture-fallback-{digest}"


def _normalize_item(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Normalize both fixture payload shapes without leaking unstable numeric types."""
    channel = item.get("channel") if isinstance(item.get("channel"), dict) else {}
    snippet = item.get("snippet") if isinstance(item.get("snippet"), dict) else {}
    statistics = item.get("statistics") if isinstance(item.get("statistics"), dict) else {}
    metrics = item.get("metrics") if isinstance(item.get("metrics"), dict) else {}

    native_id = _as_non_empty_string(
        item.get("channelId")
        or channel.get("id")
        or item.get("id")
        or snippet.get("channelId")
    )
    if native_id is None:
        native_id = _stable_fallback_id(item)
    if native_id is None:
        return None

    return {
        "nativeId": native_id,
        "displayName": _as_non_empty_string(snippet.get("title") or channel.get("name")) or "",
        "handle": _as_non_empty_string(snippet.get("customUrl") or channel.get("handle")) or "",
        "description": _as_non_empty_string(snippet.get("description")) or "",
        "stats": {
            "subscriberCount": _as_non_empty_string(statistics.get("subscriberCount") or metrics.get("subscribers")) or "",
            "videoCount": _as_non_empty_string(statistics.get("videoCount")) or "",
        },
        "source": "youtube-fixture",
    }


def _public_value(value: Any) -> str:
    """Read a public ytscrape model field without dumping its full object."""
    return _as_non_empty_string(value) or ""


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


def _normalize_live_channel(channel: Any) -> Optional[Dict[str, Any]]:
    """Convert a ytscrape Channel/ChannelDetails model into the worker schema."""
    native_id = _public_value(_get_field(channel, "id", "channel_id", "channelId"))
    if not native_id:
        return None
    handle = _public_value(_get_field(channel, "handle", "custom_url", "customUrl"))
    if handle and not handle.startswith("@"):
        handle = f"@{handle}"
    links = _get_field(channel, "links")
    public_email = ""
    if isinstance(links, dict):
        # ytscrape returns public channel links.  Only retain a literal mailto
        # target; do not try to infer an address from arbitrary text.
        for link in links.values():
            candidate = _public_value(link)
            if candidate.lower().startswith("mailto:"):
                public_email = candidate[7:].strip()
                break
    result: Dict[str, Any] = {
        "nativeId": native_id,
        "displayName": _public_value(_get_field(channel, "title", "name")),
        "handle": handle,
        "description": _public_value(_get_field(channel, "description")),
        "profileUrl": _public_value(_get_field(channel, "url", "channel_url", "channelUrl")),
        "stats": {
            "subscriberCount": _public_value(_get_field(channel, "subscribers", "subscriber_count", "subscriberCount")),
            "videoCount": _public_value(_get_field(channel, "video_count", "videoCount")),
            "viewCount": _public_value(_get_field(channel, "view_count", "viewCount")),
        },
        "source": "ytscrape",
    }
    tags = _get_field(channel, "keywords", "tags")
    if isinstance(tags, (list, tuple)):
        result["keywords"] = [text for text in (_public_value(tag) for tag in tags) if text]
    if public_email:
        result["publicEmail"] = public_email
        result["emailProvenance"] = "youtube:public-channel-link"
    return result


def _validate_live_config(payload: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """Validate only the non-secret inputs accepted by the production worker."""
    query = _as_non_empty_string(payload.get("query"))
    if query is None:
        return None, "query must be a non-empty string"
    if len(query) > 200:
        return None, "query must be 200 characters or fewer"

    raw_limit = payload.get("maxResults", payload.get("limit", 50))
    # bool is an int subclass but does not represent a meaningful collection limit.
    if isinstance(raw_limit, bool):
        return None, "maxResults must be an integer"
    try:
        limit = int(raw_limit)
    except (TypeError, ValueError):
        return None, "maxResults must be an integer"
    if not 1 <= limit <= MAX_RESULTS:
        return None, f"maxResults must be between 1 and {MAX_RESULTS}"

    config: Dict[str, Any] = {"query": query, "maxResults": limit}
    for input_name, output_name in (("language", "language"), ("region", "region")):
        value = payload.get(input_name)
        if value is None:
            continue
        value = _as_non_empty_string(value)
        if value is None or len(value) != 2 or not value.isalpha():
            return None, f"{input_name} must be a two-letter code"
        config[output_name] = value.lower() if output_name == "language" else value.upper()

    resume_after = payload.get("resumeAfter")
    if resume_after is not None:
        resume_after = _as_non_empty_string(resume_after)
        if resume_after is None or len(resume_after) > 256:
            return None, "resumeAfter must be a non-empty identifier"
        config["resumeAfter"] = resume_after
    return config, None


def _classify_live_error(error: BaseException) -> Tuple[str, str, str]:
    """Map upstream failures to stable, secret-safe worker error payloads."""
    name = type(error).__name__.lower()
    text = str(error).lower()
    combined = f"{name} {text}"
    if any(marker in combined for marker in ("429", "throttl", "rate limit", "too many request")):
        return "THROTTLED", "transient", "YouTube temporarily throttled this collection"
    if isinstance(error, (AttributeError, KeyError, IndexError, TypeError)) or any(
        marker in combined for marker in ("parse", "renderer", "schema", "unexpected response")
    ):
        return "UPSTREAM_CHANGED", "transient", "YouTube returned a response shape the collector cannot process"
    if isinstance(error, (ImportError, ModuleNotFoundError)):
        return "YTSCRAPE_UNAVAILABLE", "permanent", "The bundled YouTube collector is unavailable"
    return "YOUTUBE_COLLECTION_FAILED", "transient", "YouTube collection did not complete"


class YouTubeFixtureWorker(LocalPlatformWorker):
    def __init__(self) -> None:
        super().__init__("youtube")
        with FIXTURE_PATH.open("r", encoding="utf-8") as source:
            self.fixtures = json.load(source)["scenarios"]

    def _emit_fixture_task(self, task_id: str, scenario_name: str, scenario: Dict[str, Any]) -> None:
        task = self.tasks[task_id]
        self.emit("session.updated", task_id=task_id, payload={"state": "ready", "mode": "fixture"})
        error = scenario.get("error")
        if isinstance(error, dict):
            task["terminal"] = True
            self.emit(
                "task.failed",
                task_id=task_id,
                payload={
                    "code": _as_non_empty_string(error.get("code")) or "YOUTUBE_FIXTURE_ERROR",
                    "classification": _as_non_empty_string(error.get("classification")) or "permanent",
                    "message": _as_non_empty_string(error.get("message")) or "YouTube fixture failed",
                    "mode": "fixture",
                },
            )
            return

        pages = scenario.get("pages")
        if not isinstance(pages, list):
            self.fail_task(task_id, "YOUTUBE_INVALID_FIXTURE", "Fixture scenario has no pages")
            return
        normalized: List[Dict[str, Any]] = []
        for page_index, page in enumerate(pages):
            if not isinstance(page, dict):
                continue
            entries: Iterable[Any] = page.get("items") if isinstance(page.get("items"), list) else page.get("results", [])
            if not isinstance(entries, list):
                entries = []
            for item_index, raw_item in enumerate(entries):
                if not isinstance(raw_item, dict):
                    self.emit("warning", task_id=task_id, payload={"code": "YOUTUBE_INVALID_ITEM", "page": page_index, "item": item_index, "mode": "fixture"})
                    continue
                item = _normalize_item(raw_item)
                if item is None:
                    self.emit("warning", task_id=task_id, payload={"code": "YOUTUBE_MISSING_NATIVE_ID", "page": page_index, "item": item_index, "mode": "fixture"})
                    continue
                normalized.append(item)
                self.emit("item", task_id=task_id, payload=item)
            self.emit("checkpoint", task_id=task_id, payload={"cursor": str(page_index + 1), "mode": "fixture"})
            self.emit("progress", task_id=task_id, payload={"completed": len(normalized), "total": len(normalized), "page": page_index + 1, "pages": len(pages), "mode": "fixture"})
        task["terminal"] = True
        self.emit("task.completed", task_id=task_id, payload={"items": len(normalized), "pages": len(pages), "scenario": scenario_name, "mode": "fixture"})

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
            scenario_name = _as_non_empty_string(command["payload"].get("fixtureScenario")) or "pagination"
            scenario = self.fixtures.get(scenario_name)
            self.tasks[task_id] = {"terminal": False, "authenticated": True}
            self.emit("task.accepted", task_id=task_id, payload={"mode": "fixture", "scenario": scenario_name})
            if not isinstance(scenario, dict):
                self.fail_task(task_id, "YOUTUBE_UNKNOWN_FIXTURE", "Unknown YouTube fixture scenario")
                return
            self._emit_fixture_task(task_id, scenario_name, scenario)
            return
        super().handle(command)


class YouTubeWorker(YouTubeFixtureWorker):
    """Production ytscrape path plus the inherited deterministic fixture path.

    ``module_loader`` is intentionally injectable so this boundary can be tested
    with local model doubles.  It is not a user-facing configuration option.
    """

    def __init__(self, module_loader: Callable[[], Any] = lambda: importlib.import_module("ytscrape")) -> None:
        super().__init__()
        self._module_loader = module_loader

    @staticmethod
    def _client_factory(module: Any) -> Callable[..., Any]:
        factory = getattr(module, "YouTube", None)
        if not callable(factory):
            raise ImportError("ytscrape.YouTube is unavailable")
        return factory

    @staticmethod
    def _search_results(client: Any, module: Any, config: Dict[str, Any]) -> Iterable[Any]:
        search = getattr(client, "search", None)
        if not callable(search):
            raise AttributeError("ytscrape YouTube.search is unavailable")
        search_filter = getattr(getattr(module, "SearchFilter", None), "CHANNELS", None)
        if search_filter is None:
            raise AttributeError("ytscrape SearchFilter.CHANNELS is unavailable")
        results = search(config["query"], filter=search_filter, max_results=config["maxResults"])
        if isinstance(results, dict):
            results = results.get("items", results.get("results"))
        if isinstance(results, (str, bytes)) or not isinstance(results, Iterable):
            raise ValueError("Unexpected ytscrape search response")
        return results

    @staticmethod
    def _with_channel_details(client: Any, summary: Any) -> Any:
        """Best-effort detail lookup; a search result remains useful by itself."""
        lookup = getattr(client, "channel", None)
        identifier = _public_value(_get_field(summary, "id", "channel_id", "channelId", "handle"))
        if not callable(lookup) or not identifier:
            return summary
        try:
            return lookup(identifier)
        except BaseException:
            # A single inaccessible channel must not discard a complete search.
            return summary

    def _emit_live_failure(self, task_id: str, error: BaseException) -> None:
        code, classification, message = _classify_live_error(error)
        task = self.tasks.get(task_id)
        if not task or task["terminal"]:
            return
        task["terminal"] = True
        self.emit("task.failed", task_id=task_id, payload={
            "code": code,
            "classification": classification,
            "message": message,
            "mode": "live",
        })

    def _emit_live_task(self, task_id: str, config: Dict[str, Any]) -> None:
        task = self.tasks[task_id]
        self.emit("session.updated", task_id=task_id, payload={"state": "ready", "mode": "live"})
        client = None
        emitted = 0
        try:
            module = self._module_loader()
            factory = self._client_factory(module)
            client_options = {key: config[key] for key in ("language", "region") if key in config}
            client = factory(**client_options)
            enter = getattr(client, "__enter__", None)
            exit_method = getattr(client, "__exit__", None)
            active_client = enter() if callable(enter) else client
            try:
                summaries = list(self._search_results(active_client, module, config))
                normalized: List[Dict[str, Any]] = []
                for summary in summaries:
                    channel = self._with_channel_details(active_client, summary)
                    item = _normalize_live_channel(channel)
                    if item is None:
                        self.emit("warning", task_id=task_id, payload={"code": "YOUTUBE_MISSING_NATIVE_ID", "mode": "live"})
                        continue
                    normalized.append(item)

                resume_after = config.get("resumeAfter")
                start_index = 0
                if resume_after:
                    positions = [index for index, item in enumerate(normalized) if item["nativeId"] == resume_after]
                    if positions:
                        start_index = positions[-1] + 1
                    else:
                        self.emit("warning", task_id=task_id, payload={"code": "YOUTUBE_RESUME_CURSOR_NOT_FOUND", "mode": "live"})
                emitted = 0
                for item in normalized[start_index:]:
                    if task["terminal"]:
                        return
                    emitted += 1
                    self.emit("item", task_id=task_id, payload=item)
                    self.emit("checkpoint", task_id=task_id, payload={"cursor": item["nativeId"], "mode": "live"})
                    self.emit("progress", task_id=task_id, payload={
                        "completed": emitted,
                        "total": len(normalized) - start_index,
                        "mode": "live",
                    })
            finally:
                if callable(exit_method):
                    exit_method(None, None, None)
        except BaseException as error:
            self._emit_live_failure(task_id, error)
            return

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
            self.tasks[task_id] = {"terminal": False, "authenticated": True}
            self.emit("task.accepted", task_id=task_id, payload={"mode": "live"})
            if error:
                # Invalid operator input is stable and should not be retried.
                self.tasks[task_id]["terminal"] = True
                self.emit("task.failed", task_id=task_id, payload={
                    "code": "YOUTUBE_INVALID_CONFIG", "classification": "permanent", "message": error, "mode": "live",
                })
                return
            self._emit_live_task(task_id, config)
            return
        super().handle(command)


if __name__ == "__main__":
    YouTubeWorker().run()
