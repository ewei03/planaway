import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Viewers } from "@/components/Viewers";

const people = ["Ana", "Ben", "Cai", "Dev", "Eve"].map((name, i) => ({ id: `u${i}`, name }));

describe("Viewers", () => {
  it("renders nothing when nobody else is viewing", () => {
    const { container } = render(<Viewers viewers={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows each viewer's initial, with their name on hover", () => {
    render(<Viewers viewers={people.slice(0, 2)} />);
    expect(screen.getByRole("group", { name: "Also viewing: Ana, Ben" })).toBeInTheDocument();
    expect(screen.getByTitle("Ana is viewing")).toHaveTextContent("A");
    expect(screen.getByTitle("Ben is viewing")).toHaveTextContent("B");
  });

  it("gives each person a stable color", () => {
    const { unmount } = render(<Viewers viewers={[people[0]]} />);
    const color = screen.getByTitle("Ana is viewing").style.background;
    unmount();
    render(<Viewers viewers={[people[1], people[0]]} />);
    expect(screen.getByTitle("Ana is viewing").style.background).toBe(color);
  });

  it("collapses everyone past the third into +N", () => {
    render(<Viewers viewers={people} />);
    expect(screen.getAllByTitle(/is viewing$/)).toHaveLength(3);
    expect(screen.getByTitle("Dev, Eve")).toHaveTextContent("+2");
  });
});
