/** @type {import('next').NextConfig} */
const nextConfig = {
  // Produces a small self-contained server for the Docker image.
  output: "standalone",
  experimental: {
    // Photos are resized on the phone, but allow some headroom.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
