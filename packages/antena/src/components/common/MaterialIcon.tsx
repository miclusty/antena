import { splitProps } from 'solid-js'
import type { JSX } from 'solid-js'

type Size = 'xs' | 'sm' | 'base' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl'

interface MaterialIconProps extends JSX.HTMLAttributes<HTMLSpanElement> {
  name: string
  size?: Size
  filled?: boolean
}

const SIZE_MAP: Record<Size, number> = {
  xs: 14, sm: 16, base: 18, lg: 20, xl: 24,
  '2xl': 28, '3xl': 36, '4xl': 44, '5xl': 56,
}

export default function MaterialIcon(props: MaterialIconProps) {
  const [local, rest] = splitProps(props, ['name', 'size', 'filled', 'class', 'style'])
  const size = () => local.size ?? 'base'
  const px = () => SIZE_MAP[size()]
  const className = () => `inline-flex items-center justify-center leading-none ${local.class ?? ''}`.trim()
  const style = () => ({
    width: `${px()}px`,
    height: `${px()}px`,
    ...(local.style as JSX.CSSProperties),
  })
  return (
    <span class={className()} style={style()} {...rest}>
      <svg width={px()} height={px()} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <use href={`#${local.name}`} />
      </svg>
    </span>
  )
}
