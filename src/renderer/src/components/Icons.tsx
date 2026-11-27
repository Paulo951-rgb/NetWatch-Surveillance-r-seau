import type { ReactElement, ReactNode, SVGProps } from 'react'

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  size?: number
}

function Svg({ size = 18, children, ...rest }: IconProps & { children: ReactNode }): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  )
}

export const IconDashboard = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7.5" height="8.5" rx="2" />
    <rect x="13.5" y="3" width="7.5" height="5.5" rx="2" />
    <rect x="13.5" y="11.5" width="7.5" height="9.5" rx="2" />
    <rect x="3" y="14.5" width="7.5" height="6.5" rx="2" />
  </Svg>
)

export const IconRadar = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <path d="M12 12l6.4-6.4" />
  </Svg>
)

export const IconDevices = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="4" width="19" height="12.5" rx="2" />
    <path d="M8 20.5h8M12 16.5v4" />
  </Svg>
)

export const IconTraffic = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12h3.5l2.5-7 4 14 2.5-7H21" />
  </Svg>
)

export const IconConnections = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9.5 14.5l5-5" />
    <path d="M7.2 17.8l-1 1a3.5 3.5 0 01-5-5l2.6-2.6a3.5 3.5 0 015 0" />
    <path d="M16.8 6.2l1-1a3.5 3.5 0 015 5l-2.6 2.6a3.5 3.5 0 01-5 0" />
  </Svg>
)

export const IconBell = (p: IconProps) => (
  <Svg {...p}>
    <path d="M18 8.5a6 6 0 10-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5" />
    <path d="M10.3 19a2 2 0 003.4 0" />
  </Svg>
)

export const IconHistory = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12l3.2 2" />
  </Svg>
)

export const IconDiagnostics = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12h3l1.5-4 3 9 2-5h2.5l1.5 3h4.5" />
    <circle cx="19.5" cy="6" r="2" />
  </Svg>
)

export const IconMap = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="5" r="2.4" />
    <circle cx="5" cy="18" r="2.4" />
    <circle cx="19" cy="18" r="2.4" />
    <path d="M10.6 6.9L6.4 15.8M13.4 6.9l4.2 8.9M7.4 18h9.2" />
  </Svg>
)

export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2.2" />
    <circle cx="10" cy="17" r="2.2" />
  </Svg>
)

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </Svg>
)

export const IconRefresh = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20.5 12a8.5 8.5 0 10-3 6.4" />
    <path d="M20.5 5.5V12H14" />
  </Svg>
)

export const IconPlay = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 4.5l12 7.5-12 7.5z" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconStop = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconDownload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.5v11M7.5 10.5L12 15l4.5-4.5" />
    <path d="M4 18.5v1.5a1.5 1.5 0 001.5 1.5h13a1.5 1.5 0 001.5-1.5v-1.5" />
  </Svg>
)

export const IconUpload = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 15V4M7.5 8.5L12 4l4.5 4.5" />
    <path d="M4 18.5v1.5a1.5 1.5 0 001.5 1.5h13a1.5 1.5 0 001.5-1.5v-1.5" />
  </Svg>
)

export const IconWifi = (p: IconProps) => (
  <Svg {...p}>
    <path d="M2.5 8.5a15 15 0 0119 0M5.8 12.2a10 10 0 0112.4 0M9.2 15.8a5 5 0 015.6 0" />
    <circle cx="12" cy="19.2" r="1.1" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconEthernet = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="7" width="18" height="10" rx="2" />
    <path d="M7 11v2M10.5 11v2M14 11v2M17.5 11v2" />
  </Svg>
)

export const IconGlobe = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3c2.6 2.4 4 5.6 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.6-4-9s1.4-6.6 4-9z" />
  </Svg>
)

export const IconShield = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3l7.5 3v5.5c0 4.6-3.1 8.3-7.5 9.5-4.4-1.2-7.5-4.9-7.5-9.5V6z" />
    <path d="M9 12l2.2 2.2L15.5 10" />
  </Svg>
)

export const IconCheck = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4.5 12.5l5 5L20 7" />
  </Svg>
)

export const IconX = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
)

export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3.8L21 19.5H3z" />
    <path d="M12 9.5v4.2M12 16.6v.1" />
  </Svg>
)

export const IconInfo = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.8v.1" />
  </Svg>
)

export const IconChevronRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 5l7 7-7 7" />
  </Svg>
)

export const IconChevronDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 9l7 7 7-7" />
  </Svg>
)

export const IconPlus = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const IconTrash = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M9.5 7V5.5A1.5 1.5 0 0111 4h2a1.5 1.5 0 011.5 1.5V7" />
    <path d="M6.5 7l.8 12a1.5 1.5 0 001.5 1.4h6.4a1.5 1.5 0 001.5-1.4L17.5 7" />
    <path d="M10.5 11v5M13.5 11v5" />
  </Svg>
)

export const IconEdit = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 20h4l11-11a2.1 2.1 0 00-3-3L5 17z" />
    <path d="M14.5 6.5l3 3" />
  </Svg>
)

export const IconCopy = (p: IconProps) => (
  <Svg {...p}>
    <rect x="9" y="9" width="11.5" height="11.5" rx="2" />
    <path d="M15 6.5V5a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2h1.5" />
  </Svg>
)

export const IconExternal = (p: IconProps) => (
  <Svg {...p}>
    <path d="M14 4h6v6M20 4l-8.5 8.5" />
    <path d="M18 14v4.5A1.5 1.5 0 0116.5 20h-11A1.5 1.5 0 014 18.5v-11A1.5 1.5 0 015.5 6H10" />
  </Svg>
)

