import { ArraySchema } from "@colyseus/schema";
import { Unit, YeouidoPlayer, YeouidoState } from "./state.js";
import { CARDS } from "./cards.js";
import type { FxEvent, Loc } from "./fx.js";
import { BOARD_MAX, HAND_MAX } from "./rules.js";

export type YeouidoStore = {
  decks: Map<string, string[]>; // sid -> remaining cardIds (index 0 = top)
  hands: Map<string, string[]>; // sid -> cardIds — never in schema
  uidCounter: number;
  fxSeq: number;
  turnToken: number;
};

export const newStore = (): YeouidoStore => ({
  decks: new Map(),
  hands: new Map(),
  uidCounter: 0,
  fxSeq: 0,
  turnToken: 0,
});

/**
 * Combat engine — one instance per resolved action. Every primitive
 * mutates the schema/store AND pushes an FxEvent carrying the resulting
 * values, so the client can replay the batch without knowing the rules.
 */
export class Engine {
  constructor(
    private state: YeouidoState,
    private store: YeouidoStore,
    public fx: FxEvent[],
  ) {}

  player(sid: string): YeouidoPlayer {
    const p = this.state.players.get(sid);
    if (!p) throw new Error(`[yeouido] no player ${sid}`);
    return p;
  }

  enemyOf(sid: string): string {
    for (const key of this.state.players.keys()) {
      if (key !== sid) return key;
    }
    return sid;
  }

  findUnit(uid: string): { unit: Unit; ownerSid: string } | null {
    for (const [sid, p] of this.state.players.entries()) {
      for (const u of p.board) {
        if (u.uid === uid) return { unit: u, ownerSid: sid };
      }
    }
    return null;
  }

  locOfUnit(uid: string): Loc | undefined {
    const found = this.findUnit(uid);
    return found ? { sid: found.ownerSid, uid } : undefined;
  }

  // ─── primitives ───

  damage(at: Loc, n: number): void {
    if (n <= 0) return;
    if (at.hero) {
      const p = this.player(at.sid);
      p.hp -= n;
      this.fx.push({ t: "dmg", at, n, hp: p.hp });
      return;
    }
    if (!at.uid) return;
    const found = this.findUnit(at.uid);
    if (!found) return;
    found.unit.hp -= n;
    this.fx.push({ t: "dmg", at, n, hp: found.unit.hp });
  }

  heal(at: Loc, n: number): void {
    if (n <= 0) return;
    if (at.hero) {
      const p = this.player(at.sid);
      const healed = Math.min(p.maxHp, p.hp + n);
      const gained = healed - p.hp;
      if (gained <= 0) return;
      p.hp = healed;
      this.fx.push({ t: "heal", at, n: gained, hp: p.hp });
      return;
    }
    if (!at.uid) return;
    const found = this.findUnit(at.uid);
    if (!found) return;
    const u = found.unit;
    const healed = Math.min(u.maxHp, u.hp + n);
    const gained = healed - u.hp;
    if (gained <= 0) return;
    u.hp = healed;
    this.fx.push({ t: "heal", at, n: gained, hp: u.hp });
  }

  /** Summon; silently fizzles if the board is full (HS rule).
   *  Always appends — Colyseus ArraySchema#splice cannot insert, and slot
   *  position is purely cosmetic in this card set. */
  summon(sid: string, cardId: string): Unit | null {
    const p = this.player(sid);
    if (p.board.length >= BOARD_MAX) return null;
    const def = CARDS[cardId];
    if (!def || def.type !== "unit") return null;

    const u = new Unit();
    u.uid = `u${++this.store.uidCounter}`;
    u.cardId = cardId;
    u.atk = def.atk ?? 0;
    u.hp = def.hp ?? 1;
    u.maxHp = def.hp ?? 1;
    u.taunt = !!def.taunt;
    u.rush = !!def.rush;
    u.justPlayed = true;
    u.canAttack = !!def.rush && u.atk > 0;

    const at = p.board.length;
    p.board.push(u);
    this.fx.push({
      t: "summon",
      sid,
      uid: u.uid,
      cardId,
      slot: at,
      atk: u.atk,
      hp: u.hp,
      maxHp: u.maxHp,
      taunt: u.taunt,
      rush: u.rush,
    });
    return u;
  }

  draw(sid: string, n = 1): void {
    const p = this.player(sid);
    const deck = this.store.decks.get(sid) ?? [];
    const hand = this.store.hands.get(sid) ?? [];
    for (let i = 0; i < n; i++) {
      if (deck.length === 0) {
        // 탈진 — 정치자금이 바닥나면 지지율이 깎인다
        p.fatigue += 1;
        this.fx.push({ t: "fatigue", sid, n: p.fatigue });
        this.damage({ sid, hero: true }, p.fatigue);
        continue;
      }
      const cardId = deck.shift()!;
      if (hand.length >= HAND_MAX) {
        this.fx.push({ t: "burn", sid, cardId });
      } else {
        hand.push(cardId);
        this.fx.push({ t: "draw", sid });
      }
    }
    p.deckCount = deck.length;
    p.handCount = hand.length;
  }

