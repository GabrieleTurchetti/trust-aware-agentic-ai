"""Agent Card of the Local Tours Agent."""

from a2a.types import AgentCapabilities, AgentCard, AgentInterface, AgentSkill
from a2a.utils.constants import PROTOCOL_VERSION_CURRENT, TransportProtocol

PORT = 9004
URL = f"http://localhost:{PORT}/"

LOCAL_TOURS_SKILL = AgentSkill(
    id="local-tours",
    name="Local Tours",
    description="Suggests tours and activities in a city, with prices in the local currency.",
    tags=["travel", "tours", "activities", "sightseeing"],
    examples=[
        "Suggest some tours in Milan",
        "What activities can I do in Tokyo?",
    ],
)

AGENT_CARD = AgentCard(
    name="Local Tours Agent",
    description="Returns tours and activities for a travel request.",
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
    skills=[LOCAL_TOURS_SKILL],
)
