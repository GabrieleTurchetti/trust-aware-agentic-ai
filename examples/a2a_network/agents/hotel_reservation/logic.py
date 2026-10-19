"""Mock hotel search: plausible but fake data, no A2A involved."""

import random
import re
from dataclasses import dataclass

DEFAULT_CITY = "Milan"
DEFAULT_NIGHTS = 2

# Known cities, with the currency their hotels are priced in.
CITY_CURRENCIES = {
    "New York": "USD",
    "London": "GBP",
    "Paris": "EUR",
    "Rome": "EUR",
    "Milan": "EUR",
    "Berlin": "EUR",
    "Madrid": "EUR",
    "Tokyo": "JPY",
}
# Lowest and highest price of one night, per currency.
NIGHT_PRICE_RANGES = {
    "USD": (150, 450),
    "GBP": (110, 350),
    "EUR": (90, 300),
    "JPY": (15000, 50000),
}
HOTEL_NAMES = [
    "Grand Hotel",
    "Central Hotel",
    "Boutique Inn",
    "City Suites",
    "Garden Hotel",
    "Station Hotel",
]


@dataclass(frozen=True)
class Hotel:
    name: str
    city: str
    stars: int
    nights: int
    price_per_night: int
    currency: str

    @property
    def total_price(self) -> int:
        return self.nights * self.price_per_night


def parse_city(request: str) -> str:
    """Read the city from "in <city>" or "to <city>", else take the first known city mentioned."""
    lowered = request.lower()
    for word in ("in", "to"):
        for city in CITY_CURRENCIES:
            if f"{word} {city.lower()}" in lowered:
                return city
    for city in CITY_CURRENCIES:
        if city.lower() in lowered:
            return city
    return DEFAULT_CITY


def parse_nights(request: str) -> int:
    """Read the stay from "<n> nights" or "<n> days" / "<n>-day" (a 3-day trip is 2 nights)."""
    lowered = request.lower()
    nights = re.search(r"(\d+)[ -]nights?", lowered)
    if nights:
        return max(int(nights.group(1)), 1)
    days = re.search(r"(\d+)[ -]days?", lowered)
    if days:
        return max(int(days.group(1)) - 1, 1)
    return DEFAULT_NIGHTS


def search_hotels(request: str, count: int = 3) -> list[Hotel]:
    """Return mock hotels for the city and stay in the request; same city, same hotels."""
    city = parse_city(request)
    nights = parse_nights(request)
    currency = CITY_CURRENCIES[city]
    low, high = NIGHT_PRICE_RANGES[currency]
    rng = random.Random(f"hotels in {city}")
    hotels = []
    for name in rng.sample(HOTEL_NAMES, count):
        hotels.append(
            Hotel(
                name=f"{name} {city}",
                city=city,
                stars=rng.randint(3, 5),
                nights=nights,
                price_per_night=rng.randint(low, high),
                currency=currency,
            )
        )
    return sorted(hotels, key=lambda h: h.price_per_night)
