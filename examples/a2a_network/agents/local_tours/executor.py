"""A2A executor of the Local Tours Agent."""

from a2a.helpers import new_data_part, new_message, new_text_part
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.types import UnsupportedOperationError

from .logic import Tour, suggest_tours


def format_tours(tours: list[Tour]) -> str:
    lines = [f"Tours in {tours[0].city}:"]
    for t in tours:
        lines.append(f"- {t.name}, {t.duration_hours}h, {t.price} {t.currency}")
    return "\n".join(lines)


def tour_offers(tours: list[Tour]) -> list[dict]:
    """The tours as data for other agents: name, price and currency of each one."""
    return [{"name": t.name, "price": t.price, "currency": t.currency} for t in tours]


class LocalToursExecutor(AgentExecutor):
    """Answers each request with one message: the mock tour suggestions as text and as data."""

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        tours = suggest_tours(context.get_user_input())
        reply = new_message(
            [
                new_text_part(format_tours(tours)),
                new_data_part({"offers": tour_offers(tours)}),
            ],
            context_id=context.context_id,
        )
        await event_queue.enqueue_event(reply)

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        raise UnsupportedOperationError()
