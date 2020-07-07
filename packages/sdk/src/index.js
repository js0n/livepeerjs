import Eth from 'ethjs'
import SignerProvider from 'ethjs-provider-signer'
import EthereumTx from 'ethereumjs-tx'
import {
  decodeParams,
  decodeEvent,
  encodeMethod,
  encodeSignature,
} from 'ethjs-abi'
import ENS from 'ethjs-ens'
import LivepeerTokenArtifact from '../etc/LivepeerToken'
import LivepeerTokenFaucetArtifact from '../etc/LivepeerTokenFaucet'
import ControllerArtifact from '../etc/Controller'
import RoundsManagerArtifact from '../etc/RoundsManager'
import BondingManagerArtifact from '../etc/BondingManager'
import MinterArtifact from '../etc/Minter'
import PollCreatorArtifact from '../etc/PollCreator'
import PollArtifact from '../etc/Poll'
import { VIDEO_PROFILES } from './video_profiles.js'

// Constants

export { VIDEO_PROFILES }
export const EMPTY_ADDRESS = '0x0000000000000000000000000000000000000000'
export const ADDRESS_PAD = '0x000000000000000000000000'
export const VIDEO_PROFILE_ID_SIZE = 8

const DELEGATOR_STATUS = ['Pending', 'Bonded', 'Unbonded', 'Unbonding']
DELEGATOR_STATUS.Pending = DELEGATOR_STATUS[0]
DELEGATOR_STATUS.Bonded = DELEGATOR_STATUS[1]
DELEGATOR_STATUS.Unbonded = DELEGATOR_STATUS[2]
DELEGATOR_STATUS.Unbonding = DELEGATOR_STATUS[3]
export { DELEGATOR_STATUS }
const TRANSCODER_STATUS = ['NotRegistered', 'Registered']
TRANSCODER_STATUS.NotRegistered = TRANSCODER_STATUS[0]
TRANSCODER_STATUS.Registered = TRANSCODER_STATUS[1]
export { TRANSCODER_STATUS }

// Defaults
export const DEFAULTS = {
  controllerAddress: '0xf96d54e490317c557a967abfa5d6e33006be69b3',
  pollCreatorAddress: '0xbf824edb6b94d9b52d972d5b25bcc19b4e6e3f3c',
  provider: process.env.INFURA_ENDPOINT,
  privateKeys: {}, // { [publicKey: string]: privateKey }
  account: '',
  gas: null,
  artifacts: {
    LivepeerToken: LivepeerTokenArtifact,
    LivepeerTokenFaucet: LivepeerTokenFaucetArtifact,
    Controller: ControllerArtifact,
    RoundsManager: RoundsManagerArtifact,
    BondingManager: BondingManagerArtifact,
    Minter: MinterArtifact,
    PollCreator: PollCreatorArtifact,
    Poll: PollArtifact,
  },
  ensRegistries: {
    // Mainnet
    '1': '0x314159265dd8dbb310642f98f50c066173c1259b',
    // Ropsten
    '3': '0x112234455c3a32fd11230c42e7bccd4a84e02010',
    // Rinkeby
    '4': '0xe7410170f87102df0055eb195163a03b7f2bff4a',
  },
}

// Utils
export const utils = {
  isValidAddress: (x) => /^0x[a-fA-F0-9]{40}$/.test(x),
  resolveAddress: async (resolve, x) =>
    utils.isValidAddress(x) ? x : await resolve(x),
  getMethodHash: (item) => {
    // const sig = `${item.name}(${item.inputs.map(x => x.type).join(',')})`
    // const hash = Eth.keccak256(sig)
    // return hash
    return encodeSignature(item)
  },
  findAbiByName: (abis, name) => {
    const [abi] = abis.filter((item) => {
      if (item.type !== 'function') return false
      if (item.name === name) return true
    })
    return abi
  },
  findAbiByHash: (abis, hash) => {
    const [abi] = abis.filter((item) => {
      if (item.type !== 'function') return false
      return encodeSignature(item) === hash
    })
    return abi
  },
  encodeMethodParams: (abi, params) => {
    return encodeMethod(abi, params)
  },
  decodeMethodParams: (abi, bytecode) => {
    return decodeParams(
      abi.inputs.map((x) => x.name),
      abi.inputs.map((x) => x.type),
      `0x${bytecode.substr(10)}`,
      false,
    )
  },
  decodeContractInput: (contracts, contractAddress, input) => {
    for (const key in contracts) {
      const contract = contracts[key]
      if (contract.address !== contractAddress) continue
      const hash = input.substring(0, 10)
      const abi = utils.findAbiByHash(contract.abi, hash)
      return {
        contract: key,
        method: abi.name,
        params: Object.entries(utils.decodeMethodParams(abi, input)).reduce(
          (obj, [k, v]) => {
            return {
              ...obj,
              [k]: Array.isArray(v)
                ? v.map((_v) => (BN.isBN(_v) ? toString(_v) : _v))
                : BN.isBN(v)
                ? toString(v)
                : v,
            }
          },
          {},
        ),
      }
    }
    return { contract: '', method: '', params: {} }
  },
  /**
   * Polls for a transaction receipt
   * @ignore
   * @param {string}   txHash - the transaction hash
   * @param {Eth}      eth    - an instance of Ethjs
   * @return {Object}
   */
  getTxReceipt: async (txHash, eth) => {
    return await new Promise((resolve, reject) => {
      setTimeout(async function pollForReceipt() {
        try {
          const receipt = await eth.getTransactionReceipt(txHash)
          if (receipt) {
            return receipt.status === '0x1'
              ? // success
                resolve(receipt)
              : // fail
                reject(
                  new Error(
                    JSON.stringify(
                      {
                        receipt,
                        transaction: await eth.getTransactionByHash(
                          receipt.transactionHash,
                        ),
                      },
                      null,
                      2,
                    ),
                  ),
                )
          }
          setTimeout(pollForReceipt, 300)
        } catch (err) {
          reject(err)
        }
      }, 0)
    })
  },
  /**
   * Parses an encoded string of transcoding options
   * @ignore
   * @param  {string} opts - transcoding options
   * @return {Object[]}
   */
  parseTranscodingOptions: (opts) => {
    const profiles = Object.values(VIDEO_PROFILES)
    const validHashes = new Set(profiles.map((x) => x.hash))
    let hashes = []
    for (let i = 0; i < opts.length; i += VIDEO_PROFILE_ID_SIZE) {
      const hash = opts.slice(i, i + VIDEO_PROFILE_ID_SIZE)
      if (!validHashes.has(hash)) continue
      hashes.push(hash)
    }
    return hashes.map((x) => profiles.find(({ hash }) => x === hash))
  },
  /**
   * Serializes a list of transcoding profiles name into a hash
   * @ignore
   * @param  {string[]} name - transcoding profile name
   * @return {string}
   */
  serializeTranscodingProfiles: (names) => {
    return [
      ...new Set( // dedupe profiles
        names.map((x) =>
          VIDEO_PROFILES[x]
            ? VIDEO_PROFILES[x].hash
            : VIDEO_PROFILES.P240p30fps4x3.hash,
        ),
      ),
    ].join('')
  },
  /**
   * Pads an address with 0s on the left (for topic encoding)
   * @ignore
   * @param  {string} addr - an ETH address
   * @return {string}
   */
  padAddress: (addr) => ADDRESS_PAD + addr.substr(2),
  /**
   * Encodes an event filter object into a topic list
   * @ignore
   * @param  {Function} event   - a contract event method
   * @param  {Object}   filters - key/value map of indexed event params
   * @return {string[]}
   */
  encodeEventTopics: (event, filters) => {
    return event.abi.inputs.reduce(
      (topics, { indexed, name, type }, i) => {
        if (!indexed) return topics
        if (!filters.hasOwnProperty(name)) return [...topics, null]
        if (type === 'address' && 'string' === typeof filters[name])
          return [...topics, utils.padAddress(filters[name])]
        return [...topics, filters[name]]
      },
      [event().options.defaultFilterObject.topics[0]],
    )
  },
  /**
   * Turns a raw event log into a result object
   * @ignore
   * @param  {Function} event  - a contract event method
   * @param  {string}   data   - bytecode from log
   * @param  {string[]} topics - list of topics for log query
   * @return {Object}
   */
  decodeEvent: (event) => ({ data, topics }) => {
    return decodeEvent(event.abi, data, topics, false)
  },
}

// Helper functions
// ethjs returns a Result type from rpc requests
// these functions help with formatting those values
const { BN } = Eth
const toBN = (n) => (BN.isBN(n) ? n : new BN(n.toString(10), 10))
const compose = (...fns) => fns.reduce((f, g) => (...args) => f(g(...args)))
const prop = (k: string | number) => (x): any => x[k]
const toBool = (x: any): boolean => !!x
const toString = (x: Eth.BN): string => x.toString(10)
const toNumber = (x: Eth.BN): string => Number(x.toString(10))
const headToBool = compose(toBool, prop(0))
const headToString = compose(toString, prop(0))
const headToNumber = compose(toNumber, prop(0))
const invariant = (name, pos, type) => {
  throw new Error(`Missing argument "${name}" (${type}) at position ${pos}`)
}
const formatDuration = (ms) => {
  const seconds = (ms / 1000).toFixed(1)
  const minutes = (ms / (1000 * 60)).toFixed(1)
  const hours = (ms / (1000 * 60 * 60)).toFixed(1)
  const days = (ms / (1000 * 60 * 60 * 24)).toFixed(1)
  if (seconds < 60) return seconds + ' sec'
  else if (minutes < 60) return minutes + ' min'
  else if (hours < 24) return hours + ' hours'
  return days + ' days'
}

/**
 * Deploys contract and return instance at deployed address
 * @ignore
 * @param {*} eth
 * @param {*} args
 */
export async function deployContract(
  eth,
  { abi, bytecode, defaultTx },
): Promise<Contract> {
  const contract = eth.contract(abi, bytecode, defaultTx)
  const txHash = await contract.new()
  const receipt = await eth.getTransactionSuccess(txHash)
  return contract.at(receipt.contractAddress)
}

