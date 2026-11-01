import { describe, expect, it } from "vitest";
import { classifyOne, heuristicIntent, splitRequests } from "../intent";

describe("intent router", () => {
  it("routes groceries to quick commerce", () => {
    expect(classifyOne("1 litre amul milk").mode).toBe("quick");
    expect(classifyOne("onion 1kg").mode).toBe("quick");
    expect(classifyOne("maggi noodles").mode).toBe("quick");
  });
  it("routes specced products to e-commerce", () => {
    expect(classifyOne("Samsung Galaxy S24 256GB").mode).toBe("ecommerce");
    expect(classifyOne("Sony WH-1000XM5").mode).toBe("ecommerce");
    expect(classifyOne("gaming laptop under 70000").mode).toBe("ecommerce");
  });
  it("checks both for ambiguous items and urgency", () => {
    expect(classifyOne("phone charger").mode).toBe("both");
    expect(classifyOne("iphone 16 today").mode).toBe("both");
  });
  it("splits multi-item requests and picks overall mode", () => {
    expect(splitRequests("milk, eggs and Samsung Galaxy S24")).toHaveLength(3);
    const r = heuristicIntent("milk, eggs and Samsung Galaxy S24");
    expect(r.items.map((i) => i.mode)).toEqual(["quick", "quick", "ecommerce"]);
    expect(r.overall).toBe("both");
  });
  it("does not split a single product name", () => {
    expect(splitRequests("Tom and Jerry DVD")).toHaveLength(1);
  });
});
