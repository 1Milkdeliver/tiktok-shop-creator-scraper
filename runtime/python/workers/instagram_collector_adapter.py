"""Small local wrapper around the bundled :mod:`instagrapi` client.

The wrapper deliberately has no login API.  A session, when one is needed, is
loaded from an opaque JSON state file prepared by the Electron credential
broker.  The file contents never leave this module.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Optional


class InstagramSessionStateError(RuntimeError):
    """The local, broker-created session state cannot be used safely."""


def _trusted_state_file(value: Optional[str]) -> Optional[Path]:
    """Resolve a broker path without allowing arbitrary local-file reads.

    ``COLLECTOR_STATE_ROOT`` is set only by the parent process for live
    collection.  Keeping this policy here means a worker task cannot turn a
    state-file option into a generic file-reading primitive.
    """
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise InstagramSessionStateError("Instagram session state is invalid")
    root_value = os.environ.get("COLLECTOR_STATE_ROOT")
    if not root_value:
        raise InstagramSessionStateError("Instagram session state is unavailable")
    try:
        root = Path(root_value).resolve(strict=True)
        path = Path(value).resolve(strict=True)
        path.relative_to(root)
    except (OSError, RuntimeError, ValueError) as error:
        raise InstagramSessionStateError("Instagram session state is unavailable") from error
    if path.suffix.lower() != ".json" or not path.is_file():
        raise InstagramSessionStateError("Instagram session state is invalid")
    return path


class Client:
    """Public-profile client compatible with the worker's narrow interface."""

    def __init__(self, session_state_path: Optional[str] = None, client_factory: Any = None) -> None:
        if client_factory is None:
            try:
                from instagrapi import Client as instagrapi_client
            except ImportError as error:
                raise ImportError("Bundled instagrapi client is unavailable") from error
            client_factory = instagrapi_client
        self._client = client_factory()
        state_path = _trusted_state_file(session_state_path)
        if state_path is not None:
            try:
                # instagrapi owns parsing this internal state format.  We never
                # convert it to a dict, log it, or return it to the worker.
                self._client.load_settings(state_path)
            except BaseException as error:
                raise InstagramSessionStateError("Instagram session state could not be loaded") from error

    def user_info_by_username(self, username: str) -> Any:
        return self._client.user_info_by_username(username)

    def search_users(self, query: str, amount: int = 50) -> Any:
        """Return only the bounded public account-search result list.

        The worker still resolves each result through ``user_info_by_username``
        before persistence, so search summaries alone never become creator rows.
        """
        search = getattr(self._client, "search_users", None)
        if not callable(search):
            raise AttributeError("Bundled Instagram client search_users is unavailable")
        results = search(query)
        if not isinstance(results, (list, tuple)):
            raise ValueError("Instagram account search returned an unexpected response")
        return list(results)[:max(1, min(int(amount), 50))]


def create_client(session_state_path: Optional[str] = None) -> Client:
    return Client(session_state_path=session_state_path)
