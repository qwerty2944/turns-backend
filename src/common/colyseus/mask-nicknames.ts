// Pool used when a room is created with `maskNicknames: true`.
// Each player gets one entry pulled at game-start time; the room is at most
// MAX_PLAYERS=8, so a pool >> 8 keeps the picks visually distinct.
const POOL: ReadonlyArray<string> = [
  "용감한 사슴",
  "차분한 호랑이",
  "수상한 너구리",
  "신중한 늑대",
  "조용한 부엉이",
  "재빠른 토끼",
  "굳건한 곰",
  "엉뚱한 펭귄",
  "사나운 매",
  "외로운 여우",
  "단호한 매머드",
  "달콤한 다람쥐",
  "느긋한 거북",
  "치밀한 까마귀",
  "발랄한 햄스터",
  "냉정한 표범",
  "다정한 수달",
  "엄숙한 두루미",
  "당돌한 족제비",
  "고요한 두더지",
  "쾌활한 청설모",
  "엄격한 독수리",
  "낙천적인 강아지",
  "수줍은 고양이",
  "괴짜 라쿤",
  "근면한 비버",
  "은밀한 살쾡이",
  "활기찬 돌고래",
  "꼼꼼한 미어캣",
  "장난스런 원숭이",
  "고결한 학",
  "재간둥이 까치",
  "고독한 늑대",
  "위풍당당 사자",
  "신비한 흑표범",
  "그윽한 사슴벌레",
  "잽싼 치타",
  "오묘한 카멜레온",
  "도도한 백조",
  "능청맞은 두꺼비",
  "철두철미 오소리",
  "유쾌한 코알라",
  "단정한 판다",
  "기민한 햇살여우",
  "예리한 송골매",
  "온화한 코끼리",
  "강철 다람쥐",
  "구름 위 양",
];

/**
 * Pick `count` distinct masks from the pool. If `count` exceeds the pool size
 * (shouldn't happen with MAX_PLAYERS=8), the remainder is suffixed with " 2",
 * " 3", … so callers never collide on the displayed name.
 */
export const pickMasks = (count: number): string[] => {
  if (count <= 0) return [];
  const out: string[] = [];
  const used = new Set<string>();
  // Fisher-Yates over a copy of indices so each call is independent of POOL order.
  const indices = POOL.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  let cursor = 0;
  while (out.length < count) {
    if (cursor < indices.length) {
      const m = POOL[indices[cursor++]];
      if (!used.has(m)) {
        out.push(m);
        used.add(m);
        continue;
      }
    }
    // Fallback when count > POOL.length — append numeric suffix.
    const base = POOL[out.length % POOL.length];
    let n = 2;
    while (used.has(`${base} ${n}`)) n++;
    const next = `${base} ${n}`;
    out.push(next);
    used.add(next);
  }
  return out;
};
