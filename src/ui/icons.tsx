import type { ReactNode } from 'react'

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const SelectionIcon = () => (
  <Icon>
    <path d="M5 3.5 L5 15.5 L8.2 12.6 L10.6 17 L12.4 16.1 L10.1 11.8 L14.5 11.6 Z" />
  </Icon>
)

export const HandIcon = () => (
  <Icon>
    <path d="M7 10V4.8a1.2 1.2 0 0 1 2.4 0V9M9.4 8.4V3.8a1.2 1.2 0 0 1 2.4 0V9M11.8 9V5a1.2 1.2 0 0 1 2.4 0v6.5M7 10 5.6 8.6a1.2 1.2 0 0 0-1.8 1.6L7 15.5c1 1.6 2.4 2.5 4.2 2.5 2.6 0 4-1.8 4-4.2v-2.3" />
  </Icon>
)

export const RectangleIcon = () => (
  <Icon>
    <rect x="3.5" y="5" width="13" height="10" rx="1" />
  </Icon>
)

export const EllipseIcon = () => (
  <Icon>
    <ellipse cx="10" cy="10" rx="7" ry="5.5" />
  </Icon>
)

export const DiamondIcon = () => (
  <Icon>
    <path d="M10 3 L17 10 L10 17 L3 10 Z" />
  </Icon>
)

export const ArrowIcon = () => (
  <Icon>
    <path d="M4 16 L16 4M9 4h7v7" />
  </Icon>
)

export const LineIcon = () => (
  <Icon>
    <path d="M4 16 L16 4" />
  </Icon>
)

export const TextIcon = () => (
  <Icon>
    <path d="M5 5V4h10v1M10 4v12M8 16h4" />
  </Icon>
)

export const MinusIcon = () => (
  <Icon>
    <path d="M5 10h10" />
  </Icon>
)

export const PlusIcon = () => (
  <Icon>
    <path d="M5 10h10M10 5v10" />
  </Icon>
)

export const DownloadIcon = () => (
  <Icon>
    <path d="M10 3.5v9M6.5 9.5 10 13l3.5-3.5M4 16h12" />
  </Icon>
)

export const UndoIcon = () => (
  <Icon>
    <path d="M7 5 3.5 8.5 7 12M4 8.5h7a4.5 4.5 0 0 1 0 9H8" />
  </Icon>
)

export const RedoIcon = () => (
  <Icon>
    <path d="M13 5l3.5 3.5L13 12M16 8.5H9a4.5 4.5 0 0 0 0 9h3" />
  </Icon>
)

export const HelpIcon = () => (
  <Icon>
    <path d="M7.8 7.6a2.3 2.3 0 1 1 3.4 2c-.8.5-1.2 1-1.2 1.9M10 14.6v.1" />
  </Icon>
)

export const FileIcon = () => (
  <Icon>
    <path d="M5 3.5h6.5L15 7v9.5H5zM11.5 3.5V7H15" />
  </Icon>
)

export const TemplateIcon = () => (
  <Icon>
    <path d="M3.5 4.5h13v3h-13zM3.5 10.5h5.5v5h-5zM12 10.5h4.5v5H12z" />
  </Icon>
)

export const ChevronIcon = () => (
  <Icon>
    <path d="m6 8 4 4 4-4" />
  </Icon>
)

export const CloseIcon = () => (
  <Icon>
    <path d="M5.5 5.5l9 9M14.5 5.5l-9 9" />
  </Icon>
)

export const WidthIcon = ({ w }: { w: number }) => (
  <Icon>
    <path d="M3.5 10h13" strokeWidth={w} />
  </Icon>
)

export const DashIcon = ({ style }: { style: 'solid' | 'dashed' | 'dotted' }) => (
  <Icon>
    <path
      d="M3 10h14"
      strokeWidth={2}
      strokeDasharray={style === 'dashed' ? '3.5 3' : style === 'dotted' ? '0.5 3.5' : undefined}
    />
  </Icon>
)

