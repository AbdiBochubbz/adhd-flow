import { svg } from "./dom.js";

const LOOKS = {
  pebbles: { hair: "#8d5a3c", cloth: "#f3e2cf", accent: "#e7b7a4" },
  moss: { hair: "#6d8f62", cloth: "#e4efe4", accent: "#f2c9b8" },
  brick: { hair: "#b5654a", cloth: "#d7e4f2", accent: "#f0c3b4" },
  mist: { hair: "#8e8aa8", cloth: "#f7f4ef", accent: "#f3d0c8" },
  sun: { hair: "#e0b15a", cloth: "#f6e7c1", accent: "#f0b8ae" },
  ink: { hair: "#4e463f", cloth: "#d9e2dc", accent: "#efc2b6" },
};

export function chibiFigure(id) {
  const look = LOOKS[id] || LOOKS.pebbles;
  return svg(
    "svg",
    { class: "chibi", viewBox: "0 0 64 78", "aria-hidden": "true" },
    svg("ellipse", { cx: "32", cy: "70", rx: "16", ry: "4", fill: "rgba(80,50,20,0.18)" }),
    svg("path", { d: "M18 46h28a10 12 0 0 1 10 12v8H8v-8a10 12 0 0 1 10-12z", fill: look.cloth }),
    svg("circle", { cx: "32", cy: "28", r: "16", fill: "#f6d7c3" }),
    svg("path", { d: hairPath(id), fill: look.hair }),
    svg("circle", { cx: "26", cy: "29", r: "1.6", fill: "#3a2a22" }),
    svg("circle", { cx: "38", cy: "29", r: "1.6", fill: "#3a2a22" }),
    svg("path", { d: "M29 34h6", stroke: "#c48b78", "stroke-width": "1.4", "stroke-linecap": "round" }),
    svg("circle", { cx: "23", cy: "33", r: "2", fill: look.accent }),
    svg("circle", { cx: "41", cy: "33", r: "2", fill: look.accent }),
  );
}

function hairPath(id) {
  if (id === "moss") return "M16 30c2-14 30-16 34-2 0 6-2 8-2 8H18s-2-2-2-6z";
  if (id === "brick") return "M18 26c1-10 26-12 30 0v6H18z";
  if (id === "mist") return "M17 28c2-12 28-14 32 1 1 8-4 10-4 10H20s-4-3-3-11z";
  if (id === "sun") return "M20 24c0-10 24-12 28 2 2 10-6 8-8 4-4 8-12 8-16 2-2 4-6 6-6 0z";
  if (id === "ink") return "M18 24c2-8 28-10 30 2v8H18z";
  return "M16 28c2-14 32-14 34 2v4H16z";
}
