"""Mock flight search: plausible but fake data, no A2A involved."""

import random
from dataclasses import dataclass

DEFAULT_ORIGIN = "New York"
DEFAULT_DESTINATION = "Milan"

KNOWN_CITIES = ["New York", "London", "Paris", "Rome", "Milan", "Berlin", "Madrid", "Tokyo"]
AIRLINES = ["ITA Airways", "Lufthansa", "Air France", "Delta", "British Airways", "Emirates"]


@dataclass(frozen=True)
class Flight:
    airline: str
    flight_number: str
    origin: str
    destination: str
    departure: str
    duration_hours: float
    price_usd: int


def _city_after(word: str, request: str) -> str | None:
    lowered = request.lower()
    return next((c for c in KNOWN_CITIES if f"{word} {c.lower()}" in lowered), None)


def parse_route(request: str) -> tuple[str, str]:
    """Read origin and destination from "from <city>" and "to <city>" in the request."""
    origin = _city_after("from", request) or DEFAULT_ORIGIN
    destination = _city_after("to", request)
    if destination is None:
        lowered = request.lower()
        destination = next(
            (c for c in KNOWN_CITIES if c.lower() in lowered and c != origin),
            DEFAULT_DESTINATION,
        )
    return origin, destination


def search_flights(request: str, count: int = 3) -> list[Flight]:
    """Return mock flights for the route in the request; same route, same results."""
    origin, destination = parse_route(request)
    rng = random.Random(f"{origin}->{destination}")
    flights = []
    for _ in range(count):
        airline = rng.choice(AIRLINES)
        flights.append(
            Flight(
                airline=airline,
                flight_number=f"{airline[:2].upper()}{rng.randint(100, 999)}",
                origin=origin,
                destination=destination,
                departure=f"{rng.randint(6, 22):02d}:{rng.choice(['00', '15', '30', '45'])}",
                duration_hours=round(rng.uniform(1.5, 12.0), 1),
                price_usd=rng.randint(150, 1200),
            )
        )
    return sorted(flights, key=lambda f: f.price_usd)
