"""Selection: the assistant keeps the agents whose skills match the request."""

import re
from dataclasses import dataclass

from a2a.types import AgentCard, AgentSkill


@dataclass(frozen=True)
class Selection:
    """An agent chosen for the request, with its skill and the tag that matched."""

    card: AgentCard
    skill: AgentSkill
    tag: str


def normalize(word: str) -> str:
    """Lowercase the word and drop a final plural "s", so that "Flights" matches "flight"."""
    return word.lower().removesuffix("s")


def select_agents(request: str, cards: list[AgentCard]) -> list[Selection]:
    """Select every skill that has a tag among the words of the request."""
    words = {normalize(word) for word in re.findall(r"[a-zA-Z]+", request)}
    selected = []
    for card in cards:
        for skill in card.skills:
            for tag in skill.tags:
                if normalize(tag) in words:
                    selected.append(Selection(card, skill, tag))
                    break  # one matching tag is enough for this skill
    return selected
