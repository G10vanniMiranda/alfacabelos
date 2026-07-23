import type { SVGProps } from "react";

export type IconName =
  | "access"
  | "agenda"
  | "barber"
  | "block"
  | "clock"
  | "dashboard"
  | "gallery"
  | "logout"
  | "menu"
  | "money"
  | "scissors"
  | "x";

const paths: Record<IconName, React.ReactNode> = {
  access: <><circle cx="12" cy="8" r="3" /><path d="M6 20v-1a6 6 0 0 1 12 0v1M18 8h3m-1.5-1.5v3" /></>,
  agenda: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 3v4m8-4v4M3 10h18m-14 4h2m3 0h2m3 0h1m-11 3h2m3 0h2" /></>,
  barber: <><circle cx="12" cy="8" r="3.5" /><path d="M5.5 21a6.5 6.5 0 0 1 13 0M8 8c1.5-.3 3-1.4 4-3 1 1.6 2.5 2.7 4 3" /></>,
  block: <><circle cx="12" cy="12" r="9" /><path d="m5.7 5.7 12.6 12.6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>,
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  gallery: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m3 17 5-5 4 4 3-3 6 6" /></>,
  logout: <><path d="M10 5H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h5M14 8l4 4-4 4m4-4H9" /></>,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  money: <><circle cx="12" cy="12" r="9" /><path d="M15.5 8.5c-.7-.7-1.8-1-3-1-1.7 0-3 .8-3 2s1.1 1.8 3 2.2 3 1 3 2.3-1.3 2.2-3 2.2c-1.3 0-2.5-.4-3.3-1.2M12.5 5v14" /></>,
  scissors: <><circle cx="6" cy="7" r="3" /><circle cx="6" cy="17" r="3" /><path d="m8.7 8.3 11.3 6.2M8.7 15.7 20 9.5" /></>,
  x: <path d="m6 6 12 12M18 6 6 18" />,
};

export function Icon({ name, ...props }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
