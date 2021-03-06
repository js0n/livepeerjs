import Button from '../Button'
import Stake from './Stake'
import Unstake from './Unstake'
import { Account, Delegator, Transcoder, Round } from '../../@types'
import Utils from 'web3-utils'
import {
  getDelegatorStatus,
  MAX_EARNINGS_CLAIMS_ROUNDS,
  getHint,
  simulateNewActiveSetOrder,
} from '../../lib/utils'
import { useWeb3React } from '@web3-react/core'
import Warning from './Warning'
import Approve from '../Approve'
import ReactTooltip from 'react-tooltip'
import Help from '../../public/img/help.svg'
import { useApolloClient } from '@apollo/react-hooks'

interface Props {
  transcoders: [Transcoder]
  action: string
  amount: string
  transcoder: Transcoder
  delegator?: Delegator
  currentRound: Round
  account: Account
}

export default ({
  transcoders,
  delegator,
  transcoder,
  action,
  amount,
  account,
  currentRound,
}: Props) => {
  const context = useWeb3React()
  const client = useApolloClient()

  if (!context.account) {
    return (
      <Button
        onClick={() =>
          client.writeData({
            data: {
              walletModalOpen: true,
            },
          })
        }
        sx={{ width: '100%' }}
      >
        Connect Wallet
      </Button>
    )
  }

  const tokenBalance =
    account && parseFloat(Utils.fromWei(account.tokenBalance))
  const tokenAllowance = account && parseFloat(Utils.fromWei(account.allowance))
  const approved = account && parseFloat(Utils.fromWei(account.allowance)) > 0
  const delegatorStatus = getDelegatorStatus(delegator, currentRound)
  const isStaked =
    delegatorStatus == 'Bonded' || delegatorStatus == 'Unbonding' ? true : false
  const sufficientBalance =
    account && parseFloat(amount) >= 0 && parseFloat(amount) <= tokenBalance
  const sufficientTransferAllowance =
    account && tokenAllowance > 0 && parseFloat(amount) <= tokenAllowance
  const stake =
    delegator &&
    Math.max(
      delegator.bondedAmount
        ? parseFloat(Utils.fromWei(delegator.bondedAmount))
        : 0,
      delegator.pendingStake
        ? parseFloat(Utils.fromWei(delegator.pendingStake))
        : 0,
    )

  const isMyTranscoder = delegator?.delegate?.id === transcoder?.id
  const sufficientStake = delegator && amount && parseFloat(amount) <= stake
  const roundsSinceLastClaim =
    currentRound &&
    delegator &&
    delegator.lastClaimRound &&
    parseInt(currentRound.id, 10) - parseInt(delegator.lastClaimRound.id, 10)

  const canStake =
    sufficientBalance &&
    roundsSinceLastClaim <= MAX_EARNINGS_CLAIMS_ROUNDS &&
    approved &&
    sufficientTransferAllowance

  const canUnstake =
    isMyTranscoder &&
    isStaked &&
    roundsSinceLastClaim <= MAX_EARNINGS_CLAIMS_ROUNDS &&
    parseFloat(amount) > 0

  const newActiveSetOrder = simulateNewActiveSetOrder({
    action,
    transcoders: JSON.parse(JSON.stringify(transcoders)),
    amount: Utils.toWei(amount ? amount.toString() : '0'),
    newDelegate: transcoder.id,
    oldDelegate: delegator?.delegate?.id,
  })

  const { newPosPrev, newPosNext } = getHint(
    delegator?.delegate?.id,
    newActiveSetOrder,
  )

  const {
    newPosPrev: currDelegateNewPosPrev,
    newPosNext: currDelegateNewPosNext,
  } = getHint(transcoder.id, newActiveSetOrder)

  if (action == 'stake') {
    return (
      <>
        <Stake
          disabled={!canStake}
          to={transcoder.id}
          amount={amount}
          oldDelegateNewPosPrev={newPosPrev}
          oldDelegateNewPosNext={newPosNext}
          currDelegateNewPosPrev={currDelegateNewPosPrev}
          currDelegateNewPosNext={currDelegateNewPosNext}
        />
        {renderStakeWarnings(
          roundsSinceLastClaim,
          amount,
          sufficientBalance,
          sufficientTransferAllowance,
          account,
          isMyTranscoder,
          isStaked,
          stake,
        )}
      </>
    )
  }
  return (
    <>
      <Unstake
        amount={amount}
        newPosPrev={newPosPrev}
        newPosNext={newPosNext}
        disabled={!canUnstake}
      />
      {renderUnstakeWarnings(
        roundsSinceLastClaim,
        amount,
        delegatorStatus,
        isStaked,
        sufficientStake,
        isMyTranscoder,
      )}
    </>
  )
}

function renderStakeWarnings(
  roundsSinceLastClaim,
  amount,
  sufficientBalance,
  sufficientTransferAllowance,
  account,
  isMyTranscoder,
  isStaked,
  stake,
) {
  if (parseFloat(amount) >= 0 && !sufficientBalance) {
    return <Warning>Insufficient Balance</Warning>
  }

  if (parseFloat(amount) >= 0 && !sufficientTransferAllowance) {
    return (
      <Warning>
        Your transfer allowance is set too low.{' '}
        <Approve account={account} banner={false} />
      </Warning>
    )
  }

  if (
    roundsSinceLastClaim > MAX_EARNINGS_CLAIMS_ROUNDS &&
    parseFloat(amount) >= 0
  ) {
    return (
      <Warning>
        You must claim your earnings before you can continue staking.
      </Warning>
    )
  }

  if (parseFloat(amount) >= 0 && isStaked && !isMyTranscoder) {
    return (
      <Warning>
        <div>
          <span>
            Staking to this orchestrator will switch over your existing stake of{' '}
            <b>{stake.toFixed(2)}</b>
          </span>
          <div sx={{ display: 'inline-flex' }}>
            <ReactTooltip
              id="tooltip-switch-stake"
              className="tooltip"
              place="top"
              type="dark"
              effect="solid"
            />
            <Help
              data-tip="You may only stake towards a single orchestrator per account. If you'd like to switch over your existing stake from one orchestrator to another and nothing more, enter 0."
              data-for="tooltip-switch-stake"
              sx={{
                cursor: 'pointer',
                ml: 1,
              }}
            />
          </div>
        </div>
      </Warning>
    )
  }
}

function renderUnstakeWarnings(
  roundsSinceLastClaim,
  amount,
  delegatorStatus,
  isStaked,
  sufficientStake,
  isMyTranscoder,
) {
  if (
    roundsSinceLastClaim > MAX_EARNINGS_CLAIMS_ROUNDS &&
    parseFloat(amount) >= 0
  ) {
    return (
      <Warning>
        You must claim your earnings before you can continue staking.
      </Warning>
    )
  }
  if (delegatorStatus == 'Pending') {
    return (
      <Warning>
        Your account is in a pending state. You can unstake during the next
        round.
      </Warning>
    )
  }
  if (!isStaked) {
    return <Warning>One must stake before one can unstake.</Warning>
  }
  if (!isMyTranscoder) {
    return <Warning>You're not staked to this orchestrator.</Warning>
  }
  if (parseFloat(amount) && !sufficientStake) {
    return <Warning>Insufficient stake</Warning>
  }
}
