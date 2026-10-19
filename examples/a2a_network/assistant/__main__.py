"""Run with: python -m assistant ["<request>"] (from examples/a2a_network, agents running)."""

import asyncio
import sys

import httpx

from .budget import totals
from .planner import TripPlan, plan_trip

DEFAULT_REQUEST = (
    "Plan a 3-day trip to Milan next week, including flights, hotel and some local tours, "
    "with a budget in USD"
)


def format_plan(plan: TripPlan) -> str:
    lines = [f"Request: {plan.request}", "", f"Discovered agents ({len(plan.discovered)}):"]
    for card in plan.discovered:
        skills = ", ".join(skill.id for skill in card.skills)
        lines.append(f"- {card.name} at {card.supported_interfaces[0].url} (skills: {skills})")

    lines += ["", f"Selected agents ({len(plan.selected)}):"]
    for s in plan.selected:
        lines.append(f'- {s.card.name}: skill {s.skill.id}, matched tag "{s.tag}"')

    if not plan.replies:
        lines += ["", "No travel agent matched the request."]
    for reply in plan.replies:
        lines += ["", f"[{reply.agent.name}]", reply.text]

    if plan.costs:
        lines += ["", "Estimated budget (cheapest option of each agent):"]
        for cost in plan.costs:
            price = f"{cost.amount:.2f} {cost.currency}"
            if cost.original:
                price = f"{cost.original} = {price}"
            lines.append(f"- {cost.agent}: {cost.item}, {price}")
        total = " + ".join(f"{amount:.2f} {code}" for code, amount in totals(plan.costs).items())
        lines.append(f"Total: {total}")
    return "\n".join(lines)


async def main(request: str) -> None:
    async with httpx.AsyncClient() as http:
        plan = await plan_trip(request, http)
    print(format_plan(plan))


asyncio.run(main(" ".join(sys.argv[1:]) or DEFAULT_REQUEST))
