"""Agent Card of the Currency Conversion Agent."""

from a2a.types import AgentCapabilities, AgentCard, AgentInterface, AgentSkill
from a2a.utils.constants import PROTOCOL_VERSION_CURRENT, TransportProtocol

PORT = 9003
URL = f"http://localhost:{PORT}/"

CURRENCY_CONVERSION_SKILL = AgentSkill(
    id="currency-conversion",
    name="Currency Conversion",
    description="Converts an amount between USD, EUR, GBP and JPY using mock exchange rates.",
    tags=["currency", "exchange", "conversion", "usd", "eur", "gbp", "jpy"],
    examples=[
        "Convert 100 EUR to USD",
        "How much is 250 GBP in JPY?",
    ],
)

AGENT_CARD = AgentCard(
    name="Currency Conversion Agent",
    description="Converts amounts between currencies.",
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
    skills=[CURRENCY_CONVERSION_SKILL],
)
