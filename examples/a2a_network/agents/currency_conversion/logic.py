"""Mock currency conversion: fixed, plausible exchange rates, no A2A involved."""

import re
from dataclasses import dataclass

# Value of one unit of each supported currency, in US dollars (mock rates).
USD_RATES = {"USD": 1.0, "EUR": 1.08, "GBP": 1.27, "JPY": 0.0067}

# "<amount> <currency> to <currency>", e.g. "100 eur to usd" or "250.50 gbp in jpy".
CONVERSION_PATTERN = re.compile(r"(\d+(?:\.\d+)?)\s*([a-z]{3})\s+(?:to|into|in)\s+([a-z]{3})\b")


@dataclass(frozen=True)
class Conversion:
    amount: float
    source: str
    target: str
    rate: float  # value of one unit of the source currency in the target currency

    @property
    def result(self) -> float:
        return round(self.amount * self.rate, 2)


def convert(request: str) -> Conversion | None:
    """Convert the amount in the request, e.g. "Convert 100 EUR to USD".

    Returns None if the request has no amount to convert or uses an unsupported currency.
    """
    match = CONVERSION_PATTERN.search(request.lower())
    if match is None:
        return None
    amount, source, target = match.groups()
    source, target = source.upper(), target.upper()
    if source not in USD_RATES or target not in USD_RATES:
        return None
    return Conversion(float(amount), source, target, rate=USD_RATES[source] / USD_RATES[target])
