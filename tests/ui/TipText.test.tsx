import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TipText } from "@/components/TipText";

const show = (text: string) => render(<p><TipText text={text} /></p>).container.firstElementChild!;
const keys = (el: Element) => [...el.querySelectorAll(".tip-key")].map((e) => e.textContent);
const figures = (el: Element) => [...el.querySelectorAll(".tip-figure")].map((e) => e.textContent);

describe("TipText", () => {
  it("bolds the key phrase the agent marked, without the asterisks", () => {
    const el = show("Buy a **72-hour transit pass** at the airport.");
    expect(el.textContent).toBe("Buy a 72-hour transit pass at the airport.");
    expect(keys(el)).toEqual(["72-hour transit pass"]);
    expect(el.querySelector(".tip-key")!.tagName).toBe("STRONG");
  });

  it("highlights prices, times, and durations", () => {
    const el = show("Entry is ¥500 (about $3.40); arrive by 7:30am, the line takes 30 minutes and lasts 2–3 hours.");
    expect(figures(el)).toEqual(["¥500", "$3.40", "7:30am", "30 minutes", "2–3 hours"]);
  });

  it("recognizes written-out currencies and 24-hour times", () => {
    const el = show("A day pass costs 1,100 yen; the last train is at 23:15.");
    expect(figures(el)).toEqual(["1,100 yen", "23:15"]);
  });

  it("leaves ordinary numbers and words alone", () => {
    const el = show("Line 2 of the subway, exit 4, has 3 escalators. Amazing.");
    expect(figures(el)).toEqual([]);
    expect(el.textContent).toBe("Line 2 of the subway, exit 4, has 3 escalators. Amazing.");
  });

  it("combines both, keeping figures outside the key phrase", () => {
    const el = show("**Book ahead**: tours sell out and cost €25.");
    expect(keys(el)).toEqual(["Book ahead"]);
    expect(figures(el)).toEqual(["€25"]);
  });

  it("shows plain text, never markup, from the tip", () => {
    const el = show('<img src=x onerror="alert(1)"> **<b>bold</b>**');
    expect(el.querySelector("img")).toBeNull();
    expect(el.querySelector("b")).toBeNull();
    expect(el.textContent).toBe('<img src=x onerror="alert(1)"> <b>bold</b>');
  });
});
