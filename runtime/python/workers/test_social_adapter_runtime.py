"""Offline tests for the bundled Instagram and X adapter safety boundaries."""

from __future__ import annotations

import os
import tempfile
import unittest
from pathlib import Path

from instagram_collector_adapter import Client as InstagramClient
from instagram_collector_adapter import InstagramSessionStateError
from x_collector_adapter import Collector as XCollector
from x_collector_adapter import XAccountStateError


class _InstagramClient:
    def __init__(self):
        self.loaded = None

    def load_settings(self, path):
        self.loaded = Path(path)

    def user_info_by_username(self, username):
        return {"username": username}


class _User:
    id_str = "x-1"
    username = "public_creator"
    displayname = "Public Creator"
    rawDescription = "Public profile description"
    followersCount = 12
    statusesCount = 3


class _Api:
    def __init__(self, **kwargs):
        self.kwargs = kwargs

    async def search_user(self, query, limit):
        self.query = query
        self.limit = limit
        yield _User()


class SocialAdapterRuntimeTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.previous_root = os.environ.get("COLLECTOR_STATE_ROOT")
        os.environ["COLLECTOR_STATE_ROOT"] = str(self.root)

    def tearDown(self):
        if self.previous_root is None:
            os.environ.pop("COLLECTOR_STATE_ROOT", None)
        else:
            os.environ["COLLECTOR_STATE_ROOT"] = self.previous_root
        self.directory.cleanup()

    def test_instagram_loads_only_broker_state_inside_state_root(self):
        state = self.root / "instagram-session.json"
        state.write_text("{}", encoding="utf-8")
        wrapped = InstagramClient(str(state), client_factory=_InstagramClient)
        self.assertEqual(wrapped._client.loaded, state)
        self.assertEqual(wrapped.user_info_by_username("creator")["username"], "creator")

        with self.assertRaises(InstagramSessionStateError):
            InstagramClient(str(self.root.parent / "outside.json"), client_factory=_InstagramClient)

    def test_x_uses_broker_pool_path_and_exports_only_public_user_fields(self):
        state = self.root / "x-accounts.db"
        state.write_bytes(b"not-read-by-fake")
        wrapped = XCollector(str(state), api_factory=_Api)
        items = wrapped.search_creators("home creators", max_results=4)
        self.assertEqual(wrapped._api.kwargs["pool"], str(state))
        self.assertEqual(wrapped._api.kwargs["wait_timeout"], 0)
        self.assertEqual(items, [{
            "id": "x-1", "username": "public_creator", "name": "Public Creator",
            "description": "Public profile description", "followers_count": 12, "statuses_count": 3,
        }])

    def test_x_rejects_an_untrusted_pool_path(self):
        with self.assertRaises(XAccountStateError):
            XCollector(str(self.root.parent / "outside.db"), api_factory=_Api)


if __name__ == "__main__":
    unittest.main()