export const FillIcon = ({ kind }: { kind: 'solid' | 'hachure' | 'cross-hatch' }) => (
  <Icon>
    <rect x="4" y="4" width="12" height="12" rx="1" fill={kind === 'solid' ? 'currentColor' : 'none'} fillOpacity={0.35} />
    {kind !== 'solid' && <path d="M4 11 11 4M4 16 16 4M9 16l7-7" strokeWidth={1.2} />}
    {kind === 'cross-hatch' && <path d="M9 4l7 7M4 4l12 12M4 9l7 7" strokeWidth={1.2} />}
  </Icon>
)

export const RoughIcon = ({ level }: { level: 0 | 1 | 2 }) => (
  <Icon>
    <path
      d={
        level === 0
          ? 'M3 10h14'
          : level === 1
            ? 'M3 10.5q2-2.5 4-.5t4 0 4-1 2 1'
            : 'M3 11q1.5-5 3.5-1t3 0 3-4 2 3 2-1'
      }
    />
  </Icon>
)

export const EdgeIcon = ({ round }: { round: boolean }) => (
  <Icon>{round ? <path d="M4 16V9.5A5.5 5.5 0 0 1 9.5 4H16" /> : <path d="M4 16V4h12" />}</Icon>
)

export const LayerIcon = ({ kind }: { kind: 'front' | 'forward' | 'backward' | 'back' }) => (
  <Icon>
    {kind === 'front' && <path d="M4 4h12M10 17V7M6.5 10.5 10 7l3.5 3.5" />}
    {kind === 'forward' && <path d="M10 16V5M6.5 8.5 10 5l3.5 3.5" />}
    {kind === 'backward' && <path d="M10 4v11M6.5 11.5 10 15l3.5-3.5" />}
    {kind === 'back' && <path d="M4 16h12M10 3v10M6.5 9.5 10 13l3.5-3.5" />}
  </Icon>
)

export const HeadIcon = ({ kind, flip }: { kind: string; flip?: boolean }) => (
  <Icon>
    <g transform={flip ? 'translate(20 0) scale(-1 1)' : undefined}>
      <path d="M3 10h9" />
      {kind === 'arrow' && <path d="M17 10 12 6.5M17 10l-5 3.5M17 10H12" />}
      {kind === 'triangle' && <path d="M17 10l-6-4v8z" fill="currentColor" />}
      {kind === 'bar' && <path d="M15 5.5v9" />}
      {kind === 'circle' && <circle cx="14" cy="10" r="3" fill="currentColor" fillOpacity={0.35} />}
      {kind === 'diamond' && <path d="M17 10l-3.5-3.5L10 10l3.5 3.5z" fill="currentColor" fillOpacity={0.35} />}
      {kind === 'none' && <path d="M12 10h4" strokeOpacity={0} />}
    </g>
  </Icon>
)

export const CurveIcon = ({ curved, elbow = false }: { curved: boolean; elbow?: boolean }) => (
  <Icon>
    {elbow ? (
      <path d="M3.5 15h6V5h7" />
    ) : curved ? (
      <path d="M3.5 15C6 5 10 17 16.5 5" />
    ) : (
      <path d="M3.5 15 8 7l4 8 4.5-10" />
    )}
  </Icon>
)

export const PencilIcon = () => (
  <Icon>
    <path d="M13.5 4.5 15.5 6.5 7 15 4 16 5 13 Z M12 6 14 8" />
  </Icon>
)

export const EraserIcon = () => (
  <Icon>
    <path d="M8 16 L4 12 L11 5 L16 10 L10.5 15.5 H16 M7.5 8.5 L12.5 13.5" />
  </Icon>
)

export const GridIcon = () => (
  <Icon>
    <path d="M4 4 H16 V16 H4 Z M8 4 V16 M12 4 V16 M4 8 H16 M4 12 H16" />
  </Icon>
)

