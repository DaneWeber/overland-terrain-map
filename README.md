# Overland Terrain Map

A browser-based editor for D&D 3.5e overland terrain maps, made for printing on 8.5 × 11 in (Letter) paper.

**To use:** open `index.html` in Chrome, Edge, Firefox or Safari. There's no install or build step and it works offline.

## Features

- **Hex or square grid.** Set the map size in miles and the **cells per mile** (for example 1, 2 or 4, or a fraction like 0.5). You can change these later: painted terrain stays where it is on the ground and is re-fitted to the new grid.
- **Terrain:** Desert, Forest, Hills, Jungle, Moor, Mountains, Plains, Swamp, Tundra. Each one has its **own black-ink icon** so the map reads without relying on color. You can also turn on two-letter text labels (Fo, Hi, Mt…) and turn color off.
- **Routes:** Highway (solid double line), Road / Trail (dashed line), or Trackless (no line). Roads follow the path you drag from cell to cell.
- **Rivers and cliffs** can go *in* a cell or *on a cell border*. A cliff's teeth point toward the lower ground.
- **Settlements and sites** sit on top of the terrain, so the cell keeps its terrain type and movement rules. The settlements are the 8 DMG community sizes (thorp through metropolis), each with its own icon. The other sites are ruins, tower/keep, castle, temple/shrine, cave/dungeon, bridge, ford, camp, lair and point of interest.
- **Walls and gates:** stockade (line crossed by posts), stone wall (thick double line with battlements) and gates. They go along cell borders or around a whole cell.
- **Labels:** large, bold text with a white outline. A label can be attached to a cell (it snaps from cell to cell when moved) or float anywhere. Drag to move, click to edit, right-click to delete.
- **Printing:** fit the map on one page, or choose an exact cell size in inches and tile it across several pages. Each page has a key and a scale bar. The key lists only the symbols used on the map. Optional extra pages: a full key with the [SRD Terrain and Overland Movement](https://www.d20srd.org/srd/movement.htm) multipliers, and a list of named places with their cell numbers.
- Undo/redo, saves automatically in the browser, and Save/Open `.json` files for backup or for moving a map to another computer.

## Controls

| Action | How |
| --- | --- |
| Paint | Click or drag |
| Remove what the current tool paints | Right-click / right-drag |
| Pick terrain | Keys 1–9 |
| Tools | B brush, F fill, R road, E eraser, S site, W walls, L label |
| Flip a cliff | Shift+click it (Cliff on border tool) |
| Undo / redo | Ctrl+Z / Ctrl+Y |
| Zoom | Ctrl+scroll, + / − |
| Pan | Space+drag or middle-drag |

When printing, choose **Letter** paper and **100% / Default** scale in the browser's print window so cells come out at the size you picked.

## Files

- `index.html`: page layout
- `styles.css`: editor and print styles
- `app.js`: all logic (grid geometry, painting, SVG rendering, print layout)
