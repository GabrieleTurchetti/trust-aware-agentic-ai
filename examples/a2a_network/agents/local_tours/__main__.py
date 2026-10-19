"""Run with: python -m agents.local_tours (from examples/a2a_network)."""

from common.server import serve

from .card import AGENT_CARD, PORT
from .executor import LocalToursExecutor

serve(AGENT_CARD, LocalToursExecutor(), port=PORT)
