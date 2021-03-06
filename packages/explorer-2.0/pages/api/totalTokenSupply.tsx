import Utils from 'web3-utils'

export default async (req, res) => {
  const response = await fetch(
    `https://${
      process.env.NETWORK === 'rinkeby' ? 'api-rinkeby' : 'api'
    }.etherscan.io/api?module=stats&action=tokensupply&contractaddress=0x58b6a8a3302369daec383334672404ee733ab239&apikey=${
      process.env.ETHERSCAN_API_KEY
    }`,
  )
  const { result: totalTokenSupply } = await response.json()
  res.end(Utils.fromWei(totalTokenSupply))
}
