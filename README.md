# Overland Terrain Map

A browser-based editor for D&D 3.5e overland terrain maps, made for printing on 8.5 × 11 in (Letter) paper.

**To use:** open `index.html` in Chrome, Edge, Firefox or Safari. There's no install or build step and it works offline.

## Features

- **Hex or square grid.** Set the map size in miles and the **cells per mile** (for example 1, 2 or 4, or a fraction like 0.5). You can change these later: painted terrain stays where it is on the ground and is re-fitted to the new grid.
- **Terrain:** Desert, Forest, Hills, Jungle, Moor, Mountains, Plains, Swamp, Tundra. Each one has its **own black-ink icon** so the map reads without relying on color. You can also turn on two-letter text labels (Fo, Hi, Mt…) and turn color off.
- **Routes:** Highway (solid double line), Road / Trail (dashed line), or Trackless (no line). Roads follow the path you drag from cell to cell.
- **Rivers and cliffs** can go *in* a cell or *on a cell border*. A cliff's teeth point toward the lower ground.
- **Printing:** fit the map on one page, or choose an exact cell size in inches and tile it across several pages. Each page has a key and a scale bar. An optional extra page has the full key and the PHB Table 9–5 overland movement multipliers.
- Undo/redo, saves automatically in the browser, and Save/Open `.json` files for backup or for moving a map to another computer.

## Controls

| Action | How |
| --- | --- |
| Paint | Click or drag |
| Remove what the current tool paints | Right-click / right-drag |
| Pick terrain | Keys 1–9 |
| Tools | B brush, F fill, R road, E eraser |
| Flip a cliff | Shift+click it (Cliff on border tool) |
| Undo / redo | Ctrl+Z / Ctrl+Y |
| Zoom | Ctrl+scroll, + / − |
| Pan | Space+drag or middle-drag |

When printing, choose **Letter** paper and **100% / Default** scale in the browser's print window so cells come out at the size you picked.

## Files

- `index.html`: page layout
- `styles.css`: editor and print styles
- `app.js`: all logic (grid geometry, painting, SVG rendering, print layout)
