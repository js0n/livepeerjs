/** @jsx jsx */
import { jsx } from 'theme-ui'

export default ({ variant = 'primary', size = 'normal', ...props }) => (
  <div
    {...props}
    sx={{
      appearance: 'none',
      display: 'inline-block',
      textAlign: 'center',
      cursor: 'pointer',
      lineHeight: 'inherit',
      textDecoration: 'none',
      fontSize: '14px',
      fontWeight: '700',
      textTransform: 'uppercase',
      m: 0,
      px: 2,
      py: 1,
      border: 0,
      borderRadius: 4,
      variant: `buttons.${variant}`,
      position: 'relative',
    }}
  />
)
