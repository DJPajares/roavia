import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#f4f1e8",
    description: "A source-aware travel planner with offline access to saved itinerary essentials.",
    display: "standalone",
    icons: [
      {
        src: "/pwa-icon-192",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/pwa-icon-512",
        sizes: "512x512",
        type: "image/png",
      },
      {
        purpose: "maskable",
        src: "/pwa-icon-512",
        sizes: "512x512",
        type: "image/png",
      },
    ],
    id: "/",
    name: "Roavia Travel Planner",
    orientation: "any",
    scope: "/",
    short_name: "Roavia",
    start_url: "/trips",
    theme_color: "#163631",
  };
}
