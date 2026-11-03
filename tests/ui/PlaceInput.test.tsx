import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { PlaceInput } from "@/components/PlaceInput";
import type { PlaceSuggestion } from "@/lib/placeSearch";
import { mockFetch } from "./fixtures";

const SFO: PlaceSuggestion = {
  kind: "airport",
  label: "San Francisco International Airport (SFO)",
  detail: "San Francisco, United States",
  value: "San Francisco International Airport (SFO), San Francisco, United States",
};
const SF: PlaceSuggestion = { kind: "city", label: "San Francisco", detail: "California, United States", value: "San Francisco, California, United States" };

function Field({ onSubmit = () => {} }: { onSubmit?: () => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <label htmlFor="origin">Starting point</label>
      <PlaceInput id="origin" value={value} onChange={setValue} />
    </form>
  );
}

const suggest = () => mockFetch((url) => ({ suggestions: /q=zz/.test(url) ? [] : [SFO, SF] }));

describe("PlaceInput", () => {
  it("suggests places as you type and fills in the one you pick", async () => {
    const fetch = suggest();
    render(<Field />);
    const box = screen.getByRole("combobox", { name: "Starting point" });
    await userEvent.type(box, "san f");
    await userEvent.click(await screen.findByRole("option", { name: /San Francisco International Airport/ }));
    expect(box).toHaveValue(SFO.value);
    expect(screen.queryByRole("listbox")).toBeNull();
    // Typing is debounced: one search for the whole word, not one per letter.
    expect(fetch.mock.calls.map(([u]) => String(u))).toEqual(["/api/places/suggest?q=san+f"]);
  });

  it("picks with the arrow keys and Enter without submitting the form", async () => {
    suggest();
    const onSubmit = vi.fn();
    render(<Field onSubmit={onSubmit} />);
    const box = screen.getByRole("combobox");
    await userEvent.type(box, "sfo");
    await screen.findByRole("option", { name: /^San Francisco California/ });
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    expect(box).toHaveValue(SF.value);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("says when nothing matches, and closes on Escape", async () => {
    suggest();
    render(<Field />);
    const box = screen.getByRole("combobox");
    await userEvent.type(box, "zzz town");
    expect(await screen.findByText(/No matches/)).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(box).toHaveValue("zzz town");
  });
});
