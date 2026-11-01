import { Home, Search, ShoppingBasket, Star, Sparkles, LineChart, Settings, Zap, Swords, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Shown in the mobile bottom nav (exactly 5). */
  mobile: boolean;
  /** Short label for the cramped mobile bar. */
  short?: string;
}

/** Desktop sidebar order. Mobile bottom nav = Home, Fast, Search, Battle, Watchlist. */
export const NAV: NavItem[] = [
  { href: "/", label: "Home", icon: Home, mobile: true },
  { href: "/fast", label: "Fast Commerce", short: "Fast", icon: Zap, mobile: true },
  { href: "/search", label: "E-Com Search", short: "Search", icon: Search, mobile: true },
  { href: "/battle", label: "Live Deal Battle", short: "Battle", icon: Swords, mobile: true },
  { href: "/watchlist", label: "Watchlist", icon: Star, mobile: true },
  { href: "/basket", label: "Smart Basket", icon: ShoppingBasket, mobile: false },
  { href: "/assistant", label: "Assistant", icon: Sparkles, mobile: false },
  { href: "/history", label: "Price History", icon: LineChart, mobile: false },
  { href: "/settings", label: "Settings", icon: Settings, mobile: false },
];
