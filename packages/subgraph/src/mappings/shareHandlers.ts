import { Address, BigInt, dataSource } from '@graphprotocol/graph-ts'
import { Delegator, Protocol, Share, Transcoder } from '../types/schema'
import {
  makeShareId,
  percOfWithDenom,
  percOf,
  makePoolId,
} from '../../utils/helpers'
import { BondingManager_genesis } from '../types/templates/ShareTemplate/BondingManager_genesis'
import {
  BondingManager_streamflow,
  Reward as RewardEvent,
} from '../types/templates/ShareTemplate/BondingManager_streamflow'

export function updateShareOnReward(event: RewardEvent): void {
  let delegatorAddress = dataSource.context().getString('delegator')
  let delegator = Delegator.load(delegatorAddress) as Delegator
  // if caller is delegator's delegate, update its share and pendingStake
  if (delegator.delegate == event.params.transcoder.toHex()) {
    if (event.block.number.lt(BigInt.fromI32(6248558))) {
      calculateRewardsPreviousVersion(event, delegator)
    } else {
      calculateRewards(event, delegator)
    }
  }
}

export function calculateRewards(
  event: RewardEvent,
  delegator: Delegator,
): void {
  let bondingManager = BondingManager_streamflow.bind(event.address)
  let protocol = Protocol.load('0') || new Protocol('0')
  let currentRound = BigInt.fromI32(parseInt(protocol.currentRound, 10) as i32)
  // We have to fetch lastClaimRound from contract storage because if a transcoder
  // called reward in the block that a delegator claimed earnings
  // last claim round would be incorrect
  let delegatorData = bondingManager.getDelegator(
    Address.fromString(delegator.id),
  )

  let lastClaimRound = delegatorData.value5

  if (currentRound.gt(lastClaimRound)) {
    let earningsPool = bondingManager.getTranscoderEarningsPoolForRound(
      event.params.transcoder,
      currentRound,
    )
    let rewardPool = earningsPool.value0
    let bondedAmount = delegatorData.value0
    let claimableStake = earningsPool.value3
    let poolId = makePoolId(
      event.params.transcoder.toHex(),
      protocol.currentRound,
    )
    let shareId = makeShareId(delegator.id, protocol.currentRound)
    let share = Share.load(shareId) || new Share(shareId)
    let isTranscoder = delegator.id == event.params.transcoder.toHex()
    let delegatorRewards = claimableStake.gt(BigInt.fromI32(0))
      ? percOfWithDenom(rewardPool, bondedAmount, claimableStake)
      : BigInt.fromI32(0)

    if (isTranscoder) {
      let transcoderRewardPool = earningsPool.value6
      share.rewardTokens = delegatorRewards.plus(transcoderRewardPool)
    } else {
      share.rewardTokens = delegatorRewards
    }

    share.pool = poolId
    share.round = currentRound.toString()
    share.delegator = delegator.id
    delegator.pendingStake = delegator.pendingStake.plus(
      share.rewardTokens as BigInt,
    )
    share.save()
    delegator.save()
  }
}

export function calculateRewardsPreviousVersion(
  event: RewardEvent,
  delegator: Delegator,
): void {
  let bondingManager = BondingManager_genesis.bind(event.address)
  let protocol = Protocol.load('0') || new Protocol('0')
  let currentRound = BigInt.fromI32(parseInt(protocol.currentRound, 10) as i32)
  // We have to fetch lastClaimRound from contract storage because if a transcoder
  // called reward in the block that a delegator claimed earnings
  // last claim round would be incorrect
  let delegatorData = bondingManager.getDelegator(
    Address.fromString(delegator.id),
  )

  let lastClaimRound = event.block.number.lt(BigInt.fromI32(6194948))
    ? delegatorData.value6
    : delegatorData.value5

  if (currentRound.gt(lastClaimRound)) {
    let earningsPool = bondingManager.getTranscoderEarningsPoolForRound(
      event.params.transcoder,
      currentRound,
    )
    let rewardPool = earningsPool.value0
    let bondedAmount = delegatorData.value0
    let claimableStake = earningsPool.value3
    let poolId = makePoolId(
      event.params.transcoder.toHex(),
      protocol.currentRound,
    )
    let shareId = makeShareId(delegator.id, protocol.currentRound)
    let share = Share.load(shareId) || new Share(shareId)
    let isTranscoder = delegator.id == event.params.transcoder.toHex()
    let transcoderRewards = BigInt.fromI32(0)
    let delegatorRewards = BigInt.fromI32(0)
    let transcoder = Transcoder.load(event.params.transcoder.toHex())
    if (claimableStake.gt(BigInt.fromI32(0))) {
      transcoderRewards = percOf(rewardPool, transcoder.rewardCut as BigInt)
      delegatorRewards = percOfWithDenom(
        rewardPool.minus(transcoderRewards),
        bondedAmount,
        claimableStake,
      )
    }

    if (isTranscoder) {
      share.rewardTokens = delegatorRewards.plus(transcoderRewards)
    } else {
      share.rewardTokens = delegatorRewards
    }

    share.pool = poolId
    share.round = currentRound.toString()
    share.delegator = delegator.id
    delegator.pendingStake = delegator.pendingStake.plus(
      share.rewardTokens as BigInt,
    )

    share.save()
    delegator.save()
  }
}
