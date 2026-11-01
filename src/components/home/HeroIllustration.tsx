/** Original flat illustration: laptop, smartphone and over-ear headphones. Decorative only. */
export default function HeroIllustration({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 480 360" className={className} aria-hidden="true" focusable="false">
      <rect x="0" y="0" width="480" height="360" rx="28" fill="#EFF3FF" />
      <circle cx="400" cy="70" r="34" fill="#DCE4FF" />
      <circle cx="70" cy="300" r="22" fill="#DCE4FF" />
      {/* Laptop */}
      <rect x="92" y="88" width="250" height="160" rx="12" fill="#FFFFFF" stroke="#1B2540" strokeWidth="4" />
      <rect x="108" y="104" width="218" height="128" rx="6" fill="#365CF5" />
      <rect x="124" y="122" width="96" height="10" rx="5" fill="#FFFFFF" />
      <rect x="124" y="142" width="150" height="8" rx="4" fill="#AFC0FF" />
      <rect x="124" y="160" width="120" height="8" rx="4" fill="#AFC0FF" />
      <rect x="124" y="186" width="60" height="26" rx="13" fill="#FFFFFF" />
      <path d="M70 248 H364 L350 270 H84 Z" fill="#FFFFFF" stroke="#1B2540" strokeWidth="4" strokeLinejoin="round" />
      <rect x="192" y="252" width="50" height="6" rx="3" fill="#1B2540" />
      {/* Smartphone */}
      <rect x="318" y="140" width="92" height="170" rx="16" fill="#FFFFFF" stroke="#1B2540" strokeWidth="4" />
      <rect x="328" y="158" width="72" height="128" rx="6" fill="#EFF3FF" />
      <rect x="350" y="148" width="28" height="4" rx="2" fill="#1B2540" />
      <rect x="338" y="170" width="52" height="40" rx="6" fill="#365CF5" />
      <rect x="338" y="220" width="40" height="7" rx="3.5" fill="#1B2540" />
      <rect x="338" y="234" width="52" height="6" rx="3" fill="#AFC0FF" />
      <rect x="338" y="256" width="52" height="18" rx="9" fill="#365CF5" />
      <circle cx="364" cy="298" r="4" fill="#1B2540" />
      {/* Headphones */}
      <path d="M44 214 C44 150 156 150 156 214" fill="none" stroke="#1B2540" strokeWidth="10" strokeLinecap="round" />
      <path d="M44 214 C44 150 156 150 156 214" fill="none" stroke="#365CF5" strokeWidth="4" strokeLinecap="round" />
      <rect x="30" y="204" width="34" height="56" rx="14" fill="#365CF5" stroke="#1B2540" strokeWidth="4" />
      <rect x="136" y="204" width="34" height="56" rx="14" fill="#365CF5" stroke="#1B2540" strokeWidth="4" />
      <rect x="54" y="214" width="12" height="36" rx="5" fill="#FFFFFF" stroke="#1B2540" strokeWidth="3" />
      <rect x="134" y="214" width="12" height="36" rx="5" fill="#FFFFFF" stroke="#1B2540" strokeWidth="3" />
    </svg>
  );
}
