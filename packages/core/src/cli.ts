// FailLens from the terminal:
//   node packages/core/src/cli.ts <tx-hash> <signer-account> [testnet|mainnet] [--json]
import { analyzeTx, fetchFtDecimals, fetchTx, formatReport } from './index.ts';
import type { Network } from './index.ts';

const [hash, sender, network = 'testnet'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!hash || !sender) {
  console.error('usage: cli.ts <tx-hash> <signer-account> [testnet|mainnet] [--json]');
  process.exit(2);
}
const net = network as Network;
const tx = await fetchTx({ hash, sender, network: net });
const tokens = analyzeTx(tx).movements.map((m) => m.asset).filter((a) => a !== 'NEAR');
const decimals = await fetchFtDecimals(tokens, { network: net });
const report = analyzeTx(tx, { decimals });
console.log(process.argv.includes('--json') ? JSON.stringify(report, null, 2) : formatReport(report, { decimals }));
