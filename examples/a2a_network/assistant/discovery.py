"""Discovery: the assistant reads the Agent Card that each known agent publishes."""

import asyncio
import logging
from collections.abc import Sequence

import httpx
from a2a.client import A2ACardResolver, AgentCardResolutionError
from a2a.types import AgentCard

logger = logging.getLogger(__name__)

# Where the agents of the example network run: each one serves its Agent Card
# at <url>/.well-known/agent-card.json.
AGENT_URLS = (
    "http://localhost:9001",
    "http://localhost:9002",
    "http://localhost:9003",
    "http://localhost:9004",
)


async def fetch_card(http: httpx.AsyncClient, url: str) -> AgentCard | None:
    """Fetch the Agent Card published at the url, or None if it cannot be read."""
    try:
        return await A2ACardResolver(http, url).get_agent_card()
    except AgentCardResolutionError as error:
        logger.warning("No Agent Card at %s: %s", url, error)
        return None


async def discover_agents(http: httpx.AsyncClient, urls: Sequence[str]) -> list[AgentCard]:
    """Fetch the Agent Cards at all the urls at the same time, skipping the unreachable ones."""
    cards = await asyncio.gather(*(fetch_card(http, url) for url in urls))
    return [card for card in cards if card is not None]
