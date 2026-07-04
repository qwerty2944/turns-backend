import type { Engine } from "./engine.js";
import type { Unit } from "./state.js";
import type { Faction } from "./rules.js";
import { DECK_SIZE } from "./rules.js";

export type Target =
  | "none"
  | "anyUnit"
  | "enemyUnit"
  | "friendlyUnit"
  | "any" // any unit or hero
  | "enemyAny"; // enemy unit or enemy hero

export type EffectCtx = {
  eng: Engine;
  actorSid: string;
  enemySid: string;
  /** The played (battlecry) or dead (deathrattle) unit. */
  self?: Unit;
  targetUid?: string;
  targetHeroSid?: string;
};

export type CardDef = {
  id: string;
  cost: number;
  type: "unit" | "spell";
  atk?: number;
  hp?: number;
  taunt?: boolean;
  rush?: boolean;
  faction?: Faction; // undefined = neutral
  target?: Target; // default "none"
  /** Battlecry may fire without a target (played anyway); spells with a
   *  target are unplayable when no legal target exists. */
  targetOptional?: boolean;
  battlecry?: (ctx: EffectCtx) => void;
  deathrattle?: (ctx: EffectCtx) => void;
  spell?: (ctx: EffectCtx) => void;
};

const targetLoc = (c: EffectCtx) =>
  c.targetHeroSid
    ? { sid: c.targetHeroSid, hero: true as const }
    : c.targetUid
      ? c.eng.locOfUnit(c.targetUid)
      : undefined;

// ────────────────────────────────────────────────────────────────────
// 카드 정의 — 한국 정치 풍자. 표시 이름/설명은 프론트 model/cards.ts.
// ────────────────────────────────────────────────────────────────────

