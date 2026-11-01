import { Home, Search, ShoppingBasket, Star, Sparkles, LineChart, Settings, type LucideIcon } from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  mobile: boolean;
}

export const NAV: NavItem[] = [
  { href: "/", label: "Home", icon: Home, mobile: true },
  { href: "/search", label: "Search", icon: Search, mobile: true },
  { href: "/basket", label: "Basket", icon: ShoppingBasket, mobile: true },
  { href: "/watchlist", label: "Watchlist", icon: Star, mobile: true },
  { href: "/assistant", label: "Assistant", icon: Sparkles, mobile: true },
  { href: "/history", label: "History", icon: LineChart, mobile: false },
  { href: "/settings", label: "Settings", icon: Settings, mobile: false },
];
