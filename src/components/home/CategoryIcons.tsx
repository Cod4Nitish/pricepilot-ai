/** Original flat category illustrations (decorative). Navy lines, royal blue accents. */
const S = { fill: "none", stroke: "#1B2540", strokeWidth: 3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="16" fill="#EFF3FF" />
      {children}
    </svg>
  );
}

export function PhoneIcon() {
  return (
    <Frame>
      <rect x="21" y="10" width="22" height="44" rx="5" {...S} fill="#FFFFFF" />
      <rect x="25" y="17" width="14" height="22" rx="2" fill="#365CF5" />
      <circle cx="32" cy="47" r="2" fill="#1B2540" />
    </Frame>
  );
}

export function LaptopIcon() {
  return (
    <Frame>
      <rect x="14" y="16" width="36" height="24" rx="3" {...S} fill="#FFFFFF" />
      <rect x="18" y="20" width="28" height="16" rx="1.5" fill="#365CF5" />
      <path d="M9 44 H55 L52 49 H12 Z" {...S} fill="#FFFFFF" />
      <path d="M26 26 L23 29 L26 32 M38 26 L41 29 L38 32" stroke="#FFFFFF" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Frame>
  );
}

export function HeadphonesIcon() {
  return (
    <Frame>
      <path d="M16 36 C16 18 48 18 48 36" {...S} strokeWidth={4} />
      <rect x="12" y="33" width="10" height="16" rx="4" {...S} fill="#365CF5" />
      <rect x="42" y="33" width="10" height="16" rx="4" {...S} fill="#365CF5" />
    </Frame>
  );
}

export function TvIcon() {
  return (
    <Frame>
      <rect x="10" y="14" width="44" height="28" rx="3" {...S} fill="#FFFFFF" />
      <rect x="14" y="18" width="36" height="20" rx="1.5" fill="#365CF5" />
      <path d="M26 50 H38 M32 42 V50" {...S} />
    </Frame>
  );
}

export function GamepadIcon() {
  return (
    <Frame>
      <path d="M18 22 H46 C52 22 56 30 56 38 C56 46 50 48 46 44 L42 40 H22 L18 44 C14 48 8 46 8 38 C8 30 12 22 18 22 Z" {...S} fill="#FFFFFF" />
      <path d="M20 28 V36 M16 32 H24" {...S} />
      <circle cx="42" cy="29" r="2.5" fill="#365CF5" />
      <circle cx="46" cy="34" r="2.5" fill="#365CF5" />
    </Frame>
  );
}

export function HomeIcon() {
  return (
    <Frame>
      <rect x="20" y="10" width="24" height="44" rx="6" {...S} fill="#FFFFFF" />
      <circle cx="32" cy="27" r="8" fill="#365CF5" />
      <circle cx="32" cy="27" r="3" fill="#FFFFFF" />
      <path d="M26 42 H38 M26 47 H38" {...S} strokeWidth={2.5} />
    </Frame>
  );
}
