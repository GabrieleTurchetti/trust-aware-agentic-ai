"""Agent Card of the Flight Booking Agent."""

from a2a.types import AgentCapabilities, AgentCard, AgentInterface, AgentSkill
from a2a.utils.constants import PROTOCOL_VERSION_CURRENT, TransportProtocol

PORT = 9001
URL = f"http://localhost:{PORT}/"

FLIGHT_BOOKING_SKILL = AgentSkill(
    id="flight-booking",
    name="Flight Booking",
    description="Finds flight options to a destination city, with prices in USD.",
    tags=["travel", "flights", "booking"],
    examples=[
        "Find flights to Milan next week",
        "I need a flight from New York to Rome",
    ],
)

AGENT_CARD = AgentCard(
    name="Flight Booking Agent",
    description="Returns flight options for a travel request.",
    version="0.1.0",
    supported_interfaces=[
        AgentInterface(
            url=URL,
            protocol_binding=TransportProtocol.JSONRPC.value,
            protocol_version=PROTOCOL_VERSION_CURRENT,
        )
    ],
    capabilities=AgentCapabilities(streaming=False),
    default_input_modes=["text/plain"],
    default_output_modes=["text/plain", "application/json"],
    skills=[FLIGHT_BOOKING_SKILL],
)
