import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Viewers } from "@/components/Viewers";

const me = { id: "u-me", name: "Maya" };
const people = ["Ana", "Ben", "Cai", "Dev", "Eve"].map((name, i) => ({ id: `u${i}`, name }));

describe("Viewers", () => {
  it("always shows you, first", () => {
    render(<Viewers me={me} viewers={[]} />);
    expect(screen.getByRole("group", { name: "Viewing now: You" })).toBeInTheDocument();
    expect(screen.getByTitle("You (Maya)")).toHaveTextContent("M");
    expect(screen.getByTitle("You (Maya)")).toHaveClass("you");
  });

  it("shows each other viewer's initial, with their name on hover", () => {
    render(<Viewers me={me} viewers={people.slice(0, 2)} />);
    expect(screen.getByRole("group", { name: "Viewing now: You, Ana, Ben" })).toBeInTheDocument();
    expect(screen.getByTitle("Ana is viewing")).toHaveTextContent("A");
    expect(screen.getByTitle("Ben is viewing")).toHaveTextContent("B");
  });

  it("doesn't list you twice if the server includes you", () => {
    render(<Viewers me={me} viewers={[me, people[0]]} />);
    expect(screen.getByRole("group", { name: "Viewing now: You, Ana" })).toBeInTheDocument();
  });

  it("gives each person a stable color", () => {
    const { unmount } = render(<Viewers me={me} viewers={[people[0]]} />);
    const color = screen.getByTitle("Ana is viewing").style.background;
    unmount();
    render(<Viewers me={me} viewers={[people[1], people[0]]} />);
    expect(screen.getByTitle("Ana is viewing").style.background).toBe(color);
  });

  it("collapses everyone past the fourth circle into +N", () => {
    render(<Viewers me={me} viewers={people} />);
    expect(screen.getAllByTitle(/is viewing$/)).toHaveLength(3);
    expect(screen.getByTitle("Dev, Eve")).toHaveTextContent("+2");
  });
});

describe("Viewers in narrower panes", () => {
  it("renders a +N for each width, counting whoever that width can't fit", () => {
    const { container } = render(<Viewers me={me} viewers={people} />);
    // Wide: you + 3, then +2. Narrow: you + 1, then +4. Phone: you, then +5.
    expect(container.querySelector(".more-wide")).toHaveTextContent("+2");
    expect(container.querySelector(".more-narrow")).toHaveTextContent("+4");
    expect(container.querySelector(".more-phone")).toHaveTextContent("+5");
    expect(container.querySelector(".more-phone")).toHaveAttribute("title", "Ana, Ben, Cai, Dev, Eve");
    expect(screen.getByTitle("Ana is viewing")).toHaveClass("hide-phone");
    expect(screen.getByTitle("Ana is viewing")).not.toHaveClass("hide-narrow");
    expect(screen.getByTitle("Ben is viewing")).toHaveClass("hide-narrow", "hide-phone");
    expect(screen.getByTitle("You (Maya)")).not.toHaveClass("hide-phone");
  });

  it("adds no +N when everyone fits", () => {
    const { container } = render(<Viewers me={me} viewers={[]} />);
    expect(container.querySelector(".more")).toBeNull();
  });
});
