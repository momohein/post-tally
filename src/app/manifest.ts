import type { MetadataRoute } from "next";

// Lets phones install the app to the home screen (needs HTTPS on a real server).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Post Tally",
    short_name: "Post Tally",
    description: "Log registered, express and parcel posts from a photo of the label.",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f4f2",
    theme_color: "#1f5f52",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
