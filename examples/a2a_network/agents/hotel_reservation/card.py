"""Agent Card of the Hotel Reservation Agent."""

from a2a.types import AgentCapabilities, AgentCard, AgentInterface, AgentSkill
from a2a.utils.constants import PROTOCOL_VERSION_CURRENT, TransportProtocol

PORT = 9002
URL = f"http://localhost:{PORT}/"

HOTEL_RESERVATION_SKILL = AgentSkill(
    id="hotel-reservation",
    name="Hotel Reservation",
    description="Finds hotel options in a city for a stay, with prices in the local currency.",
    tags=["travel", "hotels", "accommodation"],
    examples=[
        "Find a hotel in Rome for 3 nights",
        "I need accommodation in Paris for a 4-day trip",
    ],
)

AGENT_CARD = AgentCard(
    name="Hotel Reservation Agent",
    description="Returns hotel options for a travel request.",
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
    skills=[HOTEL_RESERVATION_SKILL],
)
