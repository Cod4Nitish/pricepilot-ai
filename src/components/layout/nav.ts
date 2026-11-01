import { Home, Search, ShoppingBasket, Star, Sparkles, LineChart, Settings, Zap, Swords, Store, MoreHorizontal, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/** Small text nav in the desktop top bar. */
export const TOP_NAV: NavItem[] = [
  { href: "/basket", label: "Basket", icon: ShoppingBasket },
  { href: "/watchlist", label: "Watchlist", icon: Star },
  { href: "/history", label: "History", icon: LineChart },
  { href: "/assistant", label: "Assistant", icon: Sparkles },
];

/** Tools and settings shown under "More". */
export const MORE_NAV: NavItem[] = [
  { href: "/battle", label: "Live Deal Battle", icon: Swords },
  { href: "/fast", label: "Fast Commerce", icon: Zap },
  { href: "/search", label: "E-Com Search", icon: Store },
  { href: "/settings", label: "Settings", icon: Settings },
];

/** Mobile bottom nav (4 links + More sheet trigger). */
export const BOTTOM_NAV: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/discover", label: "Search", icon: Search },
  { href: "/basket", label: "Basket", icon: ShoppingBasket },
  { href: "/watchlist", label: "Watchlist", icon: Star },
];

export const MORE_ICON = MoreHorizontal;

/** Pages shown in the mobile More sheet (everything not in the bottom bar). */
export const MOBILE_MORE: NavItem[] = [
  { href: "/history", label: "Price History", icon: LineChart },
  { href: "/assistant", label: "Assistant", icon: Sparkles },
  ...MORE_NAV,
];
