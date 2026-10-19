"""Delegation: the assistant sends a sub-task to an agent and reads its reply."""

from dataclasses import dataclass
from typing import Any

from a2a.client import ClientFactory
from a2a.helpers import get_data_parts, get_message_text, new_text_message
from a2a.types import AgentCard, Role, SendMessageRequest


@dataclass(frozen=True)
class Reply:
    """An agent's answer: text for people and, if the agent sent any, data for programs."""

    agent: AgentCard
    text: str
    data: dict[str, Any]


async def ask_agent(factory: ClientFactory, agent: AgentCard, text: str) -> Reply:
    """Send the text to the agent as a user message and return the agent's reply."""
    # The client is not closed: that would also close the HTTP client shared by all agents.
    client = factory.create(agent)
    request = SendMessageRequest(message=new_text_message(text, role=Role.ROLE_USER))
    async for response in client.send_message(request):
        if response.HasField("message"):
            data_parts = get_data_parts(response.message.parts)
            data = data_parts[0] if data_parts else {}
            return Reply(agent, get_message_text(response.message), data)
    raise RuntimeError(f"{agent.name} did not reply with a message")
