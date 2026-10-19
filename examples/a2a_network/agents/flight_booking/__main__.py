"""Run with: python -m agents.flight_booking (from examples/a2a_network)."""

from common.server import serve

from .card import AGENT_CARD, PORT
from .executor import FlightBookingExecutor

serve(AGENT_CARD, FlightBookingExecutor(), port=PORT)
