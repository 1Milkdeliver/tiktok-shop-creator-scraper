"""Offline tests for the injectable public Instagram adapter boundary."""

from __future__ import annotations

import json
import types
import unittest

from instagram_worker import InstagramWorker


class FakeClient:
    def __init__(self, failure=None):
        self.failure = failure
        self.requested_handles = []

    def user_info_by_username(self, handle):
        self.requested_handles.append(handle)
        if self.failure:
            raise self.failure
        return {
            "pk": "ig-1" if handle == "trail.kitchen" else "ig-2",
            "username": handle,
            "full_name": "Trail Kitchen" if handle == "trail.kitchen" else "Garden Notebook",
            "biography": "Public profile biography",
            "follower_count": 1200,
            "media_count": 18,
            "category_name": "Food & Beverage",
            "public_email": "hello@example.test" if handle == "trail.kitchen" else "",
        }


class InstagramLiveWorkerTest(unittest.TestCase):
    def _worker(self, client_factory):
        module = types.SimpleNamespace(Client=client_factory)
        worker = InstagramWorker(module_loader=lambda: module)
        events = []
        worker.emit = lambda event_type, **kwargs: events.append((event_type, kwargs.get("payload", {})))
        return worker, events

    @staticmethod
    def _start(worker, payload):
        worker.handle({
            "protocolVersion": 1,
            "type": "task.start",
            "platform": "instagram",
            "taskId": "live-test",
            "payload": payload,
        })

    def test_live_path_uses_injected_public_adapter_and_normalizes_public_fields(self):
        client = FakeClient()
        worker, events = self._worker(lambda: client)
        self._start(worker, {"handles": ["@trail.kitchen", "garden.notebook", "TRAIL.KITCHEN"]})

        items = [payload for event_type, payload in events if event_type == "item"]
        self.assertEqual(client.requested_handles, ["trail.kitchen", "garden.notebook"])
        self.assertEqual([item["nativeId"] for item in items], ["ig-1", "ig-2"])
        self.assertEqual(items[0]["handle"], "@trail.kitchen")
        self.assertEqual(items[0]["contact"]["email"], "hello@example.test")
        self.assertEqual(items[0]["category"], "Food & Beverage")
        self.assertEqual(events[-1][0], "task.completed")

    def test_live_throttle_is_structured_and_does_not_echo_exception_or_payload_secrets(self):
        worker, events = self._worker(lambda: FakeClient(RuntimeError("HTTP 429 token=do-not-log")))
        self._start(worker, {"handle": "trail.kitchen", "password": "do-not-log", "session": "do-not-log"})

        event_type, payload = events[-1]
        self.assertEqual(event_type, "task.failed")
        self.assertEqual(payload["code"], "THROTTLED")
        self.assertEqual(payload["stage"], "profile_lookup")
        self.assertNotIn("do-not-log", json.dumps(events))

    def test_unavailable_adapter_is_safe_and_invalid_config_never_loads_adapter(self):
        def unavailable():
            raise ModuleNotFoundError("instagrapi missing secret=do-not-log")

        worker = InstagramWorker(module_loader=unavailable)
        events = []
        worker.emit = lambda event_type, **kwargs: events.append((event_type, kwargs.get("payload", {})))
        self._start(worker, {"handle": "trail.kitchen"})
        self.assertEqual(events[-1][1]["code"], "INSTAGRAM_ADAPTER_UNAVAILABLE")
        self.assertNotIn("do-not-log", json.dumps(events))

        worker, events = self._worker(lambda: self.fail("adapter should not load"))
        self._start(worker, {"handles": ["not valid!"]})
        self.assertEqual(events[-1][1]["code"], "INSTAGRAM_INVALID_CONFIG")

    def test_upstream_shape_change_is_structured(self):
        worker, events = self._worker(lambda: FakeClient(AttributeError("missing schema detail")))
        self._start(worker, {"handle": "trail.kitchen"})
        self.assertEqual(events[-1][1]["code"], "UPSTREAM_CHANGED")

    def test_adapter_factory_receives_opaque_state_path_without_emitting_it(self):
        seen_paths = []

        def create_client(state_path):
            seen_paths.append(state_path)
            return FakeClient()

        worker = InstagramWorker(module_loader=lambda: types.SimpleNamespace(create_client=create_client))
        events = []
        worker.emit = lambda event_type, **kwargs: events.append((event_type, kwargs.get("payload", {})))
        self._start(worker, {"handle": "trail.kitchen", "sessionStatePath": "opaque/private/session.json"})

        self.assertEqual(seen_paths, ["opaque/private/session.json"])
        self.assertNotIn("opaque/private/session.json", json.dumps(events))

    def test_profiles_before_a_later_throttle_are_emitted_with_checkpoints(self):
        class PartialClient(FakeClient):
            def user_info_by_username(self, handle):
                if handle == "garden.notebook":
                    raise RuntimeError("HTTP 429")
                return super().user_info_by_username(handle)

        worker, events = self._worker(lambda: PartialClient())
        self._start(worker, {"handles": ["trail.kitchen", "garden.notebook"]})

        self.assertEqual([payload["nativeId"] for event_type, payload in events if event_type == "item"], ["ig-1"])
        self.assertEqual([payload["cursor"] for event_type, payload in events if event_type == "checkpoint"], ["ig-1"])
        self.assertEqual(events[-1][0], "task.failed")
        self.assertEqual(events[-1][1]["code"], "THROTTLED")
        self.assertEqual(events[-1][1]["stage"], "profile_lookup")

    def test_discovery_only_saves_search_candidates_without_profile_lookup(self):
        class SearchClient(FakeClient):
            def search_users(self, query, amount):
                if query != "beauty" or amount != 2:
                    raise AssertionError("unexpected candidate search")
                return [
                    {"pk": "candidate-1", "username": "beauty.creator", "full_name": "Beauty Creator"},
                    {"pk": "candidate-2", "username": "home.notes", "full_name": "Home Notes"},
                ]

        client = SearchClient()
        worker, events = self._worker(lambda: client)
        self._start(worker, {"query": "beauty", "maxResults": 2, "discoveryOnly": True})

        items = [payload for event_type, payload in events if event_type == "item"]
        self.assertEqual(client.requested_handles, [])
        self.assertEqual([item["nativeId"] for item in items], ["candidate-1", "candidate-2"])
        self.assertTrue(all(item["verificationStatus"] == "pending_profile_check" for item in items))
        self.assertEqual(events[-1][0], "task.completed")


if __name__ == "__main__":
    unittest.main()
