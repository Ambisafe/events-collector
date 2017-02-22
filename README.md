# events-collector

Convenient way to parse events from Ethereum blockchain.

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
}).then(events => {
  console.log(JSON.stringify(events));
})
```
