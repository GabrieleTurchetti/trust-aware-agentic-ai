"""Mock tour suggestions: plausible but fake data, no A2A involved."""

import random
from dataclasses import dataclass

DEFAULT_CITY = "Milan"

# Known cities, with the currency their tours are priced in.
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
# Lowest and highest price of one tour, per currency.
TOUR_PRICE_RANGES = {
    "USD": (30, 150),
    "GBP": (25, 120),
    "EUR": (20, 110),
    "JPY": (3000, 15000),
}
# The tours to choose from in each known city.
CITY_TOURS = {
    "New York": [
        "Statue of Liberty and Ellis Island tour",
        "Central Park bike tour",
        "Top of the Rock observation deck",
        "Brooklyn Bridge and DUMBO walk",
    ],
    "London": [
        "Tower of London and Crown Jewels tour",
        "British Museum highlights tour",
        "Westminster and Big Ben walk",
        "Thames river cruise",
    ],
    "Paris": [
        "Louvre highlights guided tour",
        "Eiffel Tower summit visit",
        "Montmartre artists walk",
        "Seine river evening cruise",
    ],
    "Rome": [
        "Colosseum and Roman Forum guided tour",
        "Vatican Museums and Sistine Chapel visit",
        "Trastevere food tasting walk",
        "Pantheon and Trevi Fountain evening walk",
    ],
    "Milan": [
        "Duomo and rooftop terraces guided tour",
        "The Last Supper skip-the-line visit",
        "Navigli canals aperitivo walk",
        "Sforza Castle and Sempione Park tour",
    ],
    "Berlin": [
        "Berlin Wall and Checkpoint Charlie tour",
        "Museum Island highlights tour",
        "Reichstag dome visit",
        "Kreuzberg street food walk",
    ],
    "Madrid": [
        "Prado Museum guided tour",
        "Royal Palace visit",
        "Tapas tour in La Latina",
        "Retiro Park bike tour",
    ],
    "Tokyo": [
        "Asakusa and Senso-ji temple walk",
        "Tsukiji outer market food tour",
        "Shibuya and Harajuku walking tour",
        "Meiji Shrine and Yoyogi Park walk",
    ],
}


@dataclass(frozen=True)
class Tour:
    name: str
    city: str
    duration_hours: float
    price: int
    currency: str


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


def suggest_tours(request: str, count: int = 3) -> list[Tour]:
    """Return mock tours in the city of the request; same city, same tours."""
    city = parse_city(request)
    currency = CITY_CURRENCIES[city]
    low, high = TOUR_PRICE_RANGES[currency]
    rng = random.Random(f"tours in {city}")
    tours = []
    for name in rng.sample(CITY_TOURS[city], count):
        tours.append(
            Tour(
                name=name,
                city=city,
                duration_hours=rng.choice([1.5, 2, 2.5, 3, 4]),
                price=rng.randint(low, high),
                currency=currency,
            )
        )
    return sorted(tours, key=lambda t: t.price)
