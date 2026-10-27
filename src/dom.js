const ICONS = {
  plus: "M12 5v14M5 12h14",
  mic: "M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3zM6 11a6 6 0 0 0 12 0M12 17v3M8 20h8",
  lock: "M8 10V8a4 4 0 0 1 8 0v2M7 10h10v9H7z",
  check: "M5 12.5 9.5 17 19 7.5",
  focus: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 3v2M12 19v2M3 12H5M19 12h2",
  list: "M9 7h11M9 12h11M9 17h11M4 7h.01M4 12h.01M4 17h.01",
  timer: "M12 7v5l3 2M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z",
  settings: "M4 8h16M4 16h16M9 8a2 2 0 1 0 0 .01M15 16a2 2 0 1 0 0 .01",
  close: "M6 6l12 12M18 6 6 18",
};

export function h(tag, attrs, ...children) {
  const node = document.createElement(tag);
  if (tag === "button") node.type = "button";
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      if (key === "class") node.className = String(value);
      else if (key === "dataset") {
        for (const [name, data] of Object.entries(value)) node.dataset[name] = String(data);
      } else if (key === "checked" || key === "value" || key === "selected" || key === "indeterminate") {
        node[key] = value;
      }
      else node.setAttribute(key, value === true ? "" : String(value));
    }
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children) {
    if (Array.isArray(child)) append(node, child);
    else if (child == null || child === false) continue;
    else node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function svg(tag, attrs, ...children) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value == null || value === false) continue;
      node.setAttribute(key === "class" ? "class" : key, value === true ? "" : String(value));
    }
  }
  for (const child of children.flat()) {
    if (child instanceof Node) node.append(child);
  }
  return node;
}

export function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("icon");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", ICONS[name] || ICONS.focus);
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.8");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}
