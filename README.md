# events-collector

Convenient way to parse events from Ethereum blockchain.

## Installation

```bash
npm install events-collector@github:Ambisafe/events-collector
```

## Usage

```js
const eventsCollector = require('events-collector');
eventsCollector({
  rpcUrl: 'http://localhost:8545',
  log: console.log,
  abi: CONTRACT_ABI,
  address: CONTRACT_ADDRESS,
  blockStep: 10000,
  fromBlock: FROM_BLOCK,
  toBlock: 'latest',
  blocksExclude: 0,
  timestamps: true,
}).then(([events, parsedToBlock]) => {
  console.log(parsedToBlock, JSON.stringify(events));
})
```