export const IconMinimize = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14" />
  </Svg>
)

export const IconMaximize = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5.5" y="5.5" width="13" height="13" rx="1.5" />
  </Svg>
)

export const IconRestore = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4.5" y="8" width="11" height="11" rx="1.5" />
    <path d="M8.5 8V5.5A1.5 1.5 0 0110 4h8a1.5 1.5 0 011.5 1.5v8A1.5 1.5 0 0118 15h-2.5" />
  </Svg>
)

export const IconArrowUp = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Svg>
)

export const IconArrowDown = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </Svg>
)

export const IconTag = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 12.5L12.5 20a2 2 0 01-2.8 0L4 14.3V4h10.3l5.7 5.7a2 2 0 010 2.8z" />
    <circle cx="8.2" cy="8.2" r="1.2" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconDatabase = (p: IconProps) => (
  <Svg {...p}>
    <ellipse cx="12" cy="6" rx="8" ry="3" />
    <path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
    <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
  </Svg>
)

export const IconFolder = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 7.5A1.5 1.5 0 014.5 6h4l2 2.5h9A1.5 1.5 0 0121 10v8a1.5 1.5 0 01-1.5 1.5h-15A1.5 1.5 0 013 18z" />
  </Svg>
)

export const IconFile = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3h8l4 4v14H6z" />
    <path d="M14 3v4h4M9 12h6M9 16h6" />
  </Svg>
)

export const IconFilter = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 5h18l-7 8v6l-4 2v-8z" />
  </Svg>
)

export const IconLock = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4.5" y="10" width="15" height="10.5" rx="2" />
    <path d="M8 10V7.5a4 4 0 018 0V10" />
  </Svg>
)

export const IconZap = (p: IconProps) => (
  <Svg {...p}>
    <path d="M13 3L5 13.5h5.5L11 21l8-10.5h-5.5z" />
  </Svg>
)

export const IconUsers = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.4" />
    <path d="M2.5 20a6.5 6.5 0 0113 0" />
    <path d="M16 5.2a3.4 3.4 0 010 6.6M17.5 14.2A6.5 6.5 0 0121.5 20" />
  </Svg>
)

export const IconClock = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5V12l3.2 2" />
  </Svg>
)

export const IconServer = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="4" width="18" height="6.5" rx="1.6" />
    <rect x="3" y="13.5" width="18" height="6.5" rx="1.6" />
    <path d="M7 7.2h.1M7 16.8h.1" />
  </Svg>
)

export const IconCpu = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
    <path d="M10 3v3.5M14 3v3.5M10 17.5V21M14 17.5V21M3 10h3.5M3 14h3.5M17.5 10H21M17.5 14H21" />
  </Svg>
)

export const IconPrinter = (p: IconProps) => (
  <Svg {...p}>
    <path d="M7 8V3.5h10V8" />
    <rect x="3.5" y="8" width="17" height="7.5" rx="1.8" />
    <path d="M7 13.5h10v7H7z" />
  </Svg>
)

export const IconSmartphone = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6.5" y="2.5" width="11" height="19" rx="2.4" />
    <path d="M10.5 5.5h3" />
    <circle cx="12" cy="18.3" r="0.9" fill="currentColor" stroke="none" />
  </Svg>
)

export const IconTablet = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="3" width="16" height="18" rx="2.4" />
    <path d="M10.5 18h3" />
  </Svg>
)

export const IconTv = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="5" width="19" height="12" rx="2" />
    <path d="M8 20.5h8M12 17v3.5" />
  </Svg>
)

export const IconGamepad = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8.5 7.5h7a5 5 0 015 5v1.2a3.3 3.3 0 01-6 1.7l-.6-1h-5.8l-.6 1a3.3 3.3 0 01-6-1.7V12.5a5 5 0 015-5z" />
    <path d="M7 10.5v3M5.5 12h3M16 11.5h.1M18 13h.1" />
  </Svg>
)

export const IconCamera = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 8.5A1.5 1.5 0 014.5 7h2.2l1.4-2h7.8l1.4 2h2.2A1.5 1.5 0 0121 8.5v9A1.5 1.5 0 0119.5 19h-15A1.5 1.5 0 013 17.5z" />
    <circle cx="12" cy="13" r="3.4" />
  </Svg>
)

export const IconSpeaker = (p: IconProps) => (
  <Svg {...p}>
    <rect x="5.5" y="2.5" width="13" height="19" rx="2.4" />
    <circle cx="12" cy="15.5" r="3.2" />
    <circle cx="12" cy="7" r="1.4" />
  </Svg>
)

export const IconRouter = (p: IconProps) => (
  <Svg {...p}>
    <rect x="2.5" y="13" width="19" height="7" rx="2" />
    <path d="M6.5 16.5h.1M10 16.5h.1" />
    <path d="M12 10V4M8.5 6.5a5 5 0 017 0" />
  </Svg>
)

export const IconLaptop = (p: IconProps) => (
  <Svg {...p}>
    <rect x="4" y="4.5" width="16" height="11" rx="1.8" />
    <path d="M2 19h20l-1.5-3.5H3.5z" />
  </Svg>
)

export const IconHelp = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.3 9.2a2.8 2.8 0 015.4.9c0 1.9-2.7 2.2-2.7 3.9" />
    <path d="M12 17.4v.1" />
  </Svg>
)

export const IconMenu = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Svg>
)

export const IconSun = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />
  </Svg>
)

export const IconMoon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M20 14.5A8.5 8.5 0 019.5 4 8.5 8.5 0 1020 14.5z" />
  </Svg>
)
