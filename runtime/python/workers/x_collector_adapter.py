"""Local adapter around the bundled :mod:`twscrape` account-pool client.

The worker supplies an opaque, broker-managed SQLite pool path.  This adapter
does not create accounts or accept account credentials; it only uses an
existing local pool to request public account search results.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import Any, Dict, List


class XAccountStateError(RuntimeError):
    """The selected broker state cannot be used as an X account pool."""


def _trusted_pool_file(value: str) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise XAccountStateError("X account state is invalid")
    root_value = os.environ.get("COLLECTOR_STATE_ROOT")
    if not root_value:
        raise XAccountStateError("X account state is unavailable")
    try:
        root = Path(root_value).resolve(strict=True)
        path = Path(value).resolve(strict=True)
        path.relative_to(root)
    except (OSError, RuntimeError, ValueError) as error:
        raise XAccountStateError("X account state is unavailable") from error
    if path.suffix.lower() not in {".db", ".sqlite", ".sqlite3"} or not path.is_file():
        raise XAccountStateError("X account state is invalid")
    return path


def _public_user(user: Any) -> Dict[str, Any]:
    """Map the supported twscrape model without inspecting private internals."""
    return {
        "id": getattr(user, "id_str", None) or getattr(user, "id", None),
        "username": getattr(user, "username", None),
        "name": getattr(user, "displayname", None),
        "description": getattr(user, "rawDescription", None),
        "followers_count": getattr(user, "followersCount", None),
        "statuses_count": getattr(user, "statusesCount", None),
    }


class Collector:
    def __init__(self, broker_state_path: str, api_factory: Any = None) -> None:
        path = _trusted_pool_file(broker_state_path)
        if api_factory is None:
            try:
                from twscrape import API
            except ImportError as error:
                raise ImportError("Bundled twscrape client is unavailable") from error
            api_factory = API
        # Never allow an indefinite wait for a hidden account-pool operation.
        self._api = api_factory(pool=str(path), raise_when_no_account=True, wait_timeout=0)

    async def _search(self, query: str, max_results: int) -> List[Dict[str, Any]]:
        values: List[Dict[str, Any]] = []
        async for user in self._api.search_user(query, limit=max_results):
            values.append(_public_user(user))
        return values

    def search_creators(self, query: str, *, max_results: int) -> List[Dict[str, Any]]:
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return asyncio.run(self._search(query, max_results))
        raise XAccountStateError("X collection cannot run inside an active event loop")


def create_collector(broker_ref: str) -> Collector:
    # ``broker_ref`` is intentionally an opaque broker-managed state-file path;
    # it is never serialized into a protocol event or a creator record.
    return Collector(broker_ref)
