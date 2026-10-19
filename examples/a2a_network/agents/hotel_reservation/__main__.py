"""Run with: python -m agents.hotel_reservation (from examples/a2a_network)."""

from common.server import serve

from .card import AGENT_CARD, PORT
from .executor import HotelReservationExecutor

serve(AGENT_CARD, HotelReservationExecutor(), port=PORT)