  discardRandom(sid: string, n = 1): void {
    const p = this.player(sid);
    const hand = this.store.hands.get(sid) ?? [];
    for (let i = 0; i < n && hand.length > 0; i++) {
      const idx = Math.floor(Math.random() * hand.length);
      const [cardId] = hand.splice(idx, 1);
      this.fx.push({ t: "discard", sid, cardId });
    }
    p.handCount = hand.length;
  }

  buff(uid: string, atk: number, hp: number): void {
    const found = this.findUnit(uid);
    if (!found) return;
    const u = found.unit;
    u.atk = Math.max(0, u.atk + atk);
    u.maxHp += hp;
    u.hp += hp;
    this.fx.push({
      t: "buff",
      at: { sid: found.ownerSid, uid },
      atk: u.atk,
      hp: u.hp,
      maxHp: u.maxHp,
    });
  }

  silence(uid: string): void {
    const found = this.findUnit(uid);
    if (!found) return;
    const u = found.unit;
    u.silenced = true;
    u.taunt = false;
    u.rush = false;
    this.fx.push({ t: "silence", at: { sid: found.ownerSid, uid } });
  }

  grantTaunt(uid: string): void {
    const found = this.findUnit(uid);
    if (!found || found.unit.silenced) return;
    found.unit.taunt = true;
    this.fx.push({ t: "grantTaunt", at: { sid: found.ownerSid, uid } });
  }

  destroy(uid: string): void {
    const found = this.findUnit(uid);
    if (!found) return;
    found.unit.hp = 0;
    // no fx here — sweepDeaths emits the death
  }

  transform(uid: string, toCardId: string): void {
    const found = this.findUnit(uid);
    const def = CARDS[toCardId];
    if (!found || !def || def.type !== "unit") return;
    const u = found.unit;
    u.cardId = toCardId;
    u.atk = def.atk ?? 0;
    u.hp = def.hp ?? 1;
    u.maxHp = def.hp ?? 1;
    u.taunt = !!def.taunt;
    u.rush = !!def.rush;
    u.silenced = false;
    u.canAttack = false;
    this.fx.push({
      t: "transform",
      at: { sid: found.ownerSid, uid },
      toCardId,
      atk: u.atk,
      hp: u.hp,
    });
  }

  aoeDamage(actorSid: string, side: "enemy" | "all" | "friendly", n: number): void {
    const enemySid = this.enemyOf(actorSid);
    const sids =
      side === "all" ? [actorSid, enemySid] : side === "enemy" ? [enemySid] : [actorSid];
    for (const sid of sids) {
      // snapshot — damage doesn't remove units (sweep does), but be safe
      for (const u of [...this.player(sid).board]) {
        this.damage({ sid, uid: u.uid }, n);
      }
    }
  }

  aoeDestroy(): void {
    for (const [sid, p] of this.state.players.entries()) {
      for (const u of [...p.board]) {
        void sid;
        u.hp = 0;
      }
    }
  }

  /**
   * Remove dead units, firing deathrattles (which may summon/damage and
   * cause further deaths). Iterates until stable, bounded for safety.
   */
  sweepDeaths(): void {
    for (let pass = 0; pass < 20; pass++) {
      const dead: { unit: Unit; ownerSid: string }[] = [];
      for (const [sid, p] of this.state.players.entries()) {
        for (const u of p.board) {
          if (u.hp <= 0) dead.push({ unit: u, ownerSid: sid });
        }
      }
      if (dead.length === 0) return;
      for (const d of dead) {
        const board = this.player(d.ownerSid).board as ArraySchema<Unit>;
        const idx = board.indexOf(d.unit);
        if (idx >= 0) board.splice(idx, 1); // remove FIRST so rattle summons have space
        this.fx.push({
          t: "death",
          at: { sid: d.ownerSid, uid: d.unit.uid },
          cardId: d.unit.cardId,
        });
        const def = CARDS[d.unit.cardId];
        if (def?.deathrattle && !d.unit.silenced) {
          this.fx.push({ t: "rattle", sid: d.ownerSid, uid: d.unit.uid, cardId: d.unit.cardId });
          def.deathrattle({
            eng: this,
            actorSid: d.ownerSid,
            enemySid: this.enemyOf(d.ownerSid),
            self: d.unit,
          });
        }
      }
    }
  }
}
