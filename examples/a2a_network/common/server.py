"""Shared bootstrap for the A2A agents of the example network."""

import uvicorn
from a2a.server.agent_execution import AgentExecutor
from a2a.server.request_handlers import DefaultRequestHandler
from a2a.server.routes import create_agent_card_routes, create_jsonrpc_routes
from a2a.server.tasks import InMemoryTaskStore
from a2a.types import AgentCard
from starlette.applications import Starlette


def build_app(card: AgentCard, executor: AgentExecutor) -> Starlette:
    """Build an ASGI app serving the Agent Card and the JSON-RPC endpoint."""
    handler = DefaultRequestHandler(
        agent_executor=executor,
        task_store=InMemoryTaskStore(),
        agent_card=card,
    )
    routes = [
        *create_agent_card_routes(card),
        *create_jsonrpc_routes(handler, rpc_url="/"),
    ]
    return Starlette(routes=routes)


def serve(card: AgentCard, executor: AgentExecutor, port: int, host: str = "127.0.0.1") -> None:
    """Run the agent as an HTTP server until interrupted."""
    uvicorn.run(build_app(card, executor), host=host, port=port)
