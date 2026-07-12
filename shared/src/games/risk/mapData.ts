/**
 * Classic World Domination map: 42 territories, 6 continents, classic
 * adjacency graph including sea links. Invariants (symmetry, connectivity,
 * continent partition) are enforced by unit tests.
 */

export interface TerritoryDef {
  id: number;
  name: string;
  continent: number;
  adjacent: number[];
}

export interface ContinentDef {
  id: number;
  name: string;
  bonus: number;
  territories: number[];
}

// Territory ids
export const T = {
  ALASKA: 0, NW_TERRITORY: 1, GREENLAND: 2, ALBERTA: 3, ONTARIO: 4, QUEBEC: 5,
  WESTERN_US: 6, EASTERN_US: 7, CENTRAL_AMERICA: 8,
  VENEZUELA: 9, PERU: 10, BRAZIL: 11, ARGENTINA: 12,
  ICELAND: 13, GREAT_BRITAIN: 14, SCANDINAVIA: 15, UKRAINE: 16, NORTHERN_EUROPE: 17,
  WESTERN_EUROPE: 18, SOUTHERN_EUROPE: 19,
  NORTH_AFRICA: 20, EGYPT: 21, EAST_AFRICA: 22, CONGO: 23, SOUTH_AFRICA: 24, MADAGASCAR: 25,
  URAL: 26, SIBERIA: 27, YAKUTSK: 28, KAMCHATKA: 29, IRKUTSK: 30, MONGOLIA: 31, JAPAN: 32,
  AFGHANISTAN: 33, CHINA: 34, MIDDLE_EAST: 35, INDIA: 36, SIAM: 37,
  INDONESIA: 38, NEW_GUINEA: 39, WESTERN_AUSTRALIA: 40, EASTERN_AUSTRALIA: 41,
} as const;

const t = T;

