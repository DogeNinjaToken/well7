# Deepwell V7 WELL7 testnet frontend

Generated addresses are written to `static/js/bsc-config.js`, `meme/config.js` and `strength/config.js` after a successful deployment. Never copy addresses from an older build.

Pages include Overview, Token Staking, Stock Staking, Vaults, Meme Pools, Apply to List, Genesis, Protocol Strength, Docs, Pool Management and the local Control Centre. Static admin pages require a connected owner wallet for owner-only actions. The application form exports JSON locally and does not submit to a server.

Genesis uses mock tUSDT. On successful finalization, the configured PancakeSwap V2 testnet sink creates a pair and sends LP tokens to the permanent POL vault. Testnet transactions and assets do not represent market liquidity or a real token value.

Protocol conversions use an allowlisted V2/V3 route adapter. PancakeSwap Smart Router is used by the optional read-only route discovery helper; V4/Infinity routes are excluded. V3 POL uses full-range positions held in V3POLCustodyVault. Position NFTs and V2 LP tokens are never accepted by token staking pools. See `scripts/ROUTE-DISCOVERY.md` and Manage → Route Configuration for operations.
