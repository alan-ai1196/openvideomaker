import type { ReactNode, SVGProps } from 'react';

/** Minimal 16x16 stroke icons, currentColor, one controlled accent applied by CSS. */

function Icon({ children, ...rest }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const PlayIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4.5 3.5v9l8-4.5z" fill="currentColor" stroke="none" />
  </Icon>
);

export const PauseIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M5 3.5v9M11 3.5v9" />
  </Icon>
);

export const UndoIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3 6h7a3.5 3.5 0 0 1 0 7H6" />
    <path d="M6 3.5L3 6l3 2.5" />
  </Icon>
);

export const RedoIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M13 6H6a3.5 3.5 0 0 0 0 7h4" />
    <path d="M10 3.5L13 6l-3 2.5" />
  </Icon>
);

export const ZoomInIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="6.5" cy="6.5" r="3.5" />
    <path d="M9.5 9.5L13 13M6.5 5.5v2M5.5 6.5h2" />
  </Icon>
);

export const ZoomOutIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="6.5" cy="6.5" r="3.5" />
    <path d="M9.5 9.5L13 13M5.5 6.5h2" />
  </Icon>
);

export const TrashIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9.5h6.6L12 4M6.5 6.5v4.5M9.5 6.5v4.5" />
  </Icon>
);

export const SunIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="3" />
    <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1" />
  </Icon>
);

export const MoonIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M13.5 9.5A6 6 0 0 1 6.5 2.5a6 6 0 1 0 7 7z" />
  </Icon>
);

export const DownloadIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M8 2.5v7M5 6.5l3 3 3-3M2.5 13.5h11" />
  </Icon>
);

export const UploadIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M8 9.5v-7M5 5.5l3-3 3 3M2.5 13.5h11" />
  </Icon>
);

export const KeyboardIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="1.5" y="4" width="13" height="8.5" rx="1.5" />
    <path d="M4 7h.01M6.5 7h.01M9 7h.01M11.5 7h.01M4.5 10h7" />
  </Icon>
);

export const SkipStartIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M12.5 3.5v9L5.5 8z M5.5 3.5v9" />
  </Icon>
);

export const FilmIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
    <path d="M5 2.5v11M11 2.5v11M1.5 6h3.5M11 6h3.5M1.5 10h3.5M11 10h3.5" />
  </Icon>
);

export const TypeIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4.5 4.5L8 2.5l3.5 2V13.5H4.5zM6 6.5h4M8 6.5v5" />
  </Icon>
);

export const AgentIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3 3.5h10v6H6.5L3 12.5v-9z" />
    <path d="M9.5 1.5l.4 1.2 1.2.4-1.2.4-.4 1.2-.4-1.2-1.2-.4 1.2-.4z" />
  </Icon>
);

export const TranscriptIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M2.5 3.5h11M2.5 7h11M2.5 10.5h6" />
    <circle cx="11.5" cy="10.5" r="1.5" />
  </Icon>
);

export const CaptionsIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="1.5" y="5" width="13" height="6" rx="1" />
    <path d="M3.5 7.5h4M3.5 9.5h6M10.5 9.5h2" />
  </Icon>
);

export const WaveIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M2.5 8V6M5 8V4M7.5 8V6M10 8V4M12.5 8V6M2.5 8v2M5 4v6M7.5 6v4M10 4v6M12.5 6v4" />
  </Icon>
);

export const PersonIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="8" cy="5" r="2.5" />
    <path d="M3 13.5c.5-2.5 2.5-3.5 5-3.5s4.5 1 5 3.5" />
  </Icon>
);

export const SparkIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M8 2l1.2 3.8L13 7l-3.8 1.2L8 12 6.8 8.2 3 7l3.8-1.2zM12.5 10.5l.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6z" />
  </Icon>
);

export const GridIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="2" y="2" width="5" height="5" rx="1" />
    <rect x="9" y="2" width="5" height="5" rx="1" />
    <rect x="2" y="9" width="5" height="5" rx="1" />
    <rect x="9" y="9" width="5" height="5" rx="1" />
  </Icon>
);

export const XIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
  </Icon>
);

export const CheckIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M2.5 8.5l3.5 3.5 7.5-8" />
  </Icon>
);
