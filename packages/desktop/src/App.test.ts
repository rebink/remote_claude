import { render } from "@testing-library/svelte";
import { describe, it, expect } from "vitest";
import App from "./App.svelte";

describe("App", () => {
  it("renders the app root", () => {
    const { getByTestId } = render(App);
    expect(getByTestId("app-root").textContent).toContain("Patchwire");
  });
});
