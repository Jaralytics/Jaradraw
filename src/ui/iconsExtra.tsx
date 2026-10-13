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

export const FrameIcon = () => (
  <Icon>
    <path d="M6.5 3v14M13.5 3v14M3 6.5h14M3 13.5h14" />
  </Icon>
)

export const ImageIcon = () => (
  <Icon>
    <rect x="3" y="4" width="14" height="12" rx="2" />
    <circle cx="7.5" cy="8.5" r="1.3" />
    <path d="M3.5 14.5 8 10.5l3 2.5 2-1.8 3.5 3.3" />
  </Icon>
)

export const LibraryIcon = () => (
  <Icon>
    <path d="M4 4.5h3v11H4zM8.5 4.5h3v11h-3z" />
    <path d="m13.2 5.3 2.8-.8 2 10.4-2.8.8z" />
  </Icon>
)

export const LibraryAddIcon = () => (
  <Icon>
    <path d="M4 4.5h3v11H4zM8.5 4.5h3v11h-3z" />
    <path d="M15 7v6M12 10h6" />
  </Icon>
)

export const TrashIcon = () => (
  <Icon>
    <path d="M4.5 6h11M8 6V4.5h4V6M6 6l.6 9.5h6.8L14 6" />
  </Icon>
)

export const SunIcon = () => (
  <Icon>
    <circle cx="10" cy="10" r="3" />
    <path d="M10 3v1.6M10 15.4V17M3 10h1.6M15.4 10H17M5 5l1.1 1.1M13.9 13.9 15 15M15 5l-1.1 1.1M6.1 13.9 5 15" />
  </Icon>
)

export const DuplicateIcon = () => (
  <Icon>
    <rect x="7" y="7" width="9" height="9" rx="1.5" />
    <path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" />
  </Icon>
)
