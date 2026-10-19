"""A2A executor of the Currency Conversion Agent."""

from a2a.helpers import new_data_part, new_message, new_text_message, new_text_part
from a2a.server.agent_execution import AgentExecutor, RequestContext
from a2a.server.events import EventQueue
from a2a.types import UnsupportedOperationError

from .logic import USD_RATES, Conversion, convert

USAGE = (
    'I can convert amounts like "Convert 100 EUR to USD". '
    f"Supported currencies: {', '.join(USD_RATES)}."
)


def format_conversion(c: Conversion) -> str:
    return (
        f"{c.amount:.2f} {c.source} = {c.result:.2f} {c.target} "
        f"(1 {c.source} = {c.rate:.4f} {c.target})"
    )


class CurrencyConversionExecutor(AgentExecutor):
    """Answers each request with the converted amount as text and as data, or with a usage hint."""

    async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
        conversion = convert(context.get_user_input())
        if conversion is None:
            reply = new_text_message(USAGE, context_id=context.context_id)
        else:
            reply = new_message(
                [
                    new_text_part(format_conversion(conversion)),
                    new_data_part({"amount": conversion.result, "currency": conversion.target}),
                ],
                context_id=context.context_id,
            )
        await event_queue.enqueue_event(reply)

    async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
        raise UnsupportedOperationError()