export const TERRITORIES: TerritoryDef[] = [
  { id: t.ALASKA, name: 'Alaska', continent: 0, adjacent: [t.NW_TERRITORY, t.ALBERTA, t.KAMCHATKA] },
  { id: t.NW_TERRITORY, name: 'Northwest Territory', continent: 0, adjacent: [t.ALASKA, t.ALBERTA, t.ONTARIO, t.GREENLAND] },
  { id: t.GREENLAND, name: 'Greenland', continent: 0, adjacent: [t.NW_TERRITORY, t.ONTARIO, t.QUEBEC, t.ICELAND] },
  { id: t.ALBERTA, name: 'Alberta', continent: 0, adjacent: [t.ALASKA, t.NW_TERRITORY, t.ONTARIO, t.WESTERN_US] },
  { id: t.ONTARIO, name: 'Ontario', continent: 0, adjacent: [t.NW_TERRITORY, t.ALBERTA, t.GREENLAND, t.QUEBEC, t.WESTERN_US, t.EASTERN_US] },
  { id: t.QUEBEC, name: 'Quebec', continent: 0, adjacent: [t.GREENLAND, t.ONTARIO, t.EASTERN_US] },
  { id: t.WESTERN_US, name: 'Western United States', continent: 0, adjacent: [t.ALBERTA, t.ONTARIO, t.EASTERN_US, t.CENTRAL_AMERICA] },
  { id: t.EASTERN_US, name: 'Eastern United States', continent: 0, adjacent: [t.ONTARIO, t.QUEBEC, t.WESTERN_US, t.CENTRAL_AMERICA] },
  { id: t.CENTRAL_AMERICA, name: 'Central America', continent: 0, adjacent: [t.WESTERN_US, t.EASTERN_US, t.VENEZUELA] },

  { id: t.VENEZUELA, name: 'Venezuela', continent: 1, adjacent: [t.CENTRAL_AMERICA, t.PERU, t.BRAZIL] },
  { id: t.PERU, name: 'Peru', continent: 1, adjacent: [t.VENEZUELA, t.BRAZIL, t.ARGENTINA] },
  { id: t.BRAZIL, name: 'Brazil', continent: 1, adjacent: [t.VENEZUELA, t.PERU, t.ARGENTINA, t.NORTH_AFRICA] },
  { id: t.ARGENTINA, name: 'Argentina', continent: 1, adjacent: [t.PERU, t.BRAZIL] },

  { id: t.ICELAND, name: 'Iceland', continent: 2, adjacent: [t.GREENLAND, t.GREAT_BRITAIN, t.SCANDINAVIA] },
  { id: t.GREAT_BRITAIN, name: 'Great Britain', continent: 2, adjacent: [t.ICELAND, t.SCANDINAVIA, t.NORTHERN_EUROPE, t.WESTERN_EUROPE] },
  { id: t.SCANDINAVIA, name: 'Scandinavia', continent: 2, adjacent: [t.ICELAND, t.GREAT_BRITAIN, t.NORTHERN_EUROPE, t.UKRAINE] },
  { id: t.UKRAINE, name: 'Ukraine', continent: 2, adjacent: [t.SCANDINAVIA, t.NORTHERN_EUROPE, t.SOUTHERN_EUROPE, t.URAL, t.AFGHANISTAN, t.MIDDLE_EAST] },
  { id: t.NORTHERN_EUROPE, name: 'Northern Europe', continent: 2, adjacent: [t.GREAT_BRITAIN, t.SCANDINAVIA, t.UKRAINE, t.SOUTHERN_EUROPE, t.WESTERN_EUROPE] },
  { id: t.WESTERN_EUROPE, name: 'Western Europe', continent: 2, adjacent: [t.GREAT_BRITAIN, t.NORTHERN_EUROPE, t.SOUTHERN_EUROPE, t.NORTH_AFRICA] },
  { id: t.SOUTHERN_EUROPE, name: 'Southern Europe', continent: 2, adjacent: [t.NORTHERN_EUROPE, t.WESTERN_EUROPE, t.UKRAINE, t.MIDDLE_EAST, t.EGYPT, t.NORTH_AFRICA] },

  { id: t.NORTH_AFRICA, name: 'North Africa', continent: 3, adjacent: [t.BRAZIL, t.WESTERN_EUROPE, t.SOUTHERN_EUROPE, t.EGYPT, t.EAST_AFRICA, t.CONGO] },
  { id: t.EGYPT, name: 'Egypt', continent: 3, adjacent: [t.SOUTHERN_EUROPE, t.NORTH_AFRICA, t.EAST_AFRICA, t.MIDDLE_EAST] },
  { id: t.EAST_AFRICA, name: 'East Africa', continent: 3, adjacent: [t.EGYPT, t.NORTH_AFRICA, t.CONGO, t.SOUTH_AFRICA, t.MADAGASCAR, t.MIDDLE_EAST] },
  { id: t.CONGO, name: 'Congo', continent: 3, adjacent: [t.NORTH_AFRICA, t.EAST_AFRICA, t.SOUTH_AFRICA] },
  { id: t.SOUTH_AFRICA, name: 'South Africa', continent: 3, adjacent: [t.CONGO, t.EAST_AFRICA, t.MADAGASCAR] },
  { id: t.MADAGASCAR, name: 'Madagascar', continent: 3, adjacent: [t.EAST_AFRICA, t.SOUTH_AFRICA] },

  { id: t.URAL, name: 'Ural', continent: 4, adjacent: [t.UKRAINE, t.SIBERIA, t.CHINA, t.AFGHANISTAN] },
  { id: t.SIBERIA, name: 'Siberia', continent: 4, adjacent: [t.URAL, t.YAKUTSK, t.IRKUTSK, t.MONGOLIA, t.CHINA] },
  { id: t.YAKUTSK, name: 'Yakutsk', continent: 4, adjacent: [t.SIBERIA, t.KAMCHATKA, t.IRKUTSK] },
  { id: t.KAMCHATKA, name: 'Kamchatka', continent: 4, adjacent: [t.YAKUTSK, t.IRKUTSK, t.MONGOLIA, t.JAPAN, t.ALASKA] },
  { id: t.IRKUTSK, name: 'Irkutsk', continent: 4, adjacent: [t.SIBERIA, t.YAKUTSK, t.KAMCHATKA, t.MONGOLIA] },
  { id: t.MONGOLIA, name: 'Mongolia', continent: 4, adjacent: [t.SIBERIA, t.IRKUTSK, t.KAMCHATKA, t.JAPAN, t.CHINA] },
  { id: t.JAPAN, name: 'Japan', continent: 4, adjacent: [t.KAMCHATKA, t.MONGOLIA] },
  { id: t.AFGHANISTAN, name: 'Afghanistan', continent: 4, adjacent: [t.UKRAINE, t.URAL, t.CHINA, t.INDIA, t.MIDDLE_EAST] },
  { id: t.CHINA, name: 'China', continent: 4, adjacent: [t.URAL, t.SIBERIA, t.MONGOLIA, t.AFGHANISTAN, t.INDIA, t.SIAM] },
  { id: t.MIDDLE_EAST, name: 'Middle East', continent: 4, adjacent: [t.UKRAINE, t.SOUTHERN_EUROPE, t.EGYPT, t.EAST_AFRICA, t.AFGHANISTAN, t.INDIA] },
  { id: t.INDIA, name: 'India', continent: 4, adjacent: [t.AFGHANISTAN, t.CHINA, t.MIDDLE_EAST, t.SIAM] },
  { id: t.SIAM, name: 'Siam', continent: 4, adjacent: [t.CHINA, t.INDIA, t.INDONESIA] },

  { id: t.INDONESIA, name: 'Indonesia', continent: 5, adjacent: [t.SIAM, t.NEW_GUINEA, t.WESTERN_AUSTRALIA] },
  { id: t.NEW_GUINEA, name: 'New Guinea', continent: 5, adjacent: [t.INDONESIA, t.WESTERN_AUSTRALIA, t.EASTERN_AUSTRALIA] },
  { id: t.WESTERN_AUSTRALIA, name: 'Western Australia', continent: 5, adjacent: [t.INDONESIA, t.NEW_GUINEA, t.EASTERN_AUSTRALIA] },
  { id: t.EASTERN_AUSTRALIA, name: 'Eastern Australia', continent: 5, adjacent: [t.NEW_GUINEA, t.WESTERN_AUSTRALIA] },
];

export const CONTINENTS: ContinentDef[] = [
  { id: 0, name: 'North America', bonus: 5, territories: TERRITORIES.filter((x) => x.continent === 0).map((x) => x.id) },
  { id: 1, name: 'South America', bonus: 2, territories: TERRITORIES.filter((x) => x.continent === 1).map((x) => x.id) },
  { id: 2, name: 'Europe', bonus: 5, territories: TERRITORIES.filter((x) => x.continent === 2).map((x) => x.id) },
  { id: 3, name: 'Africa', bonus: 3, territories: TERRITORIES.filter((x) => x.continent === 3).map((x) => x.id) },
  { id: 4, name: 'Asia', bonus: 7, territories: TERRITORIES.filter((x) => x.continent === 4).map((x) => x.id) },
  { id: 5, name: 'Australia', bonus: 2, territories: TERRITORIES.filter((x) => x.continent === 5).map((x) => x.id) },
];

export const NUM_TERRITORIES = 42;

export function isAdjacent(a: number, b: number): boolean {
  return TERRITORIES[a]?.adjacent.includes(b) ?? false;
}
