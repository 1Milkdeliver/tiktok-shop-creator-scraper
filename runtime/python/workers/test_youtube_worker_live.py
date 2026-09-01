"""Offline unit tests for the injectable production ytscrape boundary."""

from __future__ import annotations

import json
import types
import unittest

from youtube_worker import YouTubeWorker


class FakeSearchFilter:
    CHANNELS = "channels-only"


class FakeClient:
    def __init__(self, *, language=None, region=None, failure=None):
        self.language = language
        self.region = region
        self.failure = failure
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.closed = True

    def search(self, query, *, filter, max_results):
        if self.failure:
            raise self.failure
        assert query == "gardening"
        assert filter == FakeSearchFilter.CHANNELS
        assert max_results == 2
        return [
            types.SimpleNamespace(id="UC-1", title="Garden Lab", handle="gardenlab"),
            types.SimpleNamespace(id="UC-2", title="Plant Studio", handle="@plantstudio"),
        ]

    def channel(self, identifier):
        return {
            "id": identifier,
            "title": "Garden Lab" if identifier == "UC-1" else "Plant Studio",
            "handle": "gardenlab" if identifier == "UC-1" else "@plantstudio",
            "description": "Public creator profile",
            "subscribers": 1200,
            "video_count": 18,
            "links": {"business": "mailto:hello@example.test"} if identifier == "UC-1" else {},
        }


class YouTubeLiveWorkerTest(unittest.TestCase):
    def _worker(self, client):
        module = types.SimpleNamespace(YouTube=lambda **kwargs: client(**kwargs), SearchFilter=FakeSearchFilter)
        worker = YouTubeWorker(module_loader=lambda: module)
        events = []
        worker.emit = lambda event_type, **kwargs: events.append((event_type, kwargs.get("payload", {})))
        return worker, events

    def _start(self, worker, payload):
        worker.handle({
            "protocolVersion": 1,
            "type": "task.start",
            "platform": "youtube",
            "taskId": "live-test",
            "payload": payload,
        })

    def test_live_path_uses_injected_ytscrape_and_normalizes_public_fields(self):
        client = FakeClient
        worker, events = self._worker(client)
        self._start(worker, {"query": "gardening", "maxResults": 2, "language": "en", "region": "us"})

        items = [payload for event_type, payload in events if event_type == "item"]
        self.assertEqual([item["nativeId"] for item in items], ["UC-1", "UC-2"])
        self.assertEqual(items[0]["handle"], "@gardenlab")
        self.assertEqual(items[0]["publicEmail"], "hello@example.test")
        self.assertEqual(items[0]["stats"]["subscriberCount"], "1200")
        self.assertEqual(events[-1][0], "task.completed")

    def test_throttle_is_structured_and_never_serializes_exception_text(self):
        worker, events = self._worker(lambda **_: FakeClient(failure=RuntimeError("HTTP 429 token=do-not-log")))
        self._start(worker, {"query": "gardening", "maxResults": 2})

        event_type, payload = events[-1]
        self.assertEqual(event_type, "task.failed")
        self.assertEqual(payload["code"], "THROTTLED")
        self.assertEqual(payload["classification"], "transient")
        self.assertNotIn("do-not-log", json.dumps(events))

    def test_changed_upstream_shape_is_structured(self):
        worker, events = self._worker(lambda **_: FakeClient(failure=AttributeError("missing channelRenderer")))
        self._start(worker, {"query": "gardening", "maxResults": 2})
        self.assertEqual(events[-1][1]["code"], "UPSTREAM_CHANGED")

    def test_invalid_config_is_rejected_once_without_importing_collector(self):
        worker, events = self._worker(lambda **_: self.fail("collector should not load"))
        self._start(worker, {"query": "", "maxResults": "not-a-number"})
        failures = [payload for event_type, payload in events if event_type == "task.failed"]
        self.assertEqual(len(failures), 1)
        self.assertEqual(failures[0]["code"], "YOUTUBE_INVALID_CONFIG")


if __name__ == "__main__":
    unittest.main()
