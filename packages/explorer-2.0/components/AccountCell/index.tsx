import { Flex } from 'theme-ui'
import QRCode from 'qrcode.react'
import { textTruncate, getDelegationStatusColor } from '../../lib/utils'

const ActiveCircle = ({ active }, props) => {
  return (
    <div
      className="status"
      sx={{
        position: 'absolute',
        right: '-2px',
        bottom: '-2px',
        bg: active ? 'primary' : 'muted',
        border: '3px solid',
        borderColor: 'background',
        boxSizing: 'border-box',
        width: 14,
        height: 14,
        borderRadius: 1000,
        ...props.sx,
      }}
    />
  )
}

export default ({ threeBoxSpace, active, address }) => {
  return (
    <Flex sx={{ alignItems: 'center' }}>
      <Flex sx={{ minWidth: 40, minHeight: 40, position: 'relative', mr: 2 }}>
        {process.env.THREEBOX_ENABLED && threeBoxSpace.image ? (
          <img
            sx={{
              objectFit: 'cover',
              borderRadius: 1000,
              width: 40,
              height: 40,
              padding: '2px',
              border: '1px solid',
              borderColor: 'muted',
            }}
            src={`https://ipfs.infura.io/ipfs/${threeBoxSpace.image}`}
          />
        ) : (
          <QRCode
            style={{
              borderRadius: 1000,
              width: 40,
              height: 40,
              padding: '2px',
              border: '1px solid',
              borderColor: 'muted',
            }}
            fgColor={`#${address.substr(2, 6)}`}
            value={address}
          />
        )}
        <ActiveCircle active={active} />
      </Flex>

      <Flex
        sx={{
          color: 'text',
          transition: 'all .3s',
          borderBottom: '1px solid',
          borderColor: 'transparent',
          justifyContent: 'space-between',
          width: '100%',
        }}
      >
        <Flex
          className="orchestratorLink"
          sx={{ justifyContent: 'space-between', alignItems: 'center' }}
        >
          <div sx={{ fontWeight: 600 }}>
            {process.env.THREEBOX_ENABLED && threeBoxSpace.name
              ? textTruncate(threeBoxSpace.name, 15, '…')
              : address.replace(address.slice(5, 39), '…')}
          </div>
        </Flex>

        {/* {active && (
          <div
            sx={{
              ml: 1,
              display: 'inline-flex',
              padding: '3px 6px',
              border: '1px solid',
              borderColor: 'border',
              color: 'muted',
              fontWeight: 600,
              alignSelf: 'center',
              borderRadius: 3,
              fontSize: '10px',
              alignItems: 'center',
            }}
          >
            ACTIVE
          </div>
        )} */}
      </Flex>
    </Flex>
  )
}
