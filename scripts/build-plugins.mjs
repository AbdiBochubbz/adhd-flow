import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' https://www.google.com https://*.google.com https://*.googleapis.com wss://www.google.com wss://*.google.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "font-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
].join("; ");

export function cspPlugin() {
  return {
    name: "still-csp",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const metaPolicy = CSP.replace("; frame-ancestors 'none'", "");
        const policy = `<meta http-equiv="Content-Security-Policy" content="${metaPolicy}">`;
        if (html.includes("Content-Security-Policy")) return html;
        return html.replace(/<meta name="csp-slot" content=""\s*\/?>/, policy);
      },
    },
  };
}

export function precachePlugin() {
  return {
    name: "still-precache",
    apply: "build",
    closeBundle() {
      const dist = path.resolve("dist");
      const files = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else {
            const rel = path.relative(dist, full).split(path.sep).join("/");
            if (rel === "sw.js") continue;
            files.push(rel);
          }
        }
      };
      walk(dist);
      files.sort();
      const cache = `still-${createHash("sha256").update(files.join("|")).digest("hex").slice(0, 12)}`;
      const swPath = path.join(dist, "sw.js");
      let sw = fs.readFileSync(swPath, "utf8");
      if (!sw.includes("__CACHE__") || !sw.includes("__PRECACHE__")) {
        throw new Error("Service worker is missing build placeholders.");
      }
      sw = sw.replaceAll("__CACHE__", cache).replaceAll("__PRECACHE__", JSON.stringify(files));
      fs.writeFileSync(swPath, sw);
    },
  };
}