/**
 * Creates a contract instance from a specific address
 * @ignore
 * @param {Eth}    eth     - ethjs instance
 * @param {string} address -
 * @param {Object} args[0] - an object containing all relevant Livepeer Artifacts
 */
export function getContractAt(
  eth,
  { abi, bytecode, address, defaultTx },
): Contract {
  return eth.contract(abi, bytecode, defaultTx).at(address)
}

/**
 * Creates an instance of Eth and a default transaction object
 * @ignore
 * @return {{ et, gas: Eth, defaultTx: { from: string, gas: number } }}
 */
export async function initRPC({
  account,
  privateKeys,
  gas,
  provider,
}): Promise<{
  eth: Eth,
  defaultTx: { from: string, gas: number },
}> {
  const usePrivateKeys = 0 < Object.keys(privateKeys).length
  const ethjsProvider =
    'object' === typeof provider && provider
      ? provider
      : usePrivateKeys
      ? // Use provider-signer to locally sign transactions
        new SignerProvider(provider, {
          signTransaction: (rawTx, cb) => {
            const tx = new EthereumTx(rawTx)
            tx.sign(privateKeys[from])
            cb(null, '0x' + tx.serialize().toString('hex'))
          },
          accounts: (cb) => cb(null, accounts),
          timeout: 10 * 1000,
        })
      : // Use default signer
        new Eth.HttpProvider(provider || DEFAULTS.provider)
  const eth = new Eth(ethjsProvider)
  const ens = new ENS({
    provider: eth.currentProvider,
    registryAddress: DEFAULTS.ensRegistries[await eth.net_version()],
  })
  const accounts = usePrivateKeys
    ? Object.keys(privateKeys)
    : await eth.accounts()
  const from =
    // select account by address or index
    // default to EMPTY_ADDRESS (read-only; cannot transact)
    new Set(accounts).has(account)
      ? account
      : accounts[account] || EMPTY_ADDRESS
  return {
    eth,
    ens,
    provider,
    accounts,
    defaultTx: {
      from,
      gas,
    },
  }
}

/**
 * Creates instances of all main Livepeer contracts
 * @ignore
 * @param {string} opts.provider  - the httpProvider for contract RPC
 * @param {Object} opts.artifacts - ...
 */
export async function initContracts(
  opts = {},
): Promise<Object<string, Contract>> {
  // Merge pass options with defaults
  const {
    account = DEFAULTS.account,
    artifacts = DEFAULTS.artifacts,
    controllerAddress = DEFAULTS.controllerAddress,
    pollCreatorAddress = DEFAULTS.pollCreatorAddress,
    gas = DEFAULTS.gas,
    privateKeys = DEFAULTS.privateKeys,
    provider = DEFAULTS.provider,
  } = opts
  // Instanstiate new ethjs instance with specified provider
  const { accounts, defaultTx, ens, eth } = await initRPC({
    account,
    gas,
    privateKeys,
    provider,
  })
  const contracts = {
    LivepeerToken: null,
    LivepeerTokenFaucet: null,
    BondingManager: null,
    RoundsManager: null,
    Minter: null,
  }
  const hashes = {
    LivepeerToken: {},
    LivepeerTokenFaucet: {},
    BondingManager: {},
    RoundsManager: {},
    Minter: {},
  }
  // Create a Controller contract instance
  const Controller = await getContractAt(eth, {
    ...artifacts.Controller,
    defaultTx,
    address: controllerAddress,
  })
  // Create a PollCreator contract instance
  const PollCreator = await getContractAt(eth, {
    ...artifacts.PollCreator,
    defaultTx,
    address: pollCreatorAddress,
  })
  const Poll = await getContractAt(eth, {
    ...artifacts.Poll,
    defaultTx,
    address: EMPTY_ADDRESS,
  })
  for (const name of Object.keys(contracts)) {
    // Get contract address from Controller
    const hash = Eth.keccak256(name)
    const address = (await Controller.getContract(hash))[0]
    // Create contract instance
    contracts[name] = await getContractAt(eth, {
      ...artifacts[name],
      defaultTx,
      address,
    })
    for (const item of contracts[name].abi) {
      hashes[name][utils.getMethodHash(item)] = item.name
    }
  }
  // Add the Controller contract to the contracts object
  contracts.Controller = Controller
  // Add the PollCreator contract to the contracts object
  contracts.PollCreator = PollCreator
  // Add the PollCreator contract to the contracts object
  contracts.Poll = Poll

  // Key ABIs by contract name
  const abis = Object.entries(artifacts)
    .map(([k, v]) => ({ [k]: v.abi }))
    .reduce((a, b) => ({ ...a, ...b }), {})
  // Create a list of events in each contract
  const events = Object.entries(abis)
    .map(([contract, abi]) => {
      return abi
        .filter((x) => x.type === 'event')
        .map((abi) => ({
          abi,
          contract,
          event: contracts[contract][abi.name],
          name: abi.name,
        }))
    })
    .reduce(
      (a, b) =>
        b.reduce((events, { name, event, abi, contract }) => {
          event.abi = abi
          event.contract = contract
          return { ...events, [name]: event }
        }, a),
      {},
    )

  return {
    abis,
    accounts,
    contracts,
    defaultTx,
    ens,
    eth,
    events,
    hashes,
  }
}

/**
 * Livepeer SDK main module exports
 * @namespace module~exports
 */

/**
 * Livepeer SDK factory function. Creates an instance of the Livepeer SDK -- an object with useful methods for interacting with Livepeer protocol smart contracts
 * @memberof module~exports
 * @name default
 * @param {LivepeerSDKOptions} opts - SDK configuration options
 * @return {Promise<LivepeerSDK>}
 *
 * @example
 *
 * // Here we're naming the default export "LivepeerSDK"
 * import LivepeerSDK from '@livepeer/sdk'
 *
 * // Call the factory function and await its Promise
 * LivepeerSDK().then(sdk => {
 *   // Your Livepeer SDK instance is now ready to use
 * })
 *
 */
