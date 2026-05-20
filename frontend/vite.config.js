import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";

// Serve over HTTPS using the mkcert cert (mounted at /certs) so the browser
// gets a secure context for getUserMedia(). If certs are missing, fall back
// to HTTP (mic won't work, but the app still loads for debugging).
let https = false;
try {
  https = {
    key: fs.readFileSync("/certs/key.pem"),
    cert: fs.readFileSync("/certs/cert.pem"),
  };
} catch {
  console.warn("[vite] no certs at /certs — serving HTTP (WebRTC will fail)");
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    https,
    // Bind-mounted from /mnt/c — inotify doesn't fire there, so poll for changes.
    watch: { usePolling: true, interval: 300 },
    // Proxy backend calls so the HTTPS page never makes mixed-content requests.
    proxy: {
      "/api": { target: "http://backend:3000", changeOrigin: true },
      "/ws": { target: "http://backend:3000", ws: true, changeOrigin: true },
    },
  },
});
