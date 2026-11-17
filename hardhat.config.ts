import { defineConfig } from 'hardhat/config'

/**
 * Hardhat is used for two things only:
 *  - compiling `contracts/StatusList.sol` (`npm run compile`);
 *  - running the local JSON-RPC chain (`hardhat node`), which the tests and
 *    the examples start and stop by themselves (see
 *    `src/trust_aware_agentic_ai/chain.ts`).
 *
 * The ERC-1056 registry is not compiled here: its artifact comes from the
 * published `ethr-did-registry` package.
 */
export default defineConfig({
  solidity: '0.8.28',
})
