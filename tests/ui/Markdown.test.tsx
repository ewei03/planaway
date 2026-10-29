import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Markdown } from "@/components/Markdown";

describe("Markdown", () => {
  it("renders paragraphs with line breaks", () => {
    const { container } = render(<Markdown text={"First line\nsecond line\n\nNew paragraph"} />);
    const ps = container.querySelectorAll("p");
    expect(ps).toHaveLength(2);
    expect(ps[0].querySelectorAll("br")).toHaveLength(1);
  });

  it("renders bullet and numbered lists", () => {
    const { container } = render(<Markdown text={"- one\n* two\n3. three"} />);
    expect([...container.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["one", "two", "three"]);
  });

  it("renders a mixed block as a paragraph, not a list", () => {
    const { container } = render(<Markdown text={"Intro:\n- one"} />);
    expect(container.querySelector("ul")).toBeNull();
  });

  it("renders bold, italic, and links", () => {
    render(<Markdown text="**Bold** and *italic* and [a link](https://example.com/x)" />);
    expect(screen.getByText("Bold").tagName).toBe("STRONG");
    expect(screen.getByText("italic").tagName).toBe("EM");
    const link = screen.getByRole("link", { name: "a link" });
    expect(link).toHaveAttribute("href", "https://example.com/x");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("only links http(s) URLs", () => {
    render(<Markdown text="[click](javascript:alert(1)) [file](file:///etc/passwd)" />);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("never renders HTML from the text", () => {
    const { container } = render(<Markdown text={'<img src=x onerror="alert(1)"> <script>alert(1)</script>'} />);
    expect(container.querySelector("img, script")).toBeNull();
    expect(container.textContent).toContain("<img");
  });

  it("does not treat a lone asterisk as italic", () => {
    const { container } = render(<Markdown text="5 * 3 = 15" />);
    expect(container.querySelector("em")).toBeNull();
  });
});