export const SnapIcon = () => (
  <Icon>
    <path d="M4 16 V4 M16 16 V4 M2.5 10 H17.5" strokeDasharray="2 2" />
    <rect x="7" y="7" width="6" height="6" rx="1" />
  </Icon>
)

export const LockIcon = ({ open = false }: { open?: boolean }) => (
  <Icon>
    <rect x="5" y="9" width="10" height="7" rx="1.5" />
    <path d={open ? 'M7.5 9 V6.5 a2.5 2.5 0 0 1 4.8-1' : 'M7.5 9 V6.5 a2.5 2.5 0 0 1 5 0 V9'} />
  </Icon>
)

export const DeleteNodeIcon = () => (
  <Icon>
    <path d="M3 14 L8 8 L13 11" />
    <circle cx="8" cy="8" r="2" />
    <path d="M12 5 H17" />
  </Icon>
)

export const GroupIcon =({ ungroup = false }: { ungroup?: boolean }) => (
  <Icon>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
    <rect x="9.5" y="9.5" width="7" height="7" rx="1" />
    {!ungroup && <path d="M2 2 H18 V18 H2 Z" strokeDasharray="2 2" />}
  </Icon>
)

export const FlipIcon = ({ vertical = false }: { vertical?: boolean }) => (
  <Icon>
    <g transform={vertical ? 'rotate(90 10 10)' : undefined}>
      <path d="M10 3 V17" strokeDasharray="2 2" />
      <path d="M8 6 L3.5 15 H8 Z M12 6 L16.5 15 H12 Z" />
    </g>
  </Icon>
)

export const CropIcon = ({ off = false }: { off?: boolean }) => (
  <Icon>
    <path d="M6 2.5 V14 H17.5 M2.5 6 H14 V17.5" />
    {off && <path d="M3.5 16.5 L16.5 3.5" />}
  </Icon>
)

export type AlignIconKind = 'left' | 'centerH' | 'right' | 'top' | 'middle' | 'bottom' | 'distH' | 'distV'

const ALIGN_PATHS: Record<AlignIconKind, string> = {
  left: 'M3.5 3 V17 M6.5 5.5 H15 V8.5 H6.5 Z M6.5 11.5 H11 V14.5 H6.5 Z',
  right: 'M16.5 3 V17 M13.5 5.5 H5 V8.5 H13.5 Z M13.5 11.5 H9 V14.5 H13.5 Z',
  centerH: 'M10 3 V17 M4.5 5.5 H15.5 V8.5 H4.5 Z M7 11.5 H13 V14.5 H7 Z',
  top: 'M3 3.5 H17 M5.5 6.5 V15 H8.5 V6.5 Z M11.5 6.5 V11 H14.5 V6.5 Z',
  bottom: 'M3 16.5 H17 M5.5 13.5 V5 H8.5 V13.5 Z M11.5 13.5 V9 H14.5 V13.5 Z',
  middle: 'M3 10 H17 M5.5 4.5 V15.5 H8.5 V4.5 Z M11.5 7 V13 H14.5 V7 Z',
  distH: 'M3.5 3 V17 M16.5 3 V17 M8.5 6 H11.5 V14 H8.5 Z',
  distV: 'M3 3.5 H17 M3 16.5 H17 M6 8.5 V11.5 H14 V8.5 Z',
}

export const AlignIcon = ({ kind }: { kind: AlignIconKind }) => (
  <Icon>
    <path d={ALIGN_PATHS[kind]} />
  </Icon>
)

const TEXT_ALIGN_PATHS = {
  left: 'M4 5 H16 M4 9 H12 M4 13 H16 M4 17 H11',
  center: 'M4 5 H16 M6 9 H14 M4 13 H16 M7 17 H13',
  right: 'M4 5 H16 M8 9 H16 M4 13 H16 M9 17 H16',
} as const

export const TextAlignIcon = ({ kind }: { kind: keyof typeof TEXT_ALIGN_PATHS }) => (
  <Icon>
    <path d={TEXT_ALIGN_PATHS[kind]} />
  </Icon>
)
