import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DBW AI — Text & Voice to Database",
    short_name: "DBW AI",
    description:
      "Describe your app in plain English or Krio. DBW AI designs the full SQL database, sample data and ER diagram — ready to import anywhere.",
    id: "/",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    display_override: ["standalone", "minimal-ui"],
    orientation: "portrait-primary",
    // Chrome on Android builds its own launch screen from `background_color`
    // plus the 512 icon. There is deliberately no iOS counterpart: the app
    // ships no `apple-touch-startup-image`, so both platforms open on the same
    // white field this value declares, which is also the app's own background
    // and its first paint. One colour everywhere means no hand-off flash.
    background_color: "#ffffff",
    theme_color: "#ffffff",
    categories: ["productivity", "developer", "utilities"],
    lang: "en",
    dir: "ltr",
    // The 1024 asset is not referenced here on purpose. It exists for launchers
    // and for store listings that want a larger source, and adding it to the
    // manifest would only invite Android to use a bitmap several times the size
    // it needs on a home screen.
    //
    // `monochrome` is what makes the Android 13+ themed icon work: the platform
    // reads the alpha channel alone and tints the silhouette to match the user's
    // wallpaper palette, so the file is flat white on transparent and its
    // artwork has to be the mark alone, with no plate to carry the shape.
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      {
        src: "/icons/icon-monochrome-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "monochrome",
      },
    ],
    shortcuts: [
      {
        name: "New database",
        short_name: "New",
        url: "/?source=shortcut#build",
        icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }],
      },
      { name: "My databases", short_name: "Projects", url: "/projects" },
    ],
  };
}
