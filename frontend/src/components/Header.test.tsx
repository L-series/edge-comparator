import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Header } from "./Header";

describe("Header", () => {
  it("renders the Edge AI Comparator title", () => {
    render(<Header />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Edge AI Comparator" }),
    ).toBeInTheDocument();
  });

  it("displays the prominent local research preview notice", () => {
    render(<Header />);
    expect(
      screen.getByText(/Local research prototype evaluating real CPU compilation via OpenVINO/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /No actual hardware acceleration, model inference, or benchmarking is evaluated/i,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/not for public SaaS or unverified execution/i)).toBeInTheDocument();
  });
});
