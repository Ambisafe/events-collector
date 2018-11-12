'use strict';

const Promise = require('bluebird');
const Web3 = require('web3');
const SolidityEvent = require('web3/lib/web3/event');
const ProviderEngine = require('web3-provider-engine');
const FilterSubprovider = require('web3-provider-engine/subproviders/filters');
const RpcSubprovider = require('web3-provider-engine/subproviders/rpc');



function eventsCollector(args) {
  const rpcUrl = args.rpcUrl || 'http://localhost:8545';
  const log = args.log || (() => {});
  const abi = args.abi;
  const address = args.address;
  const blockStep = args.blockStep || 10000;
  const fromBlock = args.fromBlock || 0;
  const toBlock = args.toBlock || 'latest';
  const blocksExclude = args.blocksExclude || 0;
  const timestamps = args.timestamps == undefined ? true : args.timestamps;

  const engine = new ProviderEngine();
  const web3 = new Web3(engine);
  engine.addProvider(new FilterSubprovider());
  engine.addProvider(new RpcSubprovider({ rpcUrl }));
  engine.on('error', log);
  const engineReady = new Promise((resolve, reject) => {
    try {
      engine.once('block', () => {
        resolve();
      });
    } catch(err) {
      reject(err);
    }
  });
  engine.start();

  web3.eth = Promise.promisifyAll(web3.eth);
  
  const getTopics = (abi) => {
    let topics = {};
    for (let i = 0; i < abi.length; i++) {
      let item = abi[i];
      if (item.type != 'event') continue;
      let signature = item.name + "(" + item.inputs.map(function(input) {return input.type;}).join(",") + ")";
      let hash = web3.sha3(signature);
      topics[hash] = item;
    }
    return topics;
  };

  // Add threshold of parallel requests allowed for getBlock
  const getBlockInQueue = (() => {
    let waitList = [];
    let flows = 0;
    let threshold = 50;
    const sendRequest = () => {
      if (flows < threshold && waitList.length > 0) {
        flows++;
        const request = waitList.shift();
        web3.eth.getBlockAsync(request.blockHash)
        .timeout(5000)
        .then(block => {
          if (block === null) {
            return Promise.reject(new Error('Block response is null'));
          }
          return request.resolve(block);
        })
        .catch(request.reject)
        .finally(() => {
          flows--;
          setImmediate(sendRequest);
        });
      }
    };
    const poll = blockHash => {
      return new Promise((resolve, reject) => {
        waitList.push({blockHash, resolve, reject});
        sendRequest();
      }).catch(err => {
        if (err && (err.message == 'Block response is null')) {
          return poll(blockHash);
        }
        return Promise.delay(5000).then(() => poll(blockHash))
      });
    };
    return poll;
  })();

  let timestamp = (() => {
    let requests = {};
    return (event) => {
      requests[event.blockHash] = requests[event.blockHash] || getBlockInQueue(event.blockHash);
      return requests[event.blockHash]
        .then(result => {
          event.timestamp = result.timestamp;
          return event;
        });
    };
  })();

  let decodeLogs = (logs, topics) => {
    return logs.map(log => {
      let logABI = topics[log.topics[0]];

      if (logABI == null) {
        return null;
      }

      let decoder = new SolidityEvent(null, logABI, log.address);
      try {
        return decoder.decode(log);
      } catch(e) {
        console.log(JSON.stringify(log));
        throw e;
      }
    }).filter(log => {
      return log != null;
    });
  };

  let collectEvents = (address, abi, blockParts) => {
    const decodeTopics = getTopics(abi);
    const topics = Object.keys(decodeTopics);
    return blockParts.reduce(
      (prev, curr) =>
        prev.then(events => {
          let filter = Promise.promisifyAll(web3.eth.filter({address, topics: [topics.length > 0 ? topics : null], fromBlock: curr[0], toBlock: curr[1]}));
          return filter.getAsync()
            .then(results => {
              log(`${curr[0]}-${curr[1]}: ${results.length} events found...`);
              return events.concat(results);
            })
            .finally(() => filter.stopWatchingAsync());
        }),
      Promise.resolve([])
    ).then(logs => decodeLogs(logs, decodeTopics));
  }

  let parsedToBlock;
  return engineReady
  .then(() => web3.eth.getBlockNumberAsync())
  .then(result => {
    log('Latest block number on blockchain', result);
    // In case the toBlock is bigger than the latest block, replace with current
    if (toBlock === 'latest' || toBlock === 'pending' || toBlock >= result) {
      return result - blocksExclude; // To not load the data that can possibly end up in losing chain.
    }
    return toBlock;
  }).then(parsed => {
    parsedToBlock = parsed;
    if (fromBlock >= parsedToBlock) {
      parsedToBlock = fromBlock;
      return [];
    }
    log(`Collecting events from blocks ${fromBlock + 1}-${parsedToBlock}.`);
    let parts = Array.from({length: Math.ceil((parsedToBlock - fromBlock) / blockStep)}, (v, k) => [fromBlock + (blockStep * k) + 1, fromBlock + (blockStep * (k + 1))]);
    // Set last part parsedToBlock to requested parsedToBlock
    parts[parts.length - 1][1] = parsedToBlock;
    return collectEvents(address, abi, parts);
  }).then(newEvents => {
    let filtered = newEvents.filter(event => !!event.args);
    let skipped = newEvents.length - filtered.length;
    if (skipped > 0) {
      log(`Warning: ${skipped} events skipped. Consider updating ABI.`);
    }
    return filtered;
  }).then(newEvents => {
    log(`${newEvents.length} new events found.`);
    return timestamps ? Promise.all(newEvents.map(timestamp)).tap(() => log('Timestamps populated.')) : newEvents;
  }).then(events => [events, parsedToBlock])
  .finally(() => {
    engine.stop();
  });
}

module.exports = eventsCollector;
