"""A2A executor of the Hotel Reservation Agent."""

from a2a.helpers import new_data_part, new_message, new_text_part
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.types import UnsupportedOperationError

from .logic import Hotel, search_hotels


def format_nights(nights: int) -> str:
    return "1 night" if nights == 1 else f"{nights} nights"


def format_hotels(hotels: list[Hotel]) -> str:
    lines = [f"Hotels in {hotels[0].city} for {format_nights(hotels[0].nights)}:"]
    for h in hotels:
        lines.append(
            f"- {h.name}, {h.stars} stars, {h.price_per_night} {h.currency}/night, "
            f"{h.total_price} {h.currency} in total"
        )
    return "\n".join(lines)


def hotel_offers(hotels: list[Hotel]) -> list[dict]:
    """The hotels as data for other agents: name, price of the whole stay and currency."""
    return [
        {
            "name": f"{h.name}, {format_nights(h.nights)}",
            "price": h.total_price,
            "currency": h.currency,
        }
        for h in hotels
    ]


class HotelReservationExecutor(AgentExecutor):
    """Answers each request with one message: the mock hotel options as text and as data."""

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        hotels = search_hotels(context.get_user_input())
        reply = new_message(
            [
                new_text_part(format_hotels(hotels)),
                new_data_part({"offers": hotel_offers(hotels)}),
            ],
            context_id=context.context_id,
        )
        await event_queue.enqueue_event(reply)

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        raise UnsupportedOperationError()
