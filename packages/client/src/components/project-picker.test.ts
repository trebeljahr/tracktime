import { describe, expect, it } from "vitest";
import { splitClientAndProject } from "./project-picker";

describe("splitClientAndProject", () => {
  it("treats a plain query as a project name", () => {
    expect(splitClientAndProject("Website Redesign")).toEqual({
      clientName: null,
      projectName: "Website Redesign",
    });
  });

  it("splits a Client / Project query into both names", () => {
    expect(splitClientAndProject("Acme Corp / Website Redesign")).toEqual({
      clientName: "Acme Corp",
      projectName: "Website Redesign",
    });
  });

  it("tolerates missing spaces around the separator", () => {
    expect(splitClientAndProject("Acme/Website")).toEqual({
      clientName: "Acme",
      projectName: "Website",
    });
  });

  it("trims surrounding whitespace on both halves", () => {
    expect(splitClientAndProject("  Acme   /   Website  ")).toEqual({
      clientName: "Acme",
      projectName: "Website",
    });
  });

  it("splits on the FIRST separator so a project may contain a slash", () => {
    expect(splitClientAndProject("Acme / Design / Brand")).toEqual({
      clientName: "Acme",
      projectName: "Design / Brand",
    });
  });

  it("falls back to a project name when the client half is empty", () => {
    expect(splitClientAndProject("/ Website")).toEqual({
      clientName: null,
      projectName: "Website",
    });
  });

  it("falls back to a project name when the project half is empty", () => {
    expect(splitClientAndProject("Acme /")).toEqual({
      clientName: null,
      projectName: "Acme",
    });
  });
});