export async function createLivepeerSDK(
  opts: LivepeerSDKOptions,
): Promise<LivepeerSDK> {
  const { ens, events, ...config } = await initContracts(opts)
  const {
    BondingManager,
    Controller,
    LivepeerToken,
    LivepeerTokenFaucet,
    RoundsManager,
    Minter,
    PollCreator,
  } = config.contracts
  const { resolveAddress } = utils

  // Cache
  const cache = {
    // previous log queries are held here to improve perf
  }
  /**
   * "rpc" namespace of a Livepeer SDK instance
   * @namespace livepeer~rpc
   *
   * @example
   *
   * import LivepeerSDK from '@livepeer/sdk'
   *
   * LivepeerSDK().then(({ rpc }) => {
   *   // Here, we're destructuring the sdk to expose only its rpc namespace
   *   // Now, you you are able call rpc.<method-name>()
   *   // All rpc method yield Promises. Their usage is further explained below.
   * })
   *
   */
  const rpc = {
    /**
     * Gets the ENS name for an address. This is known as a reverse lookup.
     * Unfortunately, users must explicitly set their own resolver.
     * So most of the time, this method just returns an empty string
     * More info here:
     * (https://docs.ens.domains/en/latest/userguide.html#reverse-name-resolution)
     * @memberof livepeer~rpc
     * @param {string} address - address to look up an ENS name for
     * @return {Promise<string>}
     *
     * @example
     *
     * await rpc.getENSName('0xd34db33f...')
     * // => string
     */
    async getENSName(address: string): Promise<string> {
      try {
        return await ens.reverse(address)
      } catch (err) {
        // custom networks or unavailable resolvers can cause failure
        if (err.message !== 'ENS name not defined.') {
          console.warn(
            `Could not get ENS name for address "${address}":`,
            err.message,
          )
        }
        // if there's no name, we can just resolve an empty string
        return ''
      }
    },

    /**
     * Gets the address for an ENS name
     * @memberof livepeer~rpc
     * @param {string} name - ENS name to look up an address for
     * @return {Promise<string>}
     *
     * @example
     *
     * await rpc.getENSAddress('vitalik.eth')
     * // => string
     */
    async getENSAddress(name: string): Promise<string> {
      try {
        return await ens.lookup(name)
      } catch (err) {
        // custom networks or unavailable resolvers can cause failure
        if (err.message !== 'ENS name not defined.') {
          console.warn(
            `Could not get address for ENS name "${name}":`,
            err.message,
          )
        }
        // if there's no name, we can just resolve an empty string
        return ''
      }
    },

    /**
     * Gets a block by number, hash, or keyword ('earliest' | 'latest')
     * @memberof livepeer~rpc
     * @param {string} block - Number of block to get
     *
     * @example
     *
     * await rpc.getBlock('latest')
     * // => {
     *   "number": string,
     *   "hash": string,
     *   "parentHash": string,
     *   "nonce": string,
     *   "sha3Uncles": string,
     *   "logsBloom": string,
     *   "transactionsRoot": string,
     *   "stateRoot": string,
     *   "receiptsRoot": string,
     *   "miner": string,
     *   "mixHash": string,
     *   "difficulty": string,
     *   "totalDifficulty": string,
     *   "extraData": string,
     *   "size": string,
     *   "gasLimit": string,
     *   "gasUsed": string,
     *   "timestamp": number,
     *   "transactions": Array<Transaction>,
     *   "transactionsRoot": string,
     *   "uncles": Array<Uncle>,
     * }
     */
    async getBlock(id: string): Promise<Block> {
      const block = id.toString().startsWith('0x')
        ? await config.eth.getBlockByHash(id, true)
        : await config.eth.getBlockByNumber(id, true)
      return {
        ...block,
        difficulty: toString(block.difficulty),
        gasLimit: toString(block.gasLimit),
        gasUsed: toString(block.gasUsed),
        number: toString(block.number),
        size: toString(block.size),
        timestamp: Number(toString(block.timestamp)),
        totalDifficulty: toString(block.totalDifficulty),
      }
    },

    /**
     * Gets the ETH balance for an account
     * @memberof livepeer~rpc
     * @param {string} addr - ETH account address
     * @return {Promise<string>}
     *
     * @example
     *
     * await rpc.getEthBalance('0xf00...')
     * // => string
     *
     */
    async getEthBalance(addr: string): Promise<string> {
      return toString(
        await config.eth.getBalance(
          await resolveAddress(rpc.getENSAddress, addr),
        ),
      )
    },

    /**
     * Gets the unbonding period for transcoders
     * @memberof livepeer~rpc
     * @return {Promise<string>}
     *
     * @example
     *
     * await rpc.getUnbondingPeriod()
     * // => string
     */
    async getUnbondingPeriod(): Promise<string> {
      return headToString(await BondingManager.unbondingPeriod())
    },

    /**
     * Gets the number of active transcoders
     * @memberof livepeer~rpc
     * @return {Promise<string>}
     *
     * @example
     *
     * await rpc.getNumActiveTranscoders()
     * // => string
     */
    async getNumActiveTranscoders(): Promise<string> {
      return headToString(await BondingManager.numActiveTranscoders())
    },

    /**
     * Gets the maximum earnings for claims rounds
     * @memberof livepeer~rpc
     * @return {Promise<string>}
     *
     * @example
     *
     * await rpc.getMaxEarningsClaimsRounds()
     * // => string
     */
    async getMaxEarningsClaimsRounds(): Promise<string> {
      return headToString(await BondingManager.maxEarningsClaimsRounds())
    },

    /**
     * Gets the total amount of bonded tokens
     * @memberof livepeer~rpc
     * @return {Promise<string}
     *
     * @example
     *
     * await rpc.getTotalBonded()
     * // => string
     */
    async getTotalBonded(): Promise<string> {
      return headToString(await BondingManager.getTotalBonded())
    },

    /**
     * Gets the total supply of token (LTPU) available in the protocol
     * @memberof livepeer~rpc
     * @return {Promise<string>}
     *
     * @example
     *
     * await rpc.getTokenTotalSupply()
     * // => string
     */
    async getTokenTotalSupply(): Promise<string> {
      return headToString(await LivepeerToken.totalSupply())
    },

    /**
     * Gets a user's token balance (LPTU)
     * @memberof livepeer~rpc
     * @param  {string} addr - user's ETH address
     * @return {Promise<string>}
     *
     * @example
     *
     * await rpc.getTokenBalance('0xf00...')
     * // => string
     */
    async getTokenBalance(addr: string): Promise<string> {
      return headToString(
        await LivepeerToken.balanceOf(
          await resolveAddress(rpc.getENSAddress, addr),
        ),
      )
    },

    /**
     * Gets general information about tokens
     * @memberof livepeer~rpc
     * @param  {string} addr - user's ETH address
     * @return {Promise<TokenInfo>}
     *
     * @example
     *
     * await rpc.getTokenInfo()
     * // => TokenInfo { totalSupply: string, balance: string }
     */
    async getTokenInfo(addr: string): Promise<TokenInfo> {
      return {
        totalSupply: await rpc.getTokenTotalSupply(),
        balance: await rpc.getTokenBalance(
          await resolveAddress(rpc.getENSAddress, addr),
        ),
      }
    },

    /**
     * Transfers tokens (LPTU) from one account to another
     * @memberof livepeer~rpc
     * @param {string} to - the account ETH address to send tokens to
     * @param {string} amount - the amount of token to send (LPTU)
     * @param {TxConfig} [tx = config.defaultTx] - an object specifying the `from` and `gas` values of the transaction
     * @return {Promise<TxReceipt>}
     *
     * @example
     *
     * await rpc.transferToken('0xf00...', '10')
     * // => TxReceipt {
     * //   transactionHash: string,
     * //   transactionIndex": BN,
     * //   blockHash: string,
     * //   blockNumber: BN,
     * //   cumulativeGasUsed: BN,
     * //   gasUsed: BN,
     * //   contractAddress: string,
     * //   logs: Array<Log {
     * //     logIndex: BN,
     * //     blockNumber: BN,
     * //     blockHash: string,
     * //     transactionHash: string,
     * //     transactionIndex: string,
     * //     address: string,
     * //     data: string,
     * //     topics: Array<string>
     * //   }>
     * // }
     */
    async transferToken(
      to: string,
      amount: string,
      tx = config.defaultTx,
    ): Promise<TxReceipt> {
      const value = toBN(amount)
      // make sure balance is higher than transfer
      const balance = (await LivepeerToken.balanceOf(tx.from))[0]
      if (!balance.gte(value)) {
        throw new Error(
          `Cannot transfer ${toString(
            value,
          )} LPT because is it greater than your current balance (${balance} LPT).`,
        )
      }

      return await utils.getTxReceipt(
        await LivepeerToken.transfer(
          await resolveAddress(rpc.getENSAddress, to),
          value,
          tx,
        ),
        config.eth,
      )
    },

    /**
     * The amount of LPT the faucet distributes when tapped
     * @memberof livepeer~rpc
     * @return {Promise<string>}
     *
     * @example
     *
     * await rpc.getFaucetAmount()
     * // => string
     */
    async getFaucetAmount(): Promise<string> {
      return headToString(await LivepeerTokenFaucet.requestAmount())
    },

    /**
     * How often an address can tap the faucet (in hours)
     * @memberof livepeer~rpc
     * @return {Promise<string>}
     *
     * @example
     *
     * await rpc.getFaucetWait()
     * // => string
     */
    async getFaucetWait(): Promise<string> {
      return headToString(await LivepeerTokenFaucet.requestWait())
    },

    /**
     * Next timestamp at which the given address will be allowed to tap the faucet
     * @memberof livepeer~rpc
     * @param  {string} addr - user's ETH address
     * @return {Promise<string>}
     *
     * @example
     *
     * await rpc.getFaucetNext()
     * // => string
     */
    async getFaucetNext(addr: string): Promise<string> {
      return headToString(
        await LivepeerTokenFaucet.nextValidRequest(
          await resolveAddress(rpc.getENSAddress, addr),
        ),
      )
    },

    /**
     * Info about the state of the LPT faucet
     * @memberof livepeer~rpc
     * @param  {string} addr - user's ETH address
     * @return {Promise<FaucetInfo>}
     *
     * @example
     *
     * await rpc.getFaucetInfo('0xf00...')
     * // => FaucetInfo {
     * //   amount: string,
     * //   wait: string,
     * //   next: string,
     * // }
     */
    async getFaucetInfo(addr: string): Promise<FaucetInfo> {
      return {
        amount: await rpc.getFaucetAmount(),
        wait: await rpc.getFaucetWait(),
        next: await rpc.getFaucetNext(
          await resolveAddress(rpc.getENSAddress, addr),
        ),
      }
    },

    /**
     * Gets the per round inflation rate
     * @memberof livepeer~rpc
     * @return {Promise<string>}
     *
     * @example
     *
     * await rpc.getInflation()
     * // => string
     */
    async getInflation(): Promise<string> {
      return headToString(await Minter.inflation())
    },

    /**
     * Gets the change in inflation rate per round until the target bonding rate is achieved
     * @memberof livepeer~rpc
     * @return {Promise<string>}
     *
     * @example
     *
     * await rpc.getInflationChange()
     * // => string
     */
    async getInflationChange(): Promise<string> {
      return headToString(await Minter.inflationChange())
    },

    /**
     * The delegator status of the given address
     * @memberof livepeer~rpc
     * @param  {string} addr - user's ETH address
     * @return {Promise<string>}
     *
     * @example
     *
     * await rpc.getDelegatorStatus('0xf00...')
     * // => 'Pending' | 'Bonded' | 'Unbonded'
     */
    async getDelegatorStatus(addr: string): Promise<string> {
      const status = headToString(
        await BondingManager.delegatorStatus(
          await resolveAddress(rpc.getENSAddress, addr),
        ),
      )
      return DELEGATOR_STATUS[status]
    },

    /**
     * General info about a delegator
     * @memberof livepeer~rpc
     * @param  {string} addr - user's ETH address
     * @return {Promise<Delegator>}
     *
     * @example
     *
     * await rpc.getDelegator('0xf00...')
     * // => Delegator {
     * //   allowance: string,
     * //   address: string,
     * //   bondedAmount: string,
     * //   delegateAddress: string,
     * //   delegateAmount: string,
     * //   fees: string,
     * //   lastClaimRound: string,
     * //   pendingFees: string,
     * //   pendingStake: string,
     * //   startRound: string,
     * //   status: 'Pending' | 'Bonded' | 'Unbonding' | 'Unbonded',
     * //   withdrawRound: string,
     * //   nextUnbondingLockId: string,
     * // }
     */
    async getDelegator(addr: string): Promise<Delegator> {
      const address = await resolveAddress(rpc.getENSAddress, addr)
      const allowance = headToString(
        await LivepeerToken.allowance(address, BondingManager.address),
      )
      const pollCreatorAllowance = headToString(
        await LivepeerToken.allowance(address, PollCreator.address),
      )
      const currentRound = await rpc.getCurrentRound()
      const pendingStake = headToString(
        await BondingManager.pendingStake(address, currentRound),
      )
      const pendingFees = headToString(
        await BondingManager.pendingFees(address, currentRound),
      )
      const d = await BondingManager.getDelegator(address)
      const bondedAmount = toString(d.bondedAmount)
      const fees = toString(d.fees)
      const delegateAddress =
        d.delegateAddress === EMPTY_ADDRESS ? '' : d.delegateAddress
      const delegatedAmount = toString(d.delegatedAmount)
      const lastClaimRound = toString(d.lastClaimRound)
      const startRound = toString(d.startRound)
      const nextUnbondingLockId = toString(d.nextUnbondingLockId)

      let unbondingLockId = toBN(nextUnbondingLockId)
      if (unbondingLockId.cmp(new BN(0)) > 0) {
        unbondingLockId = unbondingLockId.sub(new BN(1))
      }
      const {
        amount: withdrawAmount,
        withdrawRound,
      } = await rpc.getDelegatorUnbondingLock(
        address,
        toString(unbondingLockId),
      )
      const status =
        withdrawRound !== '0' && toBN(currentRound).cmp(toBN(withdrawRound)) < 0
          ? DELEGATOR_STATUS.Unbonding
          : await rpc.getDelegatorStatus(address)

      return {
        address,
        allowance,
        pollCreatorAllowance,
        bondedAmount,
        delegateAddress,
        delegatedAmount,
        fees,
        lastClaimRound,
        pendingFees,
        pendingStake,
        startRound,
        status,
        withdrawRound,
        withdrawAmount,
        nextUnbondingLockId,
      }
    },

    /**
     * Get all the unbonding locks for a delegator
     * @param {string} addr - delegator's ETH address
     * @return {Promise<Array<UnbondingLock>>}
     *
     * @example
     *
     * await rpc.getDelegatorUnbondingLocks('0xf00...')
     * // => UnbondingLock [{
     * //   id: string,
     * //   delegator: string,
     * //   amount: string,
     * //   withdrawRound: string
     * // }]
     */
    async getDelegatorUnbondingLocks(
      addr: string,
    ): Promise<Array<UnbondingLock>> {
      let { nextUnbondingLockId } = await rpc.getDelegator(addr)

      let unbondingLockId = toNumber(nextUnbondingLockId)
      if (unbondingLockId > 0) {
        unbondingLockId -= 1
      }

      let result = []

      while (unbondingLockId >= 0) {
        const unbond = await rpc.getDelegatorUnbondingLock(
          addr,
          toString(unbondingLockId),
        )
        result.push(unbond)
        unbondingLockId -= 1
      }

      return result
    },

    /**
     * Get an unbonding lock for a delegator
     * @param {string} addr - delegator's ETH address
     * @param {string} unbondingLockId - unbonding lock ID
     *
     * @example
     *
     * await rpc.getDelegatorUnbondingLock('0xf00...', 1)
     * // => UnbondingLock {
     * //   id: string,
     * //   delegator: string,
     * //   amount: string,
     * //   withdrawRound: string
     * // }
     */
    async getDelegatorUnbondingLock(
      addr: string,
      unbondingLockId: string,
    ): Promise<UnbondingLock> {
      const lock = await BondingManager.getDelegatorUnbondingLock(
        addr,
        unbondingLockId,
      )
      const amount = toString(lock.amount)
      const withdrawRound = toString(lock.withdrawRound)
      return {
        id: unbondingLockId,
        delegator: addr,
        amount,
        withdrawRound,
      }
    },

    /**
     * Rebonds LPT from an address
     * @memberof livepeer~rpc
     * @param {number} unbondingLockId
     * @param {TxConfig} [tx = config.defaultTx] - an object specifying the `from` and `gas` values of the transaction
     * @return {Promise<TxReceipt>}
     *
     * @example
     *
     * await rpc.rebond(0)
     * // => TxReceipt {
     * //   transactionHash: string,
     * //   transactionIndex": BN,
     * //   blockHash: string,
     * //   blockNumber: BN,
     * //   cumulativeGasUsed: BN,
     * //   gasUsed: BN,
     * //   contractAddress: string,
     * //   logs: Array<Log {
     * //     logIndex: BN,
     * //     blockNumber: BN,
     * //     blockHash: string,
     * //     transactionHash: string,
     * //     transactionIndex: string,
     * //     address: string,
     * //     data: string,
     * //     topics: Array<string>
     * //   }>
     * // }
     */
    async rebond(
      unbondingLockId: number,
      tx = config.defaultTx,
    ): Promise<TxReceipt> {
      const txHash = await BondingManager.rebond(unbondingLockId, {
        ...config.defaultTx,
        ...tx,
      })
      if (tx.returnTxHash) {
        return txHash
      }

      return await utils.getTxReceipt(txHash, config.eth)
    },

    /**
     * Rebonds LPT from an address with hint
     * @memberof livepeer~rpc
     * @param {number} unbondingLockId
     * @param {string} newPosPrev
     * @param {string} newPosNext
     * @param {TxConfig} [tx = config.defaultTx] - an object specifying the `from` and `gas` values of the transaction
     * @return {Promise<TxReceipt>}
     *
     * @example
     *
     * await rpc.rebondWithHint(0, "0x", "0x")
     * // => TxReceipt {
     * //   transactionHash: string,
     * //   transactionIndex": BN,
     * //   blockHash: string,
     * //   blockNumber: BN,
     * //   cumulativeGasUsed: BN,
     * //   gasUsed: BN,
     * //   contractAddress: string,
     * //   logs: Array<Log {
     * //     logIndex: BN,
     * //     blockNumber: BN,
     * //     blockHash: string,
     * //     transactionHash: string,
     * //     transactionIndex: string,
     * //     address: string,
     * //     data: string,
     * //     topics: Array<string>
     * //   }>
     * // }
     */
    async rebondWithHint(
      unbondingLockId: number,
      newPosPrev: string,
      newPosNext: string,
      tx: TxObject,
    ): Promise<TxReceipt> {
      const txHash = await BondingManager.rebondWithHint(
        unbondingLockId,
        newPosPrev,
        newPosNext,
        {
          ...config.defaultTx,
          ...tx,
        },
      )
      if (tx.returnTxHash) {
        return txHash
      }

      return await utils.getTxReceipt(txHash, config.eth)
    },

    /**
     * Rebonds LPT from an address
     * @memberof livepeer~rpc
     * @param {string} to
     * @param {number} unbondingLockId
     * @param {TxConfig} [tx = config.defaultTx] - an object specifying the `from` and `gas` values of the transaction
     * @return {Promise<TxReceipt>}
     *
     * @example
     *
     * await rpc.rebondFromUnbonded("0x", 1)
     * // => TxReceipt {
     * //   transactionHash: string,
     * //   transactionIndex": BN,
     * //   blockHash: string,
     * //   blockNumber: BN,
     * //   cumulativeGasUsed: BN,
     * //   gasUsed: BN,
     * //   contractAddress: string,
     * //   logs: Array<Log {
     * //     logIndex: BN,
     * //     blockNumber: BN,
     * //     blockHash: string,
     * //     transactionHash: string,
     * //     transactionIndex: string,
     * //     address: string,
     * //     data: string,
     * //     topics: Array<string>
     * //   }>
     * // }
     */
    async rebondFromUnbonded(
      to: string,
      unbondingLockId: number,
      tx = config.defaultTx,
    ): Promise<TxReceipt> {
      const txHash = await BondingManager.rebondFromUnbonded(
        to,
        unbondingLockId,
        {
          ...config.defaultTx,
          ...tx,
        },
      )

      if (tx.returnTxHash) {
        return txHash
      }

      return await utils.getTxReceipt(txHash, config.eth)
    },

    /**
     * Rebonds LPT from an address with hint
     * @memberof livepeer~rpc
     * @param {string} to
     * @param {number} unbondingLockId
     * @param {string} newPosPrev
     * @param {string} newPosNext
     * @param {TxConfig} [tx = config.defaultTx] - an object specifying the `from` and `gas` values of the transaction
     * @return {Promise<TxReceipt>}
     *
     * @example
     *
     * await rpc.rebondFromUnbondedWithHint("0x", 1, "0x", "0x")
     * // => TxReceipt {
     * //   transactionHash: string,
     * //   transactionIndex": BN,
     * //   blockHash: string,
     * //   blockNumber: BN,
     * //   cumulativeGasUsed: BN,
     * //   gasUsed: BN,
     * //   contractAddress: string,
     * //   logs: Array<Log {
     * //     logIndex: BN,
     * //     blockNumber: BN,
     * //     blockHash: string,
     * //     transactionHash: string,
     * //     transactionIndex: string,
     * //     address: string,
     * //     data: string,
     * //     topics: Array<string>
     * //   }>
     * // }
     */
    async rebondFromUnbondedWithHint(
      to: string,
      unbondingLockId: number,
      newPosPrev: string,
      newPosNext: string,
      tx = config.defaultTx,
    ): Promise<TxReceipt> {
      const txHash = await BondingManager.rebondFromUnbondedWithHint(
        to,
        unbondingLockId,
        newPosPrev,
        newPosNext,
        {
          ...config.defaultTx,
          ...tx,
        },
      )

      if (tx.returnTxHash) {
        return txHash
      }

      return await utils.getTxReceipt(txHash, config.eth)
    },

    /**
     * Get a delegator's pending stake
     * @memberof livepeer~rpc
     * @param {string} addr - user's ETH address
     * @param {string} endRound The last round to compute pending stake from
     * @return {Promise<string>}
     *
     * @example
     *
     * await rpc.getPendingStake('0xf00...')
     * // => string
     */
    async getPendingStake(addr: string, endRound: string): Promise<string> {
      try {
        const address = await resolveAddress(rpc.getENSAddress, addr)
        if (!endRound) {
          const currentRound = await rpc.getCurrentRound()
          return headToString(
            await BondingManager.pendingStake(address, currentRound),
          )
        }
        return headToString(
          await BondingManager.pendingStake(address, endRound),
        )
      } catch (err) {
        err.message = 'Error: getPendingStake\n' + err.message
        throw err
      }
    },

    /**
     * Get a delegator's pending fees
     * @memberof livepeer~rpc
     * @param  {string} addr - user's ETH address
     * @param  {string} endRound The last round to compute pending fees from
     * @return {Promise<string>}
     *
     * @example
     *
     * await rpc.getPendingFees('0xf00...')
     * // => string
     */
    async getPendingFees(addr: string, endRound: string): Promise<string> {
      try {
        const address = await resolveAddress(rpc.getENSAddress, addr)
        if (!endRound) {
          const currentRound = await rpc.getCurrentRound()
          return headToString(
            await BondingManager.pendingFees(address, currentRound),
          )
        }
        return headToString(await BondingManager.pendingFees(address, endRound))
      } catch (err) {
        err.message = 'Error: getPendingFees\n' + err.message
        throw err
      }
    },

    /**
     * Whether or not the transcoder is active
     * @memberof livepeer~rpc
     * @param  {string} addr - user's ETH address
     * @return {Promise<boolean>}
     *
     * @example
     *
     * await rpc.getTranscoderIsActive('0xf00...')
     * // => boolean
     */
    async getTranscoderIsActive(addr: string): Promise<boolean> {
      return headToBool(
        await BondingManager.isActiveTranscoder(
          await resolveAddress(rpc.getENSAddress, addr),
        ),
      )
    },

    /**
     * Gets the status of a transcoder
     * @memberof livepeer~rpc
     * @param  {string} addr - user's ETH address
     * @return {Promise<string>}
     *
     * @example
     *
     * await rpc.getTranscoderStatus('0xf00...')
     * // => 'NotRegistered' | 'Registered'
     */
    async getTranscoderStatus(addr: string): Promise<string> {
      const status = headToString(
        await BondingManager.transcoderStatus(
          await resolveAddress(rpc.getENSAddress, addr),
        ),
      )
      return TRANSCODER_STATUS[status]
    },

    /**
     * Gets a transcoder's total stake
     * @memberof livepeer~rpc
     * @param  {string} addr - user's ETH address
     * @return {Promise<string>}
     *
     * @example
     *
     * await rpc.getTranscoderTotalStake('0xf00...')
     * // => string
     */
    async getTranscoderTotalStake(addr: string): Promise<string> {
      return headToString(
        await BondingManager.transcoderTotalStake(
          await resolveAddress(rpc.getENSAddress, addr),
        ),
      )
    },

    /**
     * Gets a transcoder's pool max size
     * @memberof livepeer~rpc
     * @return {Promise<string>}
     *
     * @example
     *
     * await rpc.getTranscoderPoolMaxSize()
     * // => string
     */
    async getTranscoderPoolMaxSize(): Promise<string> {
      return headToString(await BondingManager.getTranscoderPoolMaxSize())
    },

    /**
     * Gets info about a transcoder
     * @memberof livepeer~rpc
     * @param  {string} addr - user's ETH address
     * @return {Promise<Transcoder>}
     *
     * @example
     *
     * await rpc.getTranscoder('0xf00...')
     * // => Transcoder {
     * //   active: boolean,
     * //   address: string,
     * //   rewardCut: string,
     * //   feeShare: string,
     * //   lastRewardRound: string,
     * //   pendingRewardCut string,
     * //   pendingFeeShare: string,
     * //   pendingPricePerSegment: string,
     * //   pricePerSegment: string,
     * //   status: 'NotRegistered' | 'Registered',
     * //   totalStake: string,
     * // }
     */
    async getTranscoder(addr: string): Promise<Transcoder> {
      const address = await resolveAddress(rpc.getENSAddress, addr)
      const totalStake = await rpc.getTranscoderTotalStake(address)
      const t = await BondingManager.getTranscoder(address)
      const feeShare = toString(t.feeShare)
      const lastRewardRound = toString(t.lastRewardRound)
      const rewardCut = toString(t.rewardCut)
      const activationRound = toString(t.activationRound)
      const deactivationRound = toString(t.deactivationRound)
      const lastActiveStakeUpdateRound = toString(t.lastActiveStakeUpdateRound)
      return {
        address,
        feeShare,
        lastRewardRound,
        activationRound,
        deactivationRound,
        rewardCut,
        totalStake,
        lastActiveStakeUpdateRound,
      }
    },

    /**
     * Gets transcoders
     * @memberof livepeer~rpc
     * @return {Array<Transcoder>}
     *
     * @example
     *
     * await rpc.getTranscoders()
     * // => Array<Transcoder>
     */
    async getTranscoders(): Promise<Array<Transcoder>> {
      const transcoders = []
      let addr = headToString(await BondingManager.getFirstTranscoderInPool())
      while (addr !== EMPTY_ADDRESS) {
        const transcoder = await rpc.getTranscoder(addr)
        transcoders.push(transcoder)
        addr = headToString(await BondingManager.getNextTranscoderInPool(addr))
      }
      return transcoders
    },

    /**
     * Whether the protocol is paused
     * @memberof livepeer~rpc
     * @return {Promise<boolean>}
     *
     * @example
     *
     * await rpc.getProtocolPaused()
     * // => boolean
     */
    async getProtocolPaused(): Promise<Protocol> {
      return headToBool(await Controller.paused())
    },

    /**
     * Gets the protocol
     * @memberof livepeer~rpc
     * @return {Promise<Protocol>}
     *
     * @example
     *
     * await rpc.getProtocol()
     * // => Protocol {
        paused
        totalTokenSupply
        totalBondedToken
        targetBondingRate
        transcoderPoolMaxSize
        maxEarningsClaimsRounds
     }
     */
    async getProtocol(): Promise<Protocol> {
      const paused = await rpc.getProtocolPaused()
      const totalTokenSupply = await rpc.getTokenTotalSupply()
      const totalBondedToken = await rpc.getTotalBonded()
      const targetBondingRate = await rpc.getTargetBondingRate()
      const transcoderPoolMaxSize = await rpc.getTranscoderPoolMaxSize()
      const maxEarningsClaimsRounds = await rpc.getMaxEarningsClaimsRounds()
      return {
        paused,
        totalTokenSupply,
        totalBondedToken,
        targetBondingRate,
        transcoderPoolMaxSize,
        maxEarningsClaimsRounds,
      }
    },

    /**
     * Gets the length of a round (in blocks)
     * @memberof livepeer~rpc
     * @return {Promise<string>}
     *
     * @example
     *
     * await rpc.getRoundLength()
     * // => string
     */
    async getRoundLength(): Promise<string> {
      return headToString(await RoundsManager.roundLength())
    },

    /**
     * Gets the estimated number of rounds per year
     * @memberof livepeer~rpc
     * @return {Promise<string>}
     *
     * @example
     *
     * await rpc.getRoundsPerYear()
     * // => string
     */
    async getRoundsPerYear(): Promise<string> {
      return headToString(await RoundsManager.roundsPerYear())
    },

    /**
     * Gets the number of the current round
     * @memberof livepeer~rpc
     * @return {Promise<string>}
     *
     * @example
     *
     * await rpc.getCurrentRound()
     * // => string
     */
    async getCurrentRound(): Promise<string> {
      return headToString(await RoundsManager.currentRound())
    },

    /**
     * Whether or not the current round is initalized
     * @memberof livepeer~rpc
     * @return {Promise<boolean>}
     *
     * @example
     *
     * await rpc.getCurrentRoundIsInitialized()
     * // => boolean
     */
    async getCurrentRoundIsInitialized(): Promise<boolean> {
      return headToBool(await RoundsManager.currentRoundInitialized())
    },

    /**
     * The block at which the current round started
     * @memberof livepeer~rpc
     * @return {Promise<string>}
     *
     * @example
     *
     * await rpc.getCurrentRoundStartBlock()
     * // => string
     */
    async getCurrentRoundStartBlock(): Promise<string> {
      return headToString(await RoundsManager.currentRoundStartBlock())
    },

    /**
     * The previously intitialized round
     * @memberof livepeer~rpc
     * @return {Promise<string>}
     *
     * @example
     *
     * await rpc.getLastInitializedRound()
     * // => string
     */
    async getLastInitializedRound(): Promise<string> {
      return headToString(await RoundsManager.lastInitializedRound())
    },

    /**
     * Gets general information about the rounds in the protocol
     * @memberof livepeer~rpc
     * @return {Promise<RoundInfo>}
     *
     * @example
     *
     * await rpc.getCurrentRoundInfo()
     * // => RoundInfo {
     * //   id: string,
     * //   initialized: boolean,
     * //   startBlock: string,
     * //   lastInitializedRound: string,
     * //   length: string,
     * // }
     */
    async getCurrentRoundInfo(): Promise<RoundInfo> {
      const length = await rpc.getRoundLength()
      const id = await rpc.getCurrentRound()
      const initialized = await rpc.getCurrentRoundIsInitialized()
      const lastInitializedRound = await rpc.getLastInitializedRound()
      const startBlock = await rpc.getCurrentRoundStartBlock()
      return {
        id,
        initialized,
        lastInitializedRound,
        length,
        startBlock,
      }
    },

    /**
     * Gets LPT from the faucet
     * @memberof livepeer~rpc
     * @param {TxConfig} [tx = config.defaultTx] - an object specifying the `from` and `gas` values of the transaction
     * @return {Promise<TxReceipt>}
     *
     * @example
     *
     * await rpc.tapFaucet('1337')
     * // => TxReceipt {
     * //   transactionHash: string,
     * //   transactionIndex": BN,
     * //   blockHash: string,
     * //   blockNumber: BN,
     * //   cumulativeGasUsed: BN,
     * //   gasUsed: BN,
     * //   contractAddress: string,
     * //   logs: Array<Log {
     * //     logIndex: BN,
     * //     blockNumber: BN,
     * //     blockHash: string,
     * //     transactionHash: string,
     * //     transactionIndex: string,
     * //     address: string,
     * //     data: string,
     * //     topics: Array<string>
     * //   }>
     * // }
     */
    async tapFaucet(tx = config.defaultTx): Promise<TxReceipt> {
      // const ms = await rpc.getFaucetTapIn(tx.from)
      // if (ms > 0)
      //   throw new Error(
      //     `Can't tap the faucet right now. Your next tap is in ${formatDuration(
      //       ms,
      //     )}.`,
      //   )
      // tap the faucet
      return await utils.getTxReceipt(
        await LivepeerTokenFaucet.request(tx),
        config.eth,
      )
    },

    /**
     * Initializes the round
     * @memberof livepeer~rpc
     * @param {TxConfig} [tx = config.defaultTx] - an object specifying the `from` and `gas` values of the transaction
     * @return {Promise<TxReceipt>}
     *
     * @example
     *
     * await rpc.initializeRound()
     * // => TxReceipt {
     * //   transactionHash: string,
     * //   transactionIndex": BN,
     * //   blockHash: string,
     * //   blockNumber: BN,
     * //   cumulativeGasUsed: BN,
     * //   gasUsed: BN,
     * //   contractAddress: string,
     * //   logs: Array<Log {
     * //     logIndex: BN,
     * //     blockNumber: BN,
     * //     blockHash: string,
     * //     transactionHash: string,
     * //     transactionIndex: string,
     * //     address: string,
     * //     data: string,
     * //     topics: Array<string>
     * //   }>
     * // }
     */
    async initializeRound(tx = config.defaultTx): Promise<TxReceipt> {
      try {
        const txHash = await RoundsManager.initializeRound(tx)
        if (tx.returnTxHash) {
          return txHash
        }
        return await utils.getTxReceipt(txHash, config.eth)
      } catch (err) {
        err.message = 'Error: initializeRound\n' + err.message
        throw err
      }
    },

    async approveTokenPollCreationCost(
      amount: string,
      tx: TxObject,
    ): Promise<TxReceipt> {
      const token = toBN(amount)
      const txHash = await LivepeerToken.approve(PollCreator.address, token, {
        ...config.defaultTx,
        ...tx,
      })
      if (tx.returnTxHash) {
        return txHash
      }

      return await utils.getTxReceipt(txHash, config.eth)
    },

    /**
     * Creates a poll
     * @memberof livepeer~rpc
     * @param {string} proposal - The IPFS multihash for the proposal
     * @param {TxConfig} [tx = config.defaultTx] - an object specifying the `from` and `gas` values of the transaction
     * @return {Promise<TxReceipt>}
     *
     * @example
     *
     * await rpc.createPoll('Qm...')
     * // => TxReceipt {
     * //   transactionHash: string,
     * //   transactionIndex": BN,
     * //   blockHash: string,
     * //   blockNumber: BN,
     * //   cumulativeGasUsed: BN,
     * //   gasUsed: BN,
     * //   contractAddress: string,
     * //   logs: Array<Log {
     * //     logIndex: BN,
     * //     blockNumber: BN,
     * //     blockHash: string,
     * //     transactionHash: string,
     * //     transactionIndex: string,
     * //     address: string,
     * //     data: string,
     * //     topics: Array<string>
     * //   }>
     * // }
     */
    async createPoll(proposal, tx = config.defaultTx): Promise<TxReceipt> {
      try {
        const txHash = await PollCreator.createPoll(proposal, {
          ...config.defaultTx,
          ...tx,
        })
        if (tx.returnTxHash) {
          return txHash
        }
        return await utils.getTxReceipt(txHash, config.eth)
      } catch (err) {
        err.message = 'Error: createPoll\n' + err.message
        throw err
      }
    },

    /**
     * Get PollCreator transfer allowance
     * @memberof livepeer~rpc
     * @param  {string} addr - user's ETH address
     * @param {TxConfig} [tx = config.defaultTx] - an object specifying the `from` and `gas` values of the transaction
     * @return {Promise<TxReceipt>}
     *
     * @example
     *
     * await rpc.getPollCreatorAllowance('0x...')
     * // => TxReceipt {
     * //   transactionHash: string,
     * //   transactionIndex": BN,
     * //   blockHash: string,
     * //   blockNumber: BN,
     * //   cumulativeGasUsed: BN,
     * //   gasUsed: BN,
     * //   contractAddress: string,
     * //   logs: Array<Log {
     * //     logIndex: BN,
     * //     blockNumber: BN,
     * //     blockHash: string,
     * //     transactionHash: string,
     * //     transactionIndex: string,
     * //     address: string,
     * //     data: string,
     * //     topics: Array<string>
     * //   }>
     * // }
     */
    async getPollCreatorAllowance(addr): Promise<TxReceipt> {
      try {
        const address = await resolveAddress(rpc.getENSAddress, addr)
        return headToString(
          await LivepeerToken.allowance(address, PollCreator.address),
        )
      } catch (err) {
        err.message = 'Error: getPollCreatorAllowance\n' + err.message
        throw err
      }
    },

    /**
     * Get BondingManager transfer allowance
     * @memberof livepeer~rpc
     * @param  {string} addr - user's ETH address
     * @param {TxConfig} [tx = config.defaultTx] - an object specifying the `from` and `gas` values of the transaction
     * @return {Promise<TxReceipt>}
     *
     * @example
     *
     * await rpc.getBondingManagerAllowance('0x...')
     * // => TxReceipt {
     * //   transactionHash: string,
     * //   transactionIndex": BN,
     * //   blockHash: string,
     * //   blockNumber: BN,
     * //   cumulativeGasUsed: BN,
     * //   gasUsed: BN,
     * //   contractAddress: string,
     * //   logs: Array<Log {
     * //     logIndex: BN,
     * //     blockNumber: BN,
     * //     blockHash: string,
     * //     transactionHash: string,
     * //     transactionIndex: string,
     * //     address: string,
     * //     data: string,
     * //     topics: Array<string>
     * //   }>
     * // }
     */
    async getBondingManagerAllowance(addr): Promise<TxReceipt> {
      try {
        const address = await resolveAddress(rpc.getENSAddress, addr)
        return headToString(
          await LivepeerToken.allowance(address, BondingManager.address),
        )
      } catch (err) {
        err.message = 'Error: getBondingManagerAllowance\n' + err.message
        throw err
      }
    },

    /**
     * Creates a poll
     * @memberof livepeer~rpc
     * @param {string} pollAddress - poll contract address
     * @param {int} choiceId - vote (0 = yes, 1 = no)
     * @param {TxConfig} [tx = config.defaultTx] - an object specifying the `from` and `gas` values of the transaction
     * @return {Promise<TxReceipt>}
     *
     * @example
     *
     * await rpc.initializeRound()
     * // => TxReceipt {
     * //   transactionHash: string,
     * //   transactionIndex": BN,
     * //   blockHash: string,
     * //   blockNumber: BN,
     * //   cumulativeGasUsed: BN,
     * //   gasUsed: BN,
     * //   contractAddress: string,
     * //   logs: Array<Log {
     * //     logIndex: BN,
     * //     blockNumber: BN,
     * //     blockHash: string,
     * //     transactionHash: string,
     * //     transactionIndex: string,
     * //     address: string,
     * //     data: string,
     * //     topics: Array<string>
     * //   }>
     * // }
     */
    async vote(
      pollAddress,
      choiceId,
      tx = config.defaultTx,
    ): Promise<TxReceipt> {
      try {
        const Poll = await getContractAt(config.eth, {
          ...PollArtifact,
          defaultTx: config.defaultTx,
          address: pollAddress,
        })
        const txHash = await Poll.vote(choiceId, {
          ...config.defaultTx,
          ...tx,
        })
        if (tx.returnTxHash) {
          return txHash
        }
        return await utils.getTxReceipt(txHash, config.eth)
      } catch (err) {
        err.message = 'Error: vote\n' + err.message
        throw err
      }
    },

    /**
     * Claims token and eth earnings from the sender's `lastClaimRound + 1` through a given `endRound`
     * @memberof livepeer~rpc
     * @param {string} endRound - the round to claim earnings until
     * @param {TxConfig} [tx = config.defaultTx] - an object specifying the `from` and `gas` values of the transaction
     * @return {string}
     *
     * @example
     *
     * await rpc.claimEarnings()
     * // => string
     */
    async claimEarnings(
      endRound: string,
      tx = config.defaultTx,
    ): Promise<string> {
      return await BondingManager.claimEarnings(endRound, {
        ...config.defaultTx,
        ...tx,
      })
    },

    async approveTokenBondAmount(
      amount: string,
      tx: TxObject,
    ): Promise<TxReceipt> {
      const token = toBN(amount)
      const txHash = await LivepeerToken.approve(
        BondingManager.address,
        token,
        {
          ...config.defaultTx,
          ...tx,
        },
      )
      if (tx.returnTxHash) {
        return txHash
      }

      return await utils.getTxReceipt(txHash, config.eth)
    },

    async bondApprovedTokenAmount(
      to: string,
      amount: string,
      tx: TxObject,
    ): Promise<TxReceipt> {
      const token = toBN(amount)
      const txHash = await BondingManager.bond(
        token,
        await resolveAddress(rpc.getENSAddress, to),
        {
          ...config.defaultTx,
          ...tx,
        },
      )

      if (tx.returnTxHash) {
        return txHash
      }

      return await utils.getTxReceipt(txHash, config.eth)
    },

    /**
     * Bonds to a transcoder with hint
     * @memberof livepeer~rpc
     * @param {string} amount
     * @param {string} to
     * @param {string} oldDelegateNewPosPrev
     * @param {string} oldDelegateNewPosNext
     * @param {string} currDelegateNewPosPrev
     * @param {string} currDelegateNewPosNext
     * @param {TxConfig} [tx = config.defaultTx] - an object specifying the `from` and `gas` values of the transaction
     * @return {Promise<TxReceipt>}
     *
     * @example
     *
     * await rpc.bondWithHint("100", "0x", "0x", "0x", "0x", "0x")
     * // => TxReceipt {
     * //   transactionHash: string,
     * //   transactionIndex": BN,
     * //   blockHash: string,
     * //   blockNumber: BN,
     * //   cumulativeGasUsed: BN,
     * //   gasUsed: BN,
     * //   contractAddress: string,
     * //   logs: Array<Log {
     * //     logIndex: BN,
     * //     blockNumber: BN,
     * //     blockHash: string,
     * //     transactionHash: string,
     * //     transactionIndex: string,
     * //     address: string,
     * //     data: string,
     * //     topics: Array<string>
     * //   }>
     * // }
     */
    async bondWithHint(
      amount: string,
      to: string,
      oldDelegateNewPosPrev: string,
      oldDelegateNewPosNext: string,
      currDelegateNewPosPrev: string,
      currDelegateNewPosNext: string,
      tx: TxObject,
    ): Promise<TxReceipt> {
      const token = toBN(amount)
      const txHash = await BondingManager.bondWithHint(
        token,
        await resolveAddress(rpc.getENSAddress, to),
        oldDelegateNewPosPrev,
        oldDelegateNewPosNext,
        currDelegateNewPosPrev,
        currDelegateNewPosNext,
        {
          ...config.defaultTx,
          ...tx,
        },
      )

      if (tx.returnTxHash) {
        return txHash
      }

      return await utils.getTxReceipt(txHash, config.eth)
    },

    /**
     * Gets the estimated amount of gas to be used by a smart contract
     * method.
     * @memberof livepeer~rpc
     * @param
     *  contractName: name of contract containing method you wish to find gas price for.
     *  methodName: name of method on contract.
     *  methodArgs: array of argument to be passed to the contract in specified order.
     *  tx: (optioanl){
     *    from: address - 0x...,
     *    gas: number,
     *    value: (optional) number or string containing number
     *  }
     *
     * @return {Promise<number>} containing estimated gas price
     *
     * @example
     *
     * await rpc.estimateGas(
     *  'BondingManager',
     *  'bond',
     *  [10, '0x00.....']
     * )
     * // => 33454
     */
    async estimateGas(
      contractName: string,
      methodName: string,
      methodArgs: Array,
      tx = config.defaultTx,
    ): Promise<number> {
      tx.value = tx.value ? tx.value : '0'
      const gasRate = 1.2
      const contractABI = config.abis[contractName]
      const methodABI = utils.findAbiByName(contractABI, methodName)
      const encodedData = utils.encodeMethodParams(methodABI, methodArgs)
      return Math.round(
        toNumber(
          await config.eth.estimateGas({
            to: config.contracts[contractName].address,
            from: config.defaultTx.from,
            value: tx.value,
            data: encodedData,
          }),
        ) * gasRate,
      )
    },

    /**
     * Unbonds LPT from an address
     * @memberof livepeer~rpc
     * @param {TxConfig} [tx = config.defaultTx] - an object specifying the `from` and `gas` values of the transaction
     * @return {Promise<TxReceipt>}
     *
     * @example
     *
     * await rpc.unbond(amount)
     * // => TxReceipt {
     * //   transactionHash: string,
     * //   transactionIndex": BN,
     * //   blockHash: string,
     * //   blockNumber: BN,
     * //   cumulativeGasUsed: BN,
     * //   gasUsed: BN,
     * //   contractAddress: string,
     * //   logs: Array<Log {
     * //     logIndex: BN,
     * //     blockNumber: BN,
     * //     blockHash: string,
     * //     transactionHash: string,
     * //     transactionIndex: string,
     * //     address: string,
     * //     data: string,
     * //     topics: Array<string>
     * //   }>
     * // }
     */
    async unbond(amount: string, tx = config.defaultTx): Promise<TxReceipt> {
      const txHash = await BondingManager.unbond(amount, {
        ...config.defaultTx,
        ...tx,
      })

      if (tx.returnTxHash) {
        return txHash
      }

      return await utils.getTxReceipt(txHash, config.eth)
    },

    /**
     * Unbonds LPT from an address with hint
     * @memberof livepeer~rpc
     * @param {string} amount
     * @param {string} newPosPrev
     * @param {string} newPosNext
     * @param {TxConfig} [tx = config.defaultTx] - an object specifying the `from` and `gas` values of the transaction
     * @return {Promise<TxReceipt>}
     *
     * @example
     *
     * await rpc.unbondWithHint("100", "0x", "0x")
     * // => TxReceipt {
     * //   transactionHash: string,
     * //   transactionIndex": BN,
     * //   blockHash: string,
     * //   blockNumber: BN,
     * //   cumulativeGasUsed: BN,
     * //   gasUsed: BN,
     * //   contractAddress: string,
     * //   logs: Array<Log {
     * //     logIndex: BN,
     * //     blockNumber: BN,
     * //     blockHash: string,
     * //     transactionHash: string,
     * //     transactionIndex: string,
     * //     address: string,
     * //     data: string,
     * //     topics: Array<string>
     * //   }>
     * // }
     */
    async unbondWithHint(
      amount: string,
      newPosPrev: string,
      newPosNext: string,
      tx = config.defaultTx,
    ): Promise<TxReceipt> {
      const txHash = await BondingManager.unbondWithHint(
        amount,
        newPosPrev,
        newPosNext,
        {
          ...config.defaultTx,
          ...tx,
        },
      )

      if (tx.returnTxHash) {
        return txHash
      }

      return await utils.getTxReceipt(txHash, config.eth)
    },

    /**
     * Sets transcoder parameters
     * @memberof livepeer~rpc
     * @param {string} rewardCut - the block reward cut you wish to set
     * @param {string} feeShare - the fee share you wish to set
     * @param {string} pricePerSegment - the price per segment you wish to set
     * @param {TxConfig} [tx = config.defaultTx] - an object specifying the `from` and `gas` values of the transaction
     * @return {Promise<TxReceipt>}
     *
     * @example
     *
     * await rpc.setupTranscoder('10', '10', '5')
     * // => TxReceipt {
     * //   transactionHash: string,
     * //   transactionIndex": BN,
     * //   blockHash: string,
     * //   blockNumber: BN,
     * //   cumulativeGasUsed: BN,
     * //   gasUsed: BN,
     * //   contractAddress: string,
     * //   logs: Array<Log {
     * //     logIndex: BN,
     * //     blockNumber: BN,
     * //     blockHash: string,
     * //     transactionHash: string,
     * //     transactionIndex: string,
     * //     address: string,
     * //     data: string,
     * //     topics: Array<string>
     * //   }>
     * // }
     */
    async setupTranscoder(
      rewardCut: string, // percentage
      feeShare: string, // percentage
      pricePerSegment: string, // lpt
      tx = config.defaultTx,
    ): Promise<TxReceipt> {
      // become a transcoder
      return await utils.getTxReceipt(
        await BondingManager.transcoder(
          toBN(rewardCut),
          toBN(feeShare),
          toBN(pricePerSegment),
          tx,
        ),
        config.eth,
      )
    },

    /**
     * Get target bonding rate
     * @memberof livepeer~rpc
     * @return {Promise<string>}
     *
     * @example
     *
     * await rpc.getTargetBondingRate()
     * // => string
     */
    async getTargetBondingRate(): Promise<string> {
      return headToString(await Minter.targetBondingRate())
    },

    /**
     * Withdraws earned token (Transfers a sender's delegator `bondedAmount` to their `tokenBalance`)
     * @memberof livepeer~rpc
     * @param {string} [unbondLockId] - the unbond lock id
     * @param {TxConfig} [tx = config.defaultTx] - an object specifying the `from` and `gas` values of the transaction
     * @return {TxReceipt}
     *
     * @example
     *
     * await rpc.withdrawStake()
     * // => TxReceipt {
     * //   transactionHash: string,
     * //   transactionIndex": BN,
     * //   blockHash: string,
     * //   blockNumber: BN,
     * //   cumulativeGasUsed: BN,
     * //   gasUsed: BN,
     * //   contractAddress: string,
     * //   logs: Array<Log {
     * //     logIndex: BN,
     * //     blockNumber: BN,
     * //     blockHash: string,
     * //     transactionHash: string,
     * //     transactionIndex: string,
     * //     address: string,
     * //     data: string,
     * //     topics: Array<string>
     * //   }>
     * // }
     */
    async withdrawStake(
      unbondLockId: string,
      tx = config.defaultTx,
    ): Promise<TxReceipt> {
      if (typeof unbondLockId === 'undefined') {
        throw new Error('missing argument unbondingLockId')
      }
      let id = toBN(unbondLockId)
      let txHash = await BondingManager.withdrawStake(toString(id), tx)

      if (tx.returnTxHash) {
        return txHash
      }

      return await utils.getTxReceipt(txHash, config.eth)
    },

    /**
     * Withdraws earned token (Transfers a sender's delegator `bondedAmount` to their `tokenBalance`)
     * @memberof livepeer~rpc
     * @param {} [unbondlock] - an object specifying the unbondlock id, amount & withdrawRound
     * @param {TxConfig} [tx = config.defaultTx] - an object specifying the `from` and `gas` values of the transaction
     * @return {TxReceipt}
     *
     * @example
     *
     * await rpc.withdrawStakeWithUnbondLock(unbondlock)
     * // => TxReceipt {
     * //   transactionHash: string,
     * //   transactionIndex": BN,
     * //   blockHash: string,
     * //   blockNumber: BN,
     * //   cumulativeGasUsed: BN,
     * //   gasUsed: BN,
     * //   contractAddress: string,
     * //   logs: Array<Log {
     * //     logIndex: BN,
     * //     blockNumber: BN,
     * //     blockHash: string,
     * //     transactionHash: string,
     * //     transactionIndex: string,
     * //     address: string,
     * //     data: string,
     * //     topics: Array<string>
     * //   }>
     * // }
     */

    async withdrawStakeWithUnbondLock(
      unbondlock: { id: string, amount: string, withdrawRound: string },
      tx = config.defaultTx,
    ): Promise<TxReceipt> {
      const { id, amount, withdrawRound } = unbondlock

      const currentRound = await rpc.getCurrentRound()

      // ensure the unbonding period is over
      if (withdrawRound > currentRound) {
        throw new Error('Delegator must wait through unbonding period')
      } else if (amount === '0') {
        throw new Error('Delegator does not have anything to withdraw')
      } else if (amount < 0) {
        throw new Error('Amount cannot be negative')
      }

      let unbondingLockId = toBN(id)
      const txHash = await BondingManager.withdrawStake(
        toString(unbondingLockId),
        tx,
      )
      if (tx.returnTxHash) {
        return txHash
      }
      return await utils.getTxReceipt(txHash, config.eth)
    },

    /**
     * Withdraws earned fees (Transfers a sender's delegator `fees` to their `ethBalance`)
     * @memberof livepeer~rpc
     * @param {TxConfig} [tx = config.defaultTx] - an object specifying the `from` and `gas` values of the transaction
     * @return {TxReceipt}
     *
     * @example
     *
     * await rpc.withdrawFees()
     * // => TxReceipt {
     * //   transactionHash: string,
     * //   transactionIndex": BN,
     * //   blockHash: string,
     * //   blockNumber: BN,
     * //   cumulativeGasUsed: BN,
     * //   gasUsed: BN,
     * //   contractAddress: string,
     * //   logs: Array<Log {
     * //     logIndex: BN,
     * //     blockNumber: BN,
     * //     blockHash: string,
     * //     transactionHash: string,
     * //     transactionIndex: string,
     * //     address: string,
     * //     data: string,
     * //     topics: Array<string>
     * //   }>
     * // }
     */
    async withdrawFees(tx = config.defaultTx): Promise<TxReceipt> {
      let txHash = await BondingManager.withdrawFees(tx)
      if (tx.returnTxHash) {
        return txHash
      }
      return await utils.getTxReceipt(txHash, config.eth)
    },
  }

  return {
    create: createLivepeerSDK,
    config,
    rpc,
    utils,
    events,
    constants: {
      ADDRESS_PAD,
      EMPTY_ADDRESS,
      DELEGATOR_STATUS,
      TRANSCODER_STATUS,
      VIDEO_PROFILE_ID_SIZE,
      VIDEO_PROFILES,
    },
  }

  // Keeping typedefs down here so they show up last in the generated API table of contents

  /**
   * ABI property descriptor
   * @typedef {Object} ABIPropDescriptor
   * @prop {boolean} constants - is the method constant?
   * @prop {Array<{ name: string, type: string }>} inputs - the method params
   * @prop {Array<{ name: string, type: string }>} outputs - method return values
   * @prop {boolean} payable - is the method payable?
   * @prop {string} stateMutability - type of state mutability
   * @prop {string} type - type of contract property
   */

  /**
   * Mostly "`truffle`-style" ABI artifacts but no bytecode/network properties required
   * @typedef {Object} ContractArtifact
   * @prop {string} name - name of the contract
   * @prop {Array<ABIPropDescriptor>} abi - lists info about contract properties
   */

  /**
   * SDK configuration options
   * @typedef {Object} LivepeerSDKOptions
   * @prop {string} [controllerAddress = '0x37dC71366Ec655093b9930bc816E16e6b587F968'] - The address of the delpoyed Controller contract
   * @prop {string} [provider = 'https://rinkeby.infura.io/srFaWg0SlljdJAoClX3B'] - The ETH http provider for rpc methods
   * @prop {number} [gas = 0] - the amount of gas to include with transactions by default
   * @prop {Object<string, ContractArtifact>} artifacts - an object containing contract name -> ContractArtifact mappings
   * @prop {Object<string, string>} privateKeys - an object containing public -> private key mappings. Should be specified if using the SDK for transactions without MetaMask (via CLI, etc)
   * @prop {string|number} account - the account that will be used for transacting and data-fetching. Can be one of the publicKeys specified in the `privateKeys` option or an index of an account available via MetaMask
   */

  /**
   * An object containing contract info and utility methods for interacting with the Livepeer protocol's smart contracts
   * @typedef {Object} LivepeerSDK
   * @prop {Object<string, any>} config - this prop is mostly for debugging purposes and could change a lot in the future. Currently, it contains the following props: `abis`, `accounts`, `contracts`, `defaultTx`, `eth`
   * @prop {Object<string, any>} constants - Exposes some constant values. Currently, it contains the following props: `ADDRESS_PAD`, `DELEGATOR_STATUS`, `EMPTY_ADDRESS`, `TRANSCODER_STATUS`, `VIDEO_PROFILES`, `VIDEO_PROFILE_ID_SIZE`
   * @prop {Function} create - same as the `createLivepeerSDK` function
   * @prop {Object<string, Object>} events - Object mapping an event name -> contract event descriptor object
   * @prop {Object<string, Function>} rpc - contains all of the rpc methods available for interacting with the Livepeer protocol
   * @prop {Object<string, Function>} utils - contains utility methods. Mostly here just because. Could possibly be removed or moved into its own module in the future
   */

  /**
   * An object containing the total token supply and a user's account balance.
   * @typedef {Object} TokenInfo
   * @prop {string} totalSupply - total supply of token available in the protocol (LPTU)
   * @prop {string} balance - user's token balance (LPTU)
   */

  /**
   * Transaction config object
   * @typedef {Object} TxConfig
   * @prop {string} from - the ETH account address to sign the transaction from
   * @prop {number} gas - the amount of gas to include in the transaction
   */

  /**
   * Transaction receipt
   * @typedef {Object} TxReceipt
   * @prop {string} transactionHash - the transaction hash
   * @prop {BN} transactionIndex - the transaction index
   * @prop {string} blockHash - the transaction block hash
   * @prop {BN} blockNumber - the transaction block number
   * @prop {BN} cumulativeGasUsed - the cumulative gas used in the transaction
   * @prop {BN} gasUsed - the gas used in the transaction
   * @prop {string} contractAddress - the contract address of the transaction method
   * @prop {Array<Log>} logs - an object containing logs that were fired during the transaction
   */

  /**
   * An object representing a contract log
   * @typedef {Object} Log
   * @prop {BN} logIndex - the log index
   * @prop {BN} blockNumber - the log block number
   * @prop {string} blockHash - the log block hash
   * @prop {string} transactionHash - the log's transaction hash
   * @prop {BN} transactionIndex - the log's transaction index
   * @prop {string} address - the log's address
   * @prop {string} data - the log's data
   * @prop {Array<string>} topics - the log's topics
   */

  /**
   * Information about the status of the LPT faucet
   * @typedef {Object} FaucetInfo
   * @prop {string} amount - the amount distributed by the faucet
   * @prop {string} wait - the faucet request cooldown time
   * @prop {string} next - the next time a valid faucet request may be made
   */

  /**
   * A Broadcaster struct
   * @typedef {Object} Broadcaster
   * @prop {string} address - the ETH address of the broadcaster
   * @prop {string} deposit - the amount of LPT the broadcaster has deposited
   * @prop {string} withdrawBlock - the next block at which a broadcaster may withdraw their deposit
   */

  /**
   * A Delegator struct
   * @typedef {Object} Delegator
   * @prop {string} allowance - the delegator's LivepeerToken approved amount for transfer
   * @prop {string} address - the delegator's ETH address
   * @prop {string} bondedAmount - The amount of LPTU a delegator has bonded
   * @prop {string} delegateAddress - the ETH address of the delegator's delegate
   * @prop {string} delegatedAmount - the amount of LPTU the delegator has delegated
   * @prop {string} fees - the amount of LPTU a delegator has collected
   * @prop {string} lastClaimRound - the last round that the delegator claimed reward and fee pool shares
   * @prop {string} pendingFees - the amount of ETH the delegator has earned up to the current round
   * @prop {string} pendingStake - the amount of token the delegator has earned up to the current round
   * @prop {string} startRound - the round the delegator becomes bonded and delegated to its delegate
   * @prop {string} status - the delegator's status
   * @prop {string} withdrawableAmount - the amount of LPTU a delegator can withdraw
   * @prop {string} withdrawRound - the round the delegator can withdraw its stake
   * @prop {string} nextUnbondingLockId - the next unbonding lock ID for the delegator
   */

  /**
   * A Transcoder struct
   * @typedef {Object} Transcoder
   * @prop {boolean} active - whether or not the transcoder is active
   * @prop {string} address - the transcoder's ETH address
   * @prop {string} rewardCut - % of block reward cut paid to transcoder by a delegator
   * @prop {string} feeShare - % of fees paid to delegators by transcoder
   * @prop {string} lastRewardRound - last round that the transcoder called reward
   * @prop {string} pendingRewardCut - pending block reward cut for next round if the transcoder is active
   * @prop {string} pendingFeeShare - pending fee share for next round if the transcoder is active
   * @prop {string} pendingPricePerSegment - pending price per segment for next round if the transcoder is active
   * @prop {string} pricePerSegment - price per segment for a stream (LPTU)
   * @prop {string} status - the transcoder's status
   * @prop {string} totalStake - total tokens delegated toward a transcoder (including their own)
   */

  /**
   * An UnbondingLock struct
   * @typedef {Object} UnbondingLock
   * @prop {string} id - the unbonding lock ID
   * @prop {string} delegator - the delegator's ETH address
   * @prop {string} amount - the amount of tokens being unbonded
   * @prop {string} withdrawRound - the round at which unbonding period is over and tokens can be withdrawn
   */

  /**
   * An object containing information about the current round
   * @typedef {Object} RoundInfo
   * @prop {string} id - the number of the current round
   * @prop {boolean} initialized - whether or not the current round is initialized
   * @prop {string} startBlock - the start block of the current round
   * @prop {string} lastInitializedRound - the last round that was initialized prior to the current
   * @prop {string} length - the length of rounds
   */

  /**
   * An object containing information about an Ethereum block
   * @typedef {Object} Block
   * @prop {string} number - block number
   * @prop {string} hash - block hash
   * @prop {string} parentHash - parent has of the block
   * @prop {string} nonce - block nonce
   * @prop {string} sha3Uncles - block sha3 uncles
   * @prop {string} logsBloom - logss bloom for the block
   * @prop {string} transactionsRoot - block transaction root hash
   * @prop {string} stateRoot - block state root hash
   * @prop {string} receiptsRoot - block receipts root hash
   * @prop {string} miner - block miner hash
   * @prop {string} mixHash - block mixHash
   * @prop {string} difficulty - difficulty int
   * @prop {string} totalDifficulty - total difficulty int
   * @prop {string} extraData - hash of extra data
   * @prop {string} size - block size
   * @prop {string} gasLimit - block gas limit
   * @prop {string} gasUsed - gas used in block
   * @prop {number} timestamp - block timestamp
   * @prop {string} transactions - block transactions hash
   * @prop {string} uncles - block uncles hash
   * @prop {Array<Transaction>} transactions - transactions in the block
   * @prop {string} transactionsRoot - root transaction hash
   * @prop {Array<Uncle>} uncles - block uncles
   */

  /**
   * A Protocol struct
   * @typedef {Object} Protocol
   * @prop {boolean} paused - the protocol paused or not
   * @prop {string} totalTokenSupply - total token supply for protocol
   * @prop {string} totalBondedToken - total bonded token for protocol
   * @prop {string} targetBondingRate - target bonding rate for protocol
   * @prop {string} transcoderPoolMaxSize - transcoder pool max size
   */
}

export { createLivepeerSDK as LivepeerSDK, createLivepeerSDK as default }
