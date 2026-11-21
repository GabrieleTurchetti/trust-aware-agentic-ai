/**
 * Discovery and selection: Booking reads the Agent Card that each known agent
 * publishes at `<url>/.well-known/agent-card.json`, and keeps the agents that
 * advertise a skill.
 */
import type { AgentCard } from '@a2a-js/sdk'
import { DefaultAgentCardResolver } from '@a2a-js/sdk/client'

export interface DiscoveredAgent {
  /** Base URL the card was read from. */
  url: string
  card: AgentCard
}

export interface Discovery {
  agents: DiscoveredAgent[]
  unreachable: { url: string; error: string }[]
}

/**
 * Reads the Agent Cards at all the urls at the same time, skipping the
 * unreachable ones. The cards are passed as objects to ADK's `RemoteA2AAgent`
 * afterwards, so they are fetched only once.
 */
export async function discoverAgents(urls: readonly string[]): Promise<Discovery> {
  const resolver = new DefaultAgentCardResolver()
  const discovery: Discovery = { agents: [], unreachable: [] }
  const results = await Promise.all(
    urls.map(async (url): Promise<DiscoveredAgent | { url: string; error: string }> => {
      try {
        return { url, card: await resolver.resolve(url) }
      } catch (e) {
        return { url, error: e instanceof Error ? e.message : String(e) }
      }
    }),
  )
  for (const result of results) {
    if ('card' in result) discovery.agents.push(result)
    else discovery.unreachable.push(result)
  }
  return discovery
}

/** The agents whose card lists the skill. */
export function selectBySkill(agents: readonly DiscoveredAgent[], skillId: string): DiscoveredAgent[] {
  return agents.filter((agent) => agent.card.skills.some((skill) => skill.id === skillId))
}
