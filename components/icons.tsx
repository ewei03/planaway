import type { ReactNode } from "react";
import type { Itinerary } from "./client";

/** A 24×24 stroke icon. Decorative: label the button or text around it instead. */
function Icon({ size = 18, width = 1.8, children }: { size?: number; width?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

type P = { size?: number };

export function CopyIcon() {
  return (
    <Icon size={16} width={2}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </Icon>
  );
}

export function CheckIcon() {
  return (
    <Icon size={16} width={2.5}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </Icon>
  );
}

/** The PlanAway mark: a paper plane. */
export const LogoIcon = ({ size }: P) => (
  <Icon size={size} width={2}>
    <path d="M22 2 11 13" />
    <path d="M22 2 15 22l-4-9-9-4z" />
  </Icon>
);
export const PlusIcon = ({ size }: P) => (
  <Icon size={size} width={2}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);
export const ArrowRightIcon = ({ size }: P) => (
  <Icon size={size} width={2}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);
export const CloseIcon = ({ size }: P) => (
  <Icon size={size} width={2}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);
export const ChevronDownIcon = ({ size }: P) => (
  <Icon size={size} width={2}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
);
export const DownloadIcon = ({ size }: P) => (
  <Icon size={size} width={2}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </Icon>
);
export const BookmarkIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M6 3h12v18l-6-4-6 4z" />
  </Icon>
);
export const HistoryIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2" />
  </Icon>
);
export const DiceIcon = ({ size }: P) => (
  <Icon size={size}>
    <rect x="3" y="3" width="18" height="18" rx="4" />
    <circle cx="8.5" cy="8.5" r="1.1" fill="currentColor" />
    <circle cx="12" cy="12" r="1.1" fill="currentColor" />
    <circle cx="15.5" cy="15.5" r="1.1" fill="currentColor" />
  </Icon>
);
export const CommentIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
  </Icon>
);
export const CalendarIcon = ({ size }: P) => (
  <Icon size={size}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Icon>
);
export const UsersIcon = ({ size }: P) => (
  <Icon size={size}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2.2.6 3.5 2.8 3.5 6" />
  </Icon>
);
export const PlaneIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" />
  </Icon>
);
export const WalletIcon = ({ size }: P) => (
  <Icon size={size}>
    <rect x="3" y="6" width="18" height="14" rx="2" />
    <path d="M3 10h18M16 15h2" />
  </Icon>
);
export const PinIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
    <circle cx="12" cy="9.5" r="2.5" />
  </Icon>
);
export const MapIcon = ({ size }: P) => (
  <Icon size={size}>
    <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />
  </Icon>
);
export const MenuIcon = ({ size }: P) => (
  <Icon size={size} width={2}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Icon>
);

type Category = Itinerary["days"][number]["activities"][number]["category"];

const CATEGORY_PATHS: Record<Category, ReactNode> = {
  food: <path d="M3 11h18a9 9 0 0 1-18 0zM8 7c0-1.5 1-2 1-3.5M12 7c0-1.5 1-2 1-3.5M16 7c0-1.5 1-2 1-3.5" />,
  sightseeing: <path d="M3 8l9-5 9 5M5 8v11M19 8v11M9 8v11M15 8v11M2 21h20" />,
  activity: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
  transport: (
    <>
      <rect x="5" y="3" width="14" height="14" rx="3" />
      <path d="M5 11h14M8 21l2-4M16 21l-2-4" />
    </>
  ),
  lodging: (
    <>
      <path d="M3 18V6M3 13h18v5M21 18v-5a3 3 0 0 0-3-3h-7v3" />
      <circle cx="7" cy="10" r="1.5" />
    </>
  ),
  shopping: <path d="M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2" />,
  nightlife: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  rest: <path d="M4 10h13v4a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM17 11h1.5a2.5 2.5 0 0 1 0 5H17M8 3v3M12 3v3" />,
  other: (
    <>
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </>
  ),
};

export const CategoryIcon = ({ category, size }: { category: Category; size?: number }) => (
  <Icon size={size}>{CATEGORY_PATHS[category] ?? CATEGORY_PATHS.other}</Icon>
);

type WeatherKind = NonNullable<Itinerary["weather"]>["kind"];

const CLOUD = "M7 17h10a4 4 0 0 0 .4-7.98A6 6 0 0 0 6 10.2 3.5 3.5 0 0 0 7 17z";

const WEATHER_PATHS: Record<WeatherKind, ReactNode> = {
  sunny: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  partly_cloudy: (
    <>
      <path d="M8 6.5A4 4 0 0 1 14.6 6M8 2v1.5M3.8 4.2l1 1M2 9h1.5" />
      <path d="M9 20h9a3.5 3.5 0 0 0 .4-6.98A5 5 0 0 0 8.7 13 3.5 3.5 0 0 0 9 20z" />
    </>
  ),
  cloudy: <path d={CLOUD} />,
  rain: (
    <>
      <path d="M7 14h10a4 4 0 0 0 .4-7.98A6 6 0 0 0 6 7.2 3.5 3.5 0 0 0 7 14z" />
      <path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3" />
    </>
  ),
  storm: (
    <>
      <path d="M7 14h10a4 4 0 0 0 .4-7.98A6 6 0 0 0 6 7.2 3.5 3.5 0 0 0 7 14z" />
      <path d="M12.5 14l-2 4h3l-2 4" />
    </>
  ),
  snow: (
    <>
      <path d="M7 14h10a4 4 0 0 0 .4-7.98A6 6 0 0 0 6 7.2 3.5 3.5 0 0 0 7 14z" />
      <path d="M8 18h.01M12 18h.01M16 18h.01M10 21h.01M14 21h.01" strokeWidth={2.6} />
    </>
  ),
  fog: <path d="M4 9h16M3 13h18M5 17h14M8 21h8" />,
  windy: <path d="M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h8" />,
};

export const WeatherIcon = ({ kind, size }: { kind: WeatherKind; size?: number }) => (
  <Icon size={size}>{WEATHER_PATHS[kind] ?? WEATHER_PATHS.cloudy}</Icon>
);
