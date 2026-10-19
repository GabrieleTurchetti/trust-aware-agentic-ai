"""A2A executor of the Flight Booking Agent."""

from a2a.helpers import new_data_part, new_message, new_text_part
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.types import UnsupportedOperationError

from .logic import Flight, search_flights


def format_flights(flights: list[Flight]) -> str:
    lines = [f"Flights from {flights[0].origin} to {flights[0].destination}:"]
    for f in flights:
        lines.append(
            f"- {f.airline} {f.flight_number}, departs {f.departure}, "
            f"{f.duration_hours}h, {f.price_usd} USD"
        )
    return "\n".join(lines)


def flight_offers(flights: list[Flight]) -> list[dict]:
    """The flights as data for other agents: name, price and currency of each one."""
    return [
        {"name": f"{f.airline} {f.flight_number}", "price": f.price_usd, "currency": "USD"}
        for f in flights
    ]


class FlightBookingExecutor(AgentExecutor):
    """Answers each request with one message: the mock flight options as text and as data."""

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        flights = search_flights(context.get_user_input())
        reply = new_message(
            [
                new_text_part(format_flights(flights)),
                new_data_part({"offers": flight_offers(flights)}),
            ],
            context_id=context.context_id,
        )
        await event_queue.enqueue_event(reply)

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        raise UnsupportedOperationError()
