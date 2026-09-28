export interface GameCatalogItem {
  n: number;
  name: string;
  size: string;
  alt?: string[];
}

export const CLASSIC_64_GAMES: GameCatalogItem[] = [
  { n: 1, name: 'Contra', size: '128–256 KB' },
  { n: 2, name: 'Infant School', size: '32–64 KB' },
  { n: 3, name: 'Castle Excellent', size: '64 KB' },
  { n: 4, name: "Bump'n'Jump", size: '36 KB' },
  { n: 5, name: 'Alpha Mission', size: '128 KB', alt: ['Aldha Mission'] },
  { n: 6, name: 'Tiger Heli', size: '128 KB' },
  { n: 7, name: 'Space Fight of Gun', size: '32–64 KB' },
  { n: 8, name: 'Fantasy of Gun', size: '32–64 KB' },
  { n: 9, name: 'Abyss of Gloom', size: '32–64 KB' },
  { n: 10, name: 'Argus', size: '128 KB' },
  { n: 11, name: 'Othello', size: '40 KB' },
  { n: 12, name: 'Arkanoid', size: '64–128 KB' },
  { n: 13, name: 'Elevator Action', size: '64 KB' },
  { n: 14, name: 'Mag Max', size: '128 KB' },
  { n: 15, name: 'Super Dynamix', size: '32–64 KB' },
  { n: 16, name: 'Twin Bee', size: '128 KB' },
  { n: 17, name: '1942', size: '64 KB' },
  { n: 18, name: 'Spartan', size: '32–64 KB' },
  { n: 19, name: 'B-Wang', size: '64 KB' },
  { n: 20, name: 'Dough Boy', size: '64 KB' },
  { n: 21, name: 'Lot Lot', size: '64 KB' },
  { n: 22, name: 'King of Ghost', size: '64 KB' },
  { n: 23, name: 'Son Son', size: '32–64 KB' },
  { n: 24, name: 'Ninja 3', size: '64 KB' },
  { n: 25, name: 'Xevious', size: '64 KB' },
  { n: 26, name: 'Pony Cat', size: '32–64 KB' },
  { n: 27, name: 'Gyrodine', size: '64 KB' },
  { n: 28, name: 'Sasa', size: '32–64 KB' },
  { n: 29, name: 'Star Force', size: '128 KB' },
  { n: 30, name: 'Battle City', size: '32 KB' },
  { n: 31, name: 'Circus Charlie', size: '64 KB' },
  { n: 32, name: 'Antarctic Adventure', size: '64 KB' },
  { n: 33, name: 'Mappy', size: '32–64 KB' },
  { n: 34, name: 'Milk & Nuts', size: '32 KB', alt: ['Nuts & Milk'] },
  { n: 35, name: 'Arabian', size: '64 KB' },
  { n: 36, name: 'Sky Destroyer', size: '64 KB' },
  { n: 37, name: 'Pooyan', size: '64 KB' },
  { n: 38, name: 'F1 Race', size: '64 KB' },
  { n: 39, name: 'Road Fighter', size: '64 KB' },
  { n: 40, name: 'Lunar Ball', size: '64 KB' },
  { n: 41, name: 'Dig Dug', size: '64 KB' },
  { n: 42, name: 'Joust', size: '64 KB' },
  { n: 43, name: 'Exerion', size: '64 KB' },
  { n: 44, name: 'Kung Fu', size: '64 KB' },
  { n: 45, name: 'Hyper Olympic', size: '128 KB' },
  { n: 46, name: 'Hyper Sports', size: '128 KB' },
  { n: 47, name: 'Ninja', size: '64 KB' },
  { n: 48, name: 'Bomber Man', size: '32 KB' },
  { n: 49, name: 'Front Line', size: '64 KB' },
  { n: 50, name: 'Lode Runner', size: '64 KB' },
  { n: 51, name: 'Zippy Race', size: '64 KB' },
  { n: 52, name: 'Warpman', size: '32 KB' },
  { n: 53, name: 'Formation Z', size: '64 KB' },
  { n: 54, name: 'Combat', size: '64 KB' },
  { n: 55, name: 'Karateka', size: '64 KB' },
  { n: 56, name: 'Galaga', size: '64 KB' },
  { n: 57, name: 'Macross', size: '128 KB' },
  { n: 58, name: "Chack'n Pop", size: '64 KB' },
  { n: 59, name: 'Small Mary', size: '32–64 KB' },
  { n: 60, name: 'Devil World', size: '64 KB' },
  { n: 61, name: 'Pac-Man', size: '32 KB' },
  { n: 62, name: 'Bird Week', size: '64 KB' },
  { n: 63, name: 'Galaxian', size: '32 KB' },
  { n: 64, name: 'Bookyman', size: '32–64 KB' },
];

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\.nes$/i, '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\[.*?\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function findMatchingClassicGame(filename: string): GameCatalogItem | undefined {
  const norm = normalizeName(filename);
  return CLASSIC_64_GAMES.find((g) => {
    if (normalizeName(g.name) === norm) return true;
    if (g.alt && g.alt.some((alt) => normalizeName(alt) === norm)) return true;
    // Partial substring match
    const gNorm = normalizeName(g.name);
    return norm.includes(gNorm) || gNorm.includes(norm);
  });
}
