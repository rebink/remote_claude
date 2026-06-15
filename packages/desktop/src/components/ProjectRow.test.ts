import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi } from "vitest";
import ProjectRow from "./ProjectRow.svelte";
import type { Project } from "../lib/types";

const project: Project = {
  id: "a",
  name: "api-server",
  branch: "main",
  host: "studio-mini",
  user: "rebin",
  localPath: "/home/rebin/code/api-server",
  remotePath: "/remote/api-server",
  lastStatus: "in-sync",
  syncPaused: false,
};

describe("ProjectRow", () => {
  it("shows name, branch, path mapping, and status", () => {
    const { getByTestId } = render(ProjectRow, { props: { project } });
    expect(getByTestId("row-name").textContent).toContain("api-server");
    expect(getByTestId("row-branch").textContent).toBe("main");
    expect(getByTestId("row-path").textContent).toContain("/home/rebin/code/api-server");
    expect(getByTestId("row-path").textContent).toContain("/remote/api-server");
    expect(getByTestId("row-status").textContent).toContain("In sync");
  });
  it("shows the project's own user@host", () => {
    const { getByTestId } = render(ProjectRow, { props: { project: { ...project, host: "studio-mini", user: "rebin" } } });
    expect(getByTestId("row-remote").textContent).toBe("rebin@studio-mini");
  });
  it("fires onopen with the project when clicked", async () => {
    const onopen = vi.fn();
    const { getByTestId } = render(ProjectRow, { props: { project, onopen } });
    await fireEvent.click(getByTestId("row"));
    expect(onopen).toHaveBeenCalledWith(project);
  });
});
