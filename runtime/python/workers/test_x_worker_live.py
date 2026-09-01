"""Offline contract tests for the injectable X live-worker boundary."""

import unittest

from x_worker import XWorker


class _Collector:
    def __init__(self, records=None, error=None):
        self.records = records or []
        self.error = error
        self.calls = []

    def search_creators(self, query, *, max_results):
        self.calls.append((query, max_results))
        if self.error:
            raise self.error
        return self.records


class XLiveWorkerTest(unittest.TestCase):
    def _events(self, worker):
        values = []
        worker.emit = lambda event_type, task_id=None, payload=None: values.append({
            "type": event_type, "taskId": task_id, "payload": payload or {},
        })
        return values

    def _start(self, worker, task_id="x-live", payload=None):
        worker.handle({
            "protocolVersion": 1, "type": "task.start", "platform": "x", "taskId": task_id,
            "payload": payload or {"query": "home creators", "maxResults": 3},
        })

    def _authenticate(self, worker, task_id="x-live", reference="broker-ref-1"):
        worker.handle({
            "protocolVersion": 1, "type": "auth.provide", "platform": "x", "taskId": task_id,
            "payload": {"brokerRef": reference},
        })

    def test_live_path_requires_broker_reference_then_emits_public_records_only(self):
        collector = _Collector(records=[{
            "id": "x-1", "name": "Home Maker", "username": "homemaker",
            "description": "Public profile", "followers_count": 42, "statuses_count": 4,
            "public_email": "contact@example.test", "email_provenance": "x:public-profile",
            "cookie": "must-not-pass-through",
        }])
        seen_reference = []
        worker = XWorker(collector_factory=lambda reference: seen_reference.append(reference) or collector)
        events = self._events(worker)

        self._start(worker)
        self.assertEqual(events[-1]["type"], "auth.required")
        self._authenticate(worker, reference="opaque-local-reference")

        self.assertEqual(seen_reference, ["opaque-local-reference"])
        self.assertEqual(collector.calls, [("home creators", 3)])
        item = next(event["payload"] for event in events if event["type"] == "item")
        self.assertEqual(item["nativeId"], "x-1")
        self.assertEqual(item["handle"], "@homemaker")
        self.assertEqual(item["publicEmail"], "contact@example.test")
        self.assertNotIn("cookie", item)
        self.assertEqual(events[-1]["type"], "task.completed")
        serialized = str(events)
        self.assertNotIn("opaque-local-reference", serialized)
        self.assertNotIn("must-not-pass-through", serialized)

    def test_live_path_returns_stable_safe_throttle_error(self):
        worker = XWorker(collector_factory=lambda _reference: _Collector(error=RuntimeError("429 token=private")))
        events = self._events(worker)
        self._start(worker)
        self._authenticate(worker, reference="private-reference")

        terminal = events[-1]
        self.assertEqual(terminal["type"], "task.failed")
        self.assertEqual(terminal["payload"]["code"], "THROTTLED")
        self.assertEqual(terminal["payload"]["classification"], "transient")
        self.assertNotIn("token=private", str(events))
        self.assertNotIn("private-reference", str(events))

    def test_live_path_rejects_missing_broker_reference_without_adapter_call(self):
        calls = []
        worker = XWorker(collector_factory=lambda reference: calls.append(reference))
        events = self._events(worker)
        self._start(worker)
        self._authenticate(worker, reference="")

        self.assertEqual(calls, [])
        self.assertEqual(events[-1]["payload"]["code"], "X_BROKER_REFERENCE_REQUIRED")
        self.assertEqual(events[-1]["payload"]["classification"], "action_required")

    def test_live_path_treats_missing_bundled_adapter_as_safe_unavailable_error(self):
        worker = XWorker(collector_factory=lambda _reference: (_ for _ in ()).throw(ImportError("internal module detail")))
        events = self._events(worker)
        self._start(worker)
        self._authenticate(worker)

        self.assertEqual(events[-1]["payload"]["code"], "X_COLLECTOR_UNAVAILABLE")
        self.assertEqual(events[-1]["payload"]["message"], "The bundled X collector is unavailable")
        self.assertNotIn("internal module detail", str(events))

    def test_broker_state_failure_requires_reconnecting_the_selected_account(self):
        worker = XWorker(collector_factory=lambda _reference: (_ for _ in ()).throw(RuntimeError("account state unavailable")))
        events = self._events(worker)
        self._start(worker)
        self._authenticate(worker, reference="private-state-path")

        self.assertEqual(events[-1]["payload"]["code"], "X_ACCOUNT_REAUTH_REQUIRED")
        self.assertNotIn("private-state-path", str(events))


if __name__ == "__main__":
    unittest.main()
