const nextConfig = {
  reactStrictMode: true,
  // Allows isolated QA builds (NEXT_DIST_DIR=.next-qa) without clashing with another build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
};
export default nextConfig;