export const CARDS: Record<string, CardDef> = {
  // ─── 중립 유닛 ───
  aide: { id: "aide", cost: 1, type: "unit", atk: 1, hp: 2 }, // 보좌관
  reporter: {
    id: "reporter", cost: 2, type: "unit", atk: 2, hp: 2, // 기자 — 죽메: 특종 유출(드로우)
    deathrattle: (c) => c.eng.draw(c.actorSid, 1),
  },
  pollster: {
    id: "pollster", cost: 2, type: "unit", atk: 1, hp: 3, // 여론조사기관 — 전함: 드로우
    battlecry: (c) => c.eng.draw(c.actorSid, 1),
  },
  youtuber: {
    id: "youtuber", cost: 3, type: "unit", atk: 3, hp: 2, // 유튜버 논객 — 전함: 아무 대상 1딜
    target: "any", targetOptional: true,
    battlecry: (c) => {
      const at = targetLoc(c);
      if (at) c.eng.damage(at, 1);
    },
  },
  activist: { id: "activist", cost: 3, type: "unit", atk: 2, hp: 4, taunt: true }, // 시민단체 활동가
  bodyguard: { id: "bodyguard", cost: 4, type: "unit", atk: 3, hp: 6, taunt: true }, // 경호처장
  prosecutor: {
    id: "prosecutor", cost: 4, type: "unit", atk: 4, hp: 3, // 검사 — 전함: 기소(침묵)
    target: "enemyUnit", targetOptional: true,
    battlecry: (c) => {
      if (c.targetUid) c.eng.silence(c.targetUid);
    },
  },
  speaker: { id: "speaker", cost: 5, type: "unit", atk: 4, hp: 6, taunt: true }, // 국회의장
  expresident: {
    id: "expresident", cost: 6, type: "unit", atk: 5, hp: 6, // 전직 대통령 — 죽메: 회고록 출간(드로우 2)
    deathrattle: (c) => c.eng.draw(c.actorSid, 2),
  },
  chaebol: { id: "chaebol", cost: 7, type: "unit", atk: 7, hp: 7 }, // 재벌 회장
  scarecrow: { id: "scarecrow", cost: 0, type: "unit", atk: 0, hp: 2 }, // 허수아비 (변이 전용)

  // ─── 중립 주문 ───
  comment: {
    id: "comment", cost: 1, type: "spell", target: "any", // 논평 — 2딜
    spell: (c) => {
      const at = targetLoc(c);
      if (at) c.eng.damage(at, 2);
    },
  },
  poll: {
    id: "poll", cost: 2, type: "spell", // 여론조사 — 드로우 2
    spell: (c) => c.eng.draw(c.actorSid, 2),
  },
  filibuster: {
    id: "filibuster", cost: 2, type: "spell", target: "enemyUnit", // 필리버스터 — 침묵
    spell: (c) => {
      if (c.targetUid) c.eng.silence(c.targetUid);
    },
  },
  pledge: {
    id: "pledge", cost: 2, type: "spell", target: "anyUnit", // 포퓰리즘 공약 — +2/+2
    spell: (c) => {
      if (c.targetUid) c.eng.buff(c.targetUid, 2, 2);
    },
  },
  raid: {
    id: "raid", cost: 3, type: "spell", // 압수수색 — 적 손패 무작위 1장 버리기
    spell: (c) => c.eng.discardRandom(c.enemySid, 1),
  },
  fakenews: {
    id: "fakenews", cost: 3, type: "spell", target: "enemyUnit", // 가짜뉴스 — 허수아비 0/2 변이
    spell: (c) => {
      if (c.targetUid) c.eng.transform(c.targetUid, "scarecrow");
    },
  },
  pressconf: {
    id: "pressconf", cost: 4, type: "spell", // 긴급 기자회견 — 적 유닛 전체 2딜
    spell: (c) => c.eng.aoeDamage(c.actorSid, "enemy", 2),
  },
  impeach: {
    id: "impeach", cost: 6, type: "spell", target: "enemyUnit", // 탄핵소추 — 유닛 처치
    spell: (c) => {
      if (c.targetUid) c.eng.destroy(c.targetUid);
    },
  },
  realign: {
    id: "realign", cost: 8, type: "spell", // 정계개편 — 모든 유닛 처치
    spell: (c) => c.eng.aoeDestroy(),
  },

  // ─── 여당 전용 ───
  fandom: { id: "fandom", cost: 1, type: "unit", atk: 2, hp: 1, faction: "ruling" }, // 개딸 팬덤
  hardliner: {
    id: "hardliner", cost: 4, type: "unit", atk: 5, hp: 3, rush: true, faction: "ruling", // 돌격 발언 중진
  },
  rally: {
    id: "rally", cost: 2, type: "spell", faction: "ruling", // 지지율 결집 — 본인 +5 회복
    spell: (c) => c.eng.heal({ sid: c.actorSid, hero: true }, 5),
  },
  reform: {
    id: "reform", cost: 3, type: "spell", target: "enemyUnit", faction: "ruling", // 검찰개혁 — 3딜
    spell: (c) => {
      const at = targetLoc(c);
      if (at) c.eng.damage(at, 3);
    },
  },
  candlelight: {
    id: "candlelight", cost: 5, type: "spell", faction: "ruling", // 촛불집회 — 아군 전체 +1/+1 + 도발
    spell: (c) => {
      const p = c.eng.player(c.actorSid);
      for (const u of [...p.board]) {
        c.eng.buff(u.uid, 1, 1);
        c.eng.grantTaunt(u.uid);
      }
    },
  },

  // ─── 야당 전용 ───
  sitin: {
    id: "sitin", cost: 1, type: "spell", target: "friendlyUnit", faction: "opposition", // 1인 시위 — +0/+2 + 도발
    spell: (c) => {
      if (c.targetUid) {
        c.eng.buff(c.targetUid, 0, 2);
        c.eng.grantTaunt(c.targetUid);
      }
    },
  },
  protest: {
    id: "protest", cost: 2, type: "spell", target: "enemyAny", faction: "opposition", // 장외투쟁 — 3딜
    spell: (c) => {
      const at = targetLoc(c);
      if (at) c.eng.damage(at, 3);
    },
  },
  chairman: {
    id: "chairman", cost: 4, type: "unit", atk: 4, hp: 4, faction: "opposition", // 비대위원장 — 전함: 드로우
    battlecry: (c) => c.eng.draw(c.actorSid, 1),
  },
  strongman: {
    id: "strongman", cost: 5, type: "unit", atk: 5, hp: 5, rush: true, faction: "opposition", // 돌직구 시장
  },
  martial: {
    id: "martial", cost: 8, type: "spell", faction: "opposition", // 비상계엄 — 전 유닛 처치 + 본인 지지율 -5
    spell: (c) => {
      c.eng.aoeDestroy();
      c.eng.damage({ sid: c.actorSid, hero: true }, 5);
    },
  },
};

// ────────────────────────────────────────────────────────────────────
// 진영 프리셋 덱 (정확히 20장)
// ────────────────────────────────────────────────────────────────────

const NEUTRAL_CORE = [
  "aide", "aide",
  "reporter", "reporter",
  "pollster",
  "youtuber",
  "activist",
  "bodyguard",
  "prosecutor",
  "expresident",
  "comment",
  "poll",
  "filibuster",
  "pledge",
];

export const DECKS: Record<Faction, string[]> = {
  ruling: [
    ...NEUTRAL_CORE,
    "fandom", "fandom",
    "hardliner",
    "rally",
    "reform",
    "candlelight",
  ],
  opposition: [
    ...NEUTRAL_CORE,
    "sitin",
    "protest", "protest",
    "chairman",
    "strongman",
    "martial",
  ],
};

// Startup sanity: deck sizes + id integrity.
for (const [f, deck] of Object.entries(DECKS)) {
  if (deck.length !== DECK_SIZE) {
    throw new Error(`[yeouido] ${f} deck has ${deck.length} cards, expected ${DECK_SIZE}`);
  }
  for (const id of deck) {
    if (!CARDS[id]) throw new Error(`[yeouido] deck ${f} references unknown card "${id}"`);
  }
}
