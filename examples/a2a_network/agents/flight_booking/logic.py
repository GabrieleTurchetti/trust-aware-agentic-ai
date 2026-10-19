"""Mock flight search: plausible but fake data, no A2A involved."""

import random
from dataclasses import dataclass

DEFAULT_ORIGIN = "New York"
DEFAULT_DESTINATION = "Milan"

# Known cities: a flight can leave from and go to any of them.
KNOWN_CITIES = ["New York", "London", "Paris", "Rome", "Milan", "Berlin", "Madrid", "Tokyo"]
# Flights are priced in US dollars, whatever the route.
CURRENCY = "USD"
# Lowest and highest price of one flight.
FLIGHT_PRICE_RANGE = (150, 1200)
AIRLINES = ["ITA Airways", "Lufthansa", "Air France", "Delta", "British Airways", "Emirates"]


@dataclass(frozen=True)
class Flight:
    airline: str
    flight_number: str
    origin: str
    destination: str
    departure: str
    duration_hours: float
    price: int
    currency: str


def parse_origin(request: str) -> str | None:
    """Read the origin from "from <city>", or None if the request does not say it."""
    lowered = request.lower()
    for city in KNOWN_CITIES:
        if f"from {city.lower()}" in lowered:
            return city
    return None


def parse_destination(request: str, origin: str | None) -> str | None:
    """Read the destination from "to <city>", else take the first other known city mentioned.

    Returns None if the request mentions no known city apart from the origin.
    """
    lowered = request.lower()
    for city in KNOWN_CITIES:
        if f"to {city.lower()}" in lowered:
            return city
    for city in KNOWN_CITIES:
        if city.lower() in lowered and city != origin:
            return city
    return None


def parse_route(request: str) -> tuple[str, str]:
    """Read origin and destination, taking a default for each end the request does not name.

    If an end's default is already the other end, it takes the other default instead:
    "Flights to New York" leave from Milan and "Flights from Milan" go to New York.
    """
    origin = parse_origin(request)
    destination = parse_destination(request, origin)
    if origin is None:
        origin = DEFAULT_ORIGIN if destination != DEFAULT_ORIGIN else DEFAULT_DESTINATION
    if destination is None:
        destination = DEFAULT_DESTINATION if origin != DEFAULT_DESTINATION else DEFAULT_ORIGIN
    return origin, destination


def search_flights(request: str, count: int = 3) -> list[Flight]:
    """Return mock flights for the route in the request; same route, same flights."""
    origin, destination = parse_route(request)
    low, high = FLIGHT_PRICE_RANGE
    rng = random.Random(f"flights from {origin} to {destination}")
    flights = []
    for airline in rng.sample(AIRLINES, count):
        flights.append(
            Flight(
                airline=airline,
                flight_number=f"{airline[:2].upper()}{rng.randint(100, 999)}",
                origin=origin,
                destination=destination,
                departure=f"{rng.randint(6, 22):02d}:{rng.choice(['00', '15', '30', '45'])}",
                duration_hours=round(rng.uniform(1.5, 12.0), 1),
                price=rng.randint(low, high),
                currency=CURRENCY,
            )
        )
    return sorted(flights, key=lambda f: f.price)
