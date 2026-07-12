/**
 * Original stylized "parchment atlas" layout: 42 hex territories clustered
 * into 6 continents on a 1200×800 board. Classic adjacency graph, invented
 * geometry. The ONLY art asset of the Risk UI.
 */
import { T } from '@gamehub/shared';

export const VIEW_W = 1200;
export const VIEW_H = 800;
export const HEX_R = 44;

export interface TerritoryLayout {
  x: number;
  y: number;
  /** Short label that fits a hex. */
  label: string;
}

export const CONTINENT_COLORS: Record<number, string> = {
  0: '#c9b370', // North America — wheat
  1: '#d4915e', // South America — clay
  2: '#a8bb8f', // Europe — sage
  3: '#ddb85a', // Africa — gold sand
  4: '#c98a6b', // Asia — terracotta
  5: '#b08fb8', // Australia — heather
};

export const LAYOUT: Record<number, TerritoryLayout> = {
  // North America
  [T.ALASKA]: { x: 95, y: 130, label: 'Alaska' },
  [T.NW_TERRITORY]: { x: 200, y: 115, label: 'NW Terr.' },
  [T.GREENLAND]: { x: 345, y: 85, label: 'Greenland' },
  [T.ALBERTA]: { x: 175, y: 200, label: 'Alberta' },
  [T.ONTARIO]: { x: 262, y: 190, label: 'Ontario' },
  [T.QUEBEC]: { x: 350, y: 175, label: 'Quebec' },
  [T.WESTERN_US]: { x: 190, y: 285, label: 'W. States' },
  [T.EASTERN_US]: { x: 280, y: 275, label: 'E. States' },
  [T.CENTRAL_AMERICA]: { x: 200, y: 370, label: 'C. America' },

  // South America
  [T.VENEZUELA]: { x: 250, y: 455, label: 'Venezuela' },
  [T.PERU]: { x: 240, y: 545, label: 'Peru' },
  [T.BRAZIL]: { x: 330, y: 510, label: 'Brazil' },
  [T.ARGENTINA]: { x: 275, y: 635, label: 'Argentina' },

  // Europe
  [T.ICELAND]: { x: 470, y: 130, label: 'Iceland' },
  [T.SCANDINAVIA]: { x: 570, y: 105, label: 'Scandinavia' },
  [T.UKRAINE]: { x: 665, y: 155, label: 'Ukraine' },
  [T.GREAT_BRITAIN]: { x: 470, y: 220, label: 'Britain' },
  [T.NORTHERN_EUROPE]: { x: 565, y: 200, label: 'N. Europe' },
  [T.WESTERN_EUROPE]: { x: 490, y: 310, label: 'W. Europe' },
  [T.SOUTHERN_EUROPE]: { x: 585, y: 290, label: 'S. Europe' },

  // Africa
  [T.NORTH_AFRICA]: { x: 510, y: 425, label: 'N. Africa' },
  [T.EGYPT]: { x: 600, y: 385, label: 'Egypt' },
  [T.EAST_AFRICA]: { x: 655, y: 470, label: 'E. Africa' },
  [T.CONGO]: { x: 565, y: 515, label: 'Congo' },
  [T.SOUTH_AFRICA]: { x: 590, y: 610, label: 'S. Africa' },
  [T.MADAGASCAR]: { x: 690, y: 590, label: 'Madagascar' },

  // Asia
  [T.URAL]: { x: 765, y: 140, label: 'Ural' },
  [T.SIBERIA]: { x: 850, y: 100, label: 'Siberia' },
  [T.YAKUTSK]: { x: 940, y: 80, label: 'Yakutsk' },
  [T.KAMCHATKA]: { x: 1040, y: 95, label: 'Kamchatka' },
  [T.IRKUTSK]: { x: 915, y: 170, label: 'Irkutsk' },
  [T.MONGOLIA]: { x: 935, y: 255, label: 'Mongolia' },
  [T.JAPAN]: { x: 1050, y: 250, label: 'Japan' },
  [T.AFGHANISTAN]: { x: 750, y: 240, label: 'Afghanistan' },
  [T.CHINA]: { x: 855, y: 315, label: 'China' },
  [T.MIDDLE_EAST]: { x: 690, y: 330, label: 'Mid. East' },
  [T.INDIA]: { x: 790, y: 390, label: 'India' },
  [T.SIAM]: { x: 880, y: 405, label: 'Siam' },

  // Australia
  [T.INDONESIA]: { x: 915, y: 500, label: 'Indonesia' },
  [T.NEW_GUINEA]: { x: 1015, y: 470, label: 'N. Guinea' },
  [T.WESTERN_AUSTRALIA]: { x: 950, y: 600, label: 'W. Australia' },
  [T.EASTERN_AUSTRALIA]: { x: 1050, y: 570, label: 'E. Australia' },
};

/** Flat-top hexagon path centered at (cx, cy). */
export function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i);
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(' ');
}
