import { describe, expect, it } from "vitest";
import { extractFromMarkdown, pickProductImage } from "../extract";
import { isRelevantOfferText } from "../match";

// Shape of a real Amazon.in product page as returned by TinyFish Fetch (trimmed), 2026-11-01.
const AMAZON = [
  "# Add to your order",
  "",
  "Acko 1 Year Screen Damage Protection Plan for Phones Between Rs 50,001-70,000 (Email Delivery)",
  "  from Acko ",
  "",
  " ₹2,799.00",
  "",
  "# Samsung Galaxy S24 5G AI Smartphone",
  "",
  "₹54,500.00 with 27 percent savings",
  "",
  "M.R.P.: ₹74,999.00",
  "",
  "**EMI** starts at ₹1,916 per month.",
  "",
  "## Price",
  "",
  "One-time purchase: ₹54,500.00  27% Savings",
  "",
  "In stock",
  "",
  "Add to Cart",
].join("\n");

describe("Amazon extraction", () => {
  it("ignores the 'Add to your order' add-on block, reads the real price and the full variant title", () => {
    const ex = extractFromMarkdown(AMAZON, {
      title: "Samsung Galaxy S24 5G AI Smartphone",
      description: "Samsung Galaxy S24 5G AI Smartphone (Amber Yellow, 8GB, 128GB Storage) : Amazon.in: Electronics",
    });
    expect(ex.price).toBe(54500);
    expect(ex.mrp).toBe(74999);
    expect(ex.title).toBe("Samsung Galaxy S24 5G AI Smartphone (Amber Yellow, 8GB, 128GB Storage)");
    expect(ex.availability).toBe("in_stock");
  });

  it("never takes a price from a 'Between Rs X-Y' range", () => {
    const ex = extractFromMarkdown("# Phone X\n\nProtection plan for phones between Rs 50,001-70,000\n\nPrice: ₹61,990");
    expect(ex.price).toBe(61990);
  });
});

describe("pickProductImage", () => {
  it("skips logos, sprites, tracking pixels, promos and thumbnails", () => {
    expect(
      pickProductImage([
        "https://static-assets-web.flixcart.com/batman-returns/batman-returns/p/images/fk-mp-c815b6.svg",
        "https://rukminim2.flixcart.com/www/1600/1600/promos/29/10/2026/x.png?q=80",
        "https://rukminim2.flixcart.com/image/800/1070/xif0q/mobile/r/8/1/-original-imahfz2tenzpsd3p.jpeg?q=80",
      ]),
    ).toBe("https://rukminim2.flixcart.com/image/800/1070/xif0q/mobile/r/8/1/-original-imahfz2tenzpsd3p.jpeg?q=80");
    expect(
      pickProductImage([
        "https://fls-eu.amazon.in/1/batch/1/OP/A21:523$uedata=s",
        "https://m.media-amazon.com/images/G/31/gno/sprites/nav-sprite-global-1x._CB546381437_.png",
        "https://m.media-amazon.com/images/I/41iQj3mv+8L._SL75_.jpg",
        "https://m.media-amazon.com/images/I/71jOyQ1HLqL._SX342_.jpg",
        "https://m.media-amazon.com/images/I/71jOyQ1HLqL._SL1500_.jpg",
      ]),
    ).toBe("https://m.media-amazon.com/images/I/71jOyQ1HLqL._SL1500_.jpg");
    expect(pickProductImage(["https://example.com/logo.svg"])).toBeUndefined();
  });
});

describe("non-price rupee amounts (real pages, 2026-11-01)", () => {
  it("ignores a free-gift value ('Worth₹3,199Free') and return-policy thresholds", () => {
    const vijay = extractFromMarkdown("# HP Victus Gaming Laptop RTX 4050\n\nFree gift: Backpack Worth₹3,199Free\n\nOffer Price ₹69,990\n\nAdd to Cart");
    expect(vijay.price).toBe(69990);
    const amz = extractFromMarkdown("# ASUS Gaming V16 RTX 4050\n\n**For products worth more than INR 25000, we only offer Self-Return option.\n\n₹74,990.00 with 25 percent savings\n\nAdd to Cart");
    expect(amz.price).toBe(74990);
  });
});

describe("offer relevance (real Flipkart S24 page lines)", () => {
  const phone = "Samsung Galaxy S24 5G (256 GB Storage, 8 GB RAM)";
  it("drops promotions for other categories, keeps bank/exchange lines", () => {
    expect(isRelevantOfferText("Unlock Air fryer coupon • 10% off", phone)).toBe(false);
    expect(isRelevantOfferText("Unlock Storage Devices coupon • 10% off", phone)).toBe(false);
    expect(isRelevantOfferText("Bank offers", phone)).toBe(true);
    expect(isRelevantOfferText("Exchange offer", phone)).toBe(true);
    expect(isRelevantOfferText("10% instant discount on HDFC Bank credit cards", phone)).toBe(true);
    expect(isRelevantOfferText("Laptop bag coupon 20% off", "HP Victus Gaming Laptop RTX 4050")).toBe(true);
  });
});

