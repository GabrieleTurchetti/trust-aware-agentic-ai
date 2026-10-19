"""The assistant's workflow for one request: discovery, selection, delegation and budget."""

import asyncio
from collections.abc import Sequence
from dataclasses import dataclass

import httpx
from a2a.client import ClientConfig, ClientFactory
from a2a.types import AgentCard

from .budget import Cost, estimate_budget, requested_currency
from .delegation import Reply, ask_agent
from .discovery import AGENT_URLS, discover_agents
from .selection import Selection, select_agents

# The agent with this skill is not asked about the trip: it converts the budget.
CONVERSION_SKILL = "currency-conversion"


@dataclass(frozen=True)
class TripPlan:
    """What the assistant found and did for one request."""

    request: str
    discovered: list[AgentCard]
    selected: list[Selection]
    replies: list[Reply]
    costs: list[Cost]


async def plan_trip(
    request: str, http: httpx.AsyncClient, urls: Sequence[str] = AGENT_URLS
) -> TripPlan:
    """Handle a travel request with the agents published at the urls."""
    factory = ClientFactory(ClientConfig(httpx_client=http))

    # 1. Discovery: read the Agent Card of every known agent.
    discovered = await discover_agents(http, urls)

    # 2. Selection: keep the agents whose skills match the request.
    selected = select_agents(request, discovered)
    travel_agents = []
    converter = None
    for selection in selected:
        if selection.skill.id == CONVERSION_SKILL:
            converter = selection.card
        else:
            travel_agents.append(selection.card)

    # 3. Delegation: forward the request to all the travel agents at the same time.
    replies = await asyncio.gather(*(ask_agent(factory, agent, request) for agent in travel_agents))

    # 4. Budget: the cheapest offer of each agent, converted to the currency of the request.
    costs = await estimate_budget(factory, replies, requested_currency(request), converter)

    return TripPlan(request, discovered, selected, replies, costs)
