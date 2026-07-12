/** Player seat colors — distinct, cozy-muted. Index = playerId. */
export const PLAYER_COLORS = ['#a8402c', '#2c5aa8', '#3a7d44', '#c9932b', '#7d4a8d', '#1f7d7d'];

export function playerColor(id: number): string {
  return PLAYER_COLORS[id % PLAYER_COLORS.length]!;
}
