import Link from "next/link";
import { GamepadIcon, HeadphonesIcon, HomeIcon, LaptopIcon, PhoneIcon, TvIcon } from "./CategoryIcons";

const CATEGORIES = [
  { title: "Smartphones", text: "Compare phones across major Indian stores.", q: "Best phone under 30000", Icon: PhoneIcon },
  { title: "Gaming Laptops", text: "Find laptops built for play and work.", q: "Best gaming laptop under 80000", Icon: LaptopIcon },
  { title: "Headphones & Audio", text: "Earbuds, headphones and speakers.", q: "Best wireless earbuds under 5000", Icon: HeadphonesIcon },
  { title: "Smart TVs", text: "Screens for every room and budget.", q: "Best 55 inch smart TV under 50000", Icon: TvIcon },
  { title: "Gaming Accessories", text: "Mice, keyboards and controllers.", q: "Best gaming mouse under 3000", Icon: GamepadIcon },
  { title: "Home Electronics", text: "Purifiers and everyday home appliances.", q: "Best air purifier under 15000", Icon: HomeIcon },
];

/** "Shop by category" cards. Each card is a single link that runs a real search. */
export default function CategoryGrid() {
  return (
    <section aria-labelledby="categories">
      <h2 id="categories" className="mb-4 text-h2 font-semibold text-[#1B2540] dark:text-fg">Shop by category</h2>
      <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {CATEGORIES.map(({ title, text, q, Icon }) => (
          <li key={title} className="min-w-0">
            <Link
              href={`/shop?q=${encodeURIComponent(q)}`}
              aria-label={`${title}: search ${q}`}
              className="flex h-full min-h-11 flex-col gap-3 rounded-xl border border-[#E3E8F2] bg-white p-3 text-[#1B2540] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#365CF5] sm:flex-row sm:items-center sm:p-4 motion-safe:transition-[transform,box-shadow,border-color] motion-safe:duration-200 motion-safe:ease-out hover:border-[#365CF5] hover:shadow-[0_8px_20px_-10px_rgba(27,37,64,0.25)] motion-safe:hover:-translate-y-0.5"
            >
              <span className="shrink-0"><Icon /></span>
              <span className="min-w-0">
                <span className="block font-semibold leading-snug">{title}</span>
                <span className="mt-0.5 block text-sm leading-snug text-[#4A5570]">{text}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
