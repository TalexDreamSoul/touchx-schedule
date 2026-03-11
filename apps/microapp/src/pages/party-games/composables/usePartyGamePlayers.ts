import { ref } from "vue";

export interface PartyGamePlayer {
  id: string;
  name: string;
  alive: boolean;
}

const DEFAULT_PLAYER_NAMES = [
  "玩家1",
  "玩家2",
  "玩家3",
  "玩家4",
  "玩家5",
  "玩家6",
  "玩家7",
  "玩家8",
  "玩家9",
  "玩家10",
  "玩家11",
  "玩家12",
];

const createPlayerId = () => {
  return `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
};

const clonePlayer = (player: PartyGamePlayer): PartyGamePlayer => ({
  id: player.id,
  name: player.name,
  alive: player.alive,
});

export const buildDefaultPlayers = (count: number): PartyGamePlayer[] => {
  const safeCount = Math.max(2, Math.min(12, Math.floor(Number(count || 0)) || 8));
  return Array.from({ length: safeCount }, (_, index) => ({
    id: createPlayerId(),
    name: DEFAULT_PLAYER_NAMES[index] || `玩家${index + 1}`,
    alive: true,
  }));
};

export const usePartyGamePlayers = (initialCount: number) => {
  const players = ref<PartyGamePlayer[]>(buildDefaultPlayers(initialCount));
  const newPlayerName = ref("");

  const addPlayer = () => {
    if (players.value.length >= 12) {
      uni.showToast({ title: "最多 12 人", icon: "none" });
      return;
    }
    const name = newPlayerName.value.trim();
    if (!name) {
      uni.showToast({ title: "请输入玩家名称", icon: "none" });
      return;
    }
    players.value.push({
      id: createPlayerId(),
      name,
      alive: true,
    });
    newPlayerName.value = "";
  };

  const removePlayer = (playerId: string) => {
    players.value = players.value.filter((item) => item.id !== playerId);
  };

  const toggleAlive = (playerId: string) => {
    players.value = players.value.map((item) => {
      if (item.id !== playerId) {
        return item;
      }
      return {
        ...item,
        alive: !item.alive,
      };
    });
  };

  const markAllAlive = () => {
    players.value = players.value.map((item) => ({
      ...item,
      alive: true,
    }));
  };

  const shufflePlayers = () => {
    const next = players.value.map(clonePlayer);
    for (let index = next.length - 1; index > 0; index -= 1) {
      const randomIndex = Math.floor(Math.random() * (index + 1));
      const temp = next[index];
      next[index] = next[randomIndex];
      next[randomIndex] = temp;
    }
    players.value = next;
  };

  const resetPlayers = (count: number = initialCount) => {
    players.value = buildDefaultPlayers(count);
    newPlayerName.value = "";
  };

  return {
    players,
    newPlayerName,
    addPlayer,
    removePlayer,
    toggleAlive,
    markAllAlive,
    shufflePlayers,
    resetPlayers,
  };
};
