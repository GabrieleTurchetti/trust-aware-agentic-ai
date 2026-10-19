"""Budget: the cheapest offer of each agent, in the currency the user asked for."""

import asyncio
from dataclasses import dataclass

from a2a.client import ClientFactory
from a2a.types import AgentCard

from .delegation import Reply, ask_agent

CURRENCIES = ["USD", "EUR", "GBP", "JPY"]


@dataclass(frozen=True)
class Cost:
    agent: str  # name of the agent that made the offer
    item: str  # what the offer is, e.g. "Delta DE123"
    amount: float
    currency: str
    original: str = ""  # amount before the conversion, e.g. "360.00 EUR"; empty if not converted


def requested_currency(request: str) -> str | None:
    """The currency of the budget, from "in <code>" (e.g. "a budget in USD"); None if missing."""
    lowered = request.lower()
    for code in CURRENCIES:
        if f"in {code.lower()}" in lowered:
            return code
    return None


def cheapest_cost(reply: Reply) -> Cost | None:
    """The cheapest of the offers in the reply's data, or None if the agent sent no offers."""
    offers = reply.data.get("offers", [])
    if not offers:
        return None
    offer = min(offers, key=lambda o: o["price"])
    return Cost(reply.agent.name, offer["name"], offer["price"], offer["currency"])


async def convert_cost(
    factory: ClientFactory, converter: AgentCard, cost: Cost, currency: str
) -> Cost:
    """Ask the currency conversion agent to express the cost in the currency."""
    if cost.currency == currency:
        return cost
    original = f"{cost.amount:.2f} {cost.currency}"
    reply = await ask_agent(factory, converter, f"Convert {original} to {currency}")
    if "amount" not in reply.data:
        return cost  # the converter could not do it: keep the original amount
    return Cost(cost.agent, cost.item, reply.data["amount"], reply.data["currency"], original)


async def estimate_budget(
    factory: ClientFactory,
    replies: list[Reply],
    currency: str | None,
    converter: AgentCard | None,
) -> list[Cost]:
    """The cheapest offer of each reply, converted to the currency if there is a converter."""
    costs = []
    for reply in replies:
        cost = cheapest_cost(reply)
        if cost is not None:
            costs.append(cost)
    if currency is None or converter is None:
        return costs
    return await asyncio.gather(*(convert_cost(factory, converter, c, currency) for c in costs))


def totals(costs: list[Cost]) -> dict[str, float]:
    """Sum the costs per currency: a single entry when they were all converted."""
    result: dict[str, float] = {}
    for cost in costs:
        result[cost.currency] = result.get(cost.currency, 0) + cost.amount
    return result
