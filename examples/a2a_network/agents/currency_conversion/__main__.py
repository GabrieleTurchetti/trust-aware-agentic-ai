"""Run with: python -m agents.currency_conversion (from examples/a2a_network)."""

from common.server import serve

from .card import AGENT_CARD, PORT
from .executor import CurrencyConversionExecutor

serve(AGENT_CARD, CurrencyConversionExecutor(), port=PORT)
