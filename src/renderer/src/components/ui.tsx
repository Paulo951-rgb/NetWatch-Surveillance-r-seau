import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { DeviceType } from '@shared/types'
import {
  IconAlert,
  IconCamera,
  IconCpu,
  IconGamepad,
  IconHelp,
  IconLaptop,
  IconPrinter,
  IconRouter,
  IconServer,
  IconSmartphone,
  IconSpeaker,
  IconTablet,
  IconTv,
  IconX,
  type IconProps
} from './Icons'

export function Card({
  children,
  className = '',
  hover = false
}: {
  children: ReactNode
  className?: string
  hover?: boolean
}): ReactNode {
  return <section className={`card${hover ? ' hover' : ''} ${className}`.trim()}>{children}</section>
}

export function CardHead({
  title,
  subtitle,
  actions
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
}): ReactNode {
  return (
    <div className="card-head">
      <div>
        <h3>{title}</h3>
        {subtitle ? <div className="sub">{subtitle}</div> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  )
}

export function SectionTitle({
  title,
  hint,
  actions
}: {
  title: ReactNode
  hint?: ReactNode
  actions?: ReactNode
}): ReactNode {
  return (
    <div className="section-title">
      <div>
        <h2>{title}</h2>
        {hint ? <div className="hint">{hint}</div> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  )
}

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info' | 'accent'

export function Badge({
  tone = 'neutral',
  children,
  dot = false
}: {
  tone?: Tone
  children: ReactNode
  dot?: boolean
}): ReactNode {
  return (
    <span className={`badge ${tone}`}>
      {dot ? <span className={`dot ${tone === 'ok' ? 'online' : tone === 'danger' ? 'danger' : tone === 'warn' ? 'warn' : ''}`} /> : null}
      {children}
    </span>
  )
}

export function StatusDot({ online }: { online: boolean }): ReactNode {
  return <span className={`dot ${online ? 'online' : 'offline'}`} />
}

export function StatCard({
  label,
  value,
  unit,
  icon,
  tone = 'accent',
  footer,
  spark
}: {
  label: string
  value: ReactNode
  unit?: string
  icon: ReactNode
  tone?: 'accent' | 'ok' | 'warn' | 'danger'
  footer?: ReactNode
  spark?: ReactNode
}): ReactNode {
  return (
    <div className="card stat">
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        <span className={`stat-icon ${tone === 'accent' ? '' : tone}`}>{icon}</span>
      </div>
      <div className="stat-value">
        {value}
        {unit ? <small>{unit}</small> : null}
      </div>
      {footer ? <div className="stat-foot">{footer}</div> : null}
      {spark ? <div className="stat-spark">{spark}</div> : null}
    </div>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  disabled = false
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label?: ReactNode
  disabled?: boolean
}): ReactNode {
  return (
    <label className="switch" aria-disabled={disabled}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch-track" />
      {label ? <span className="switch-label">{label}</span> : null}
    </label>
  )
}

export function SettingRow({
  label,
  description,
  children,
  wide = false
}: {
  label: ReactNode
  description?: ReactNode
  children: ReactNode
  wide?: boolean
}): ReactNode {
  return (
    <div className="setting-row">
      <div>
        <div className="label">{label}</div>
        {description ? <div className="desc">{description}</div> : null}
      </div>
      <div className={`control${wide ? ' wide' : ''}`}>{children}</div>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action
}: {
  icon: ReactNode
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
}): ReactNode {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h4>{title}</h4>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  )
}

export function ProgressBar({ value, thin = false }: { value: number; thin?: boolean }): ReactNode {
  const clamped = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
  return (
    <div className={`progress${thin ? ' thin' : ''}`}>
      <span style={{ width: `${clamped}%` }} />
    </div>
  )
}

export function Skeleton({ height = 16, width = '100%' }: { height?: number; width?: string | number }): ReactNode {
  return <div className="skeleton" style={{ height, width }} />
}

export function Modal({
  title,
  children,
  footer,
  onClose
}: {
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
}): ReactNode {
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="modal" role="dialog" aria-modal="true">
        <div className="modal-head">{title}</div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </>
  )
}

export function Drawer({
  title,
  subtitle,
  children,
  footer,
  onClose
}: {
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
}): ReactNode {
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div>
            <h3>{title}</h3>
            {subtitle ? <div className="tiny muted" style={{ marginTop: 3 }}>{subtitle}</div> : null}
          </div>
          <button className="btn icon sm ghost" onClick={onClose} aria-label="Fermer">
            <IconX size={16} />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer ? <div className="drawer-foot">{footer}</div> : null}
      </aside>
    </>
  )
}

export function Tabs<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (value: T) => void
}): ReactNode {
  return (
    <div className="tabs" role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={value === option.value}
          className={`tab${value === option.value ? ' active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (value: T) => void
}): ReactNode {
  return (
    <div className="btn-group">
      {options.map((option) => (
        <button
          key={option.value}
          className={value === option.value ? 'active' : ''}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

const DEVICE_ICONS: Record<DeviceType, (props: IconProps) => ReactNode> = {
  computer: IconLaptop,
  smartphone: IconSmartphone,
  tablet: IconTablet,
  printer: IconPrinter,
  router: IconRouter,
  tv: IconTv,
  console: IconGamepad,
  iot: IconCpu,
  nas: IconServer,
  camera: IconCamera,
  speaker: IconSpeaker,
  unknown: IconHelp
}

export function DeviceAvatar({ type, small = false }: { type: DeviceType; small?: boolean }): ReactNode {
  const Icon = DEVICE_ICONS[type] ?? IconHelp
  return (
    <span className={`avatar${small ? ' sm' : ''}`}>
      <Icon size={small ? 14 : 17} />
    </span>
  )
}

export function CopyButton({ value, label }: { value: string; label: string }): ReactNode {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="btn icon sm ghost"
      title={label}
      onClick={() => {
        void navigator.clipboard.writeText(value).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      {copied ? <IconAlert size={14} /> : <span className="tiny">{copied ? '✓' : '⧉'}</span>}
    </button>
  )
}

export function useElementWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width)
    })
    observer.observe(element)
    setWidth(element.clientWidth)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

export function useUniqueId(prefix: string): string {
  const id = useId()
  return `${prefix}-${id.replace(/:/g, '')}`
}
