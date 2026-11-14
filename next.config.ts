import type { NextConfig } from "next";

const config: NextConfig = {
  images: { unoptimized: true },
  // Next 16 writes an AGENTS.md on dev start otherwise.
  agentRules: false,
};

export default config;
