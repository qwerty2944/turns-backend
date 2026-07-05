import type { Client } from "colyseus";
import { CARDS, DECKS, type CardDef, type Target } from "./cards.js";
import { Engine, newStore, type YeouidoStore } from "./engine.js";
import type { FxEvent } from "./fx.js";
import {
  BOARD_MAX,
  FIRST_HAND,
  HERO_POWER_COST,
  MANA_CAP,
  TURN_MS,
  type Faction,
} from "./rules.js";
import type { YeouidoRoom } from "./room.js";

export type PlayCardPayload = {
  handIdx?: number;
  slot?: number;
  targetUid?: string;
  targetHeroSid?: string;
};

export type AttackPayload = {
  attackerUid?: string;
  targetUid?: string;
  targetHeroSid?: string;
};

/**
 * 여의도 대전 게임 로직 (Nest 관점의 service 레이어). Room은 전송/수명주기
 * 게이트웨이로만 남고, 턴 진행·카드 해석·비공개 손패/덱은 전부 여기서
 * 관리한다. 전투 해석은 액션 단위 Engine이 담당하고, 이 서비스가 Engine을
 * 구동한다. Colyseus가 Room을 직접 인스턴스화하므로 DI 대신 room 참조를
 * 생성자로 받는다.
 */
export class YeouidoService {
  private store: YeouidoStore = newStore();
  private turnTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly room: YeouidoRoom) {}

  private get state() {
    return this.room.state;
  }

  /** onLeave: 이탈자의 비공개 손패/덱 정리. */
  dropPlayer(sid: string) {
    this.store.hands.delete(sid);
    this.store.decks.delete(sid);
  }

  /** onLeave(playing): 이탈자 기권패 — 상대 승리로 게임 종료. */
  forfeit(sessionId: string) {
    const enemySid = this.enemySidOf(sessionId);
    const fx: FxEvent[] = [];
    this.finishGame(enemySid, fx);
    this.broadcastFx(fx);
  }

  // ─────────────────────────── game flow ───────────────────────────

  startGame() {
    const sids = Array.from(this.state.players.keys());
    const first = sids[Math.floor(Math.random() * sids.length)];
    const second = sids.find((s) => s !== first)!;

    const fx: FxEvent[] = [];
    const eng = new Engine(this.state, this.store, fx);

    for (const sid of sids) {
      const p = this.state.players.get(sid)!;
      const deck = this.shuffleDeck(p.faction as Faction);
      this.store.decks.set(sid, deck);
      this.store.hands.set(sid, []);
      p.deckCount = deck.length;
      p.handCount = 0;
      p.hp = p.maxHp;
      p.fatigue = 0;
      p.mana = 0;
      p.manaMax = 0;
    }
    eng.draw(first, FIRST_HAND);
    eng.draw(second, FIRST_HAND + 1);

    this.state.phase = "playing";
    this.state.turnNumber = 0;
    this.room.pushLog(
      `🏁 게임 시작 — 선공: ${this.state.players.get(first)?.nickname}`,
      { kind: "result" },
    );
    this.broadcastFx(fx);
    this.syncHands();
    this.beginTurn(first);
  }

  private shuffleDeck(faction: Faction): string[] {
    const base = DECKS[faction] ?? DECKS.ruling;
    const arr = [...base];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  private beginTurn(sid: string) {
    const p = this.state.players.get(sid);
    if (!p || this.state.phase !== "playing") return;
    const token = ++this.store.turnToken;

    const fx: FxEvent[] = [];
    const eng = new Engine(this.state, this.store, fx);

    this.state.turnSid = sid;
    this.state.turnNumber += 1;
    p.manaMax = Math.min(MANA_CAP, p.manaMax + 1);
    p.mana = p.manaMax;
    p.heroPowerUsed = false;

    for (const [psid, pl] of this.state.players.entries()) {
      for (const u of pl.board) {
        if (psid === sid) {
          u.justPlayed = false;
          u.canAttack = u.atk > 0;
        } else {
          u.canAttack = false;
        }
      }
    }

    fx.push({ t: "turnStart", sid, turn: this.state.turnNumber });
    this.room.pushLog(`▶ ${p.nickname} 차례`, { kind: "turn", actor: p.nickname });
    eng.draw(sid, 1);

    if (this.checkWin(eng, sid)) {
      this.broadcastFx(fx);
      this.syncHands();
      return;
    }

    this.state.turnEndsAt = Date.now() + TURN_MS;
    this.clearTurnTimer();
    this.turnTimer = setTimeout(() => {
      if (this.store.turnToken !== token) return;
      if (this.state.phase !== "playing") return;
      this.doEndTurn();
    }, TURN_MS + 500);

    this.broadcastFx(fx);
    this.syncHands();
  }

  doEndTurn() {
    this.clearTurnTimer();
    const next = this.enemySidOf(this.state.turnSid);
    this.beginTurn(next);
  }

  // ─────────────────────────── actions ───────────────────────────

  handlePlayCard(client: Client, payload: PlayCardPayload) {
    if (this.state.phase !== "playing") return;
    if (client.sessionId !== this.state.turnSid) return;
    const sid = client.sessionId;
    const p = this.state.players.get(sid);
    if (!p) return;

    const hand = this.store.hands.get(sid) ?? [];
    const handIdx = payload.handIdx;
    if (
      typeof handIdx !== "number" ||
      !Number.isInteger(handIdx) ||
      handIdx < 0 ||
      handIdx >= hand.length
    ) {
      return;
    }
    const cardId = hand[handIdx];
    const def = CARDS[cardId];
    if (!def) return;
    if (p.mana < def.cost) return;

    const enemySid = this.enemySidOf(sid);
    const target = this.resolveTarget(def, sid, enemySid, payload);
    if (!target.ok) return;

    if (def.type === "unit" && p.board.length >= BOARD_MAX) return;

    const fx: FxEvent[] = [];
    const eng = new Engine(this.state, this.store, fx);

    // pay + remove from hand
    p.mana -= def.cost;
    hand.splice(handIdx, 1);
    p.handCount = hand.length;

    fx.push({ t: "playCard", sid, cardId, kind: def.type });

    const ctx = {
      eng,
      actorSid: sid,
      enemySid,
      targetUid: target.targetUid,
      targetHeroSid: target.targetHeroSid,
    };

    if (def.type === "unit") {
      const unit = eng.summon(sid, cardId);
      if (unit && def.battlecry) {
        def.battlecry({ ...ctx, self: unit });
      }
      this.room.pushLog(`${p.nickname} — 유닛 소환`, {
        kind: "play",
        actor: p.nickname,
        card: cardId,
      });
    } else {
      fx.push({
        t: "spell",
        sid,
        cardId,
        at: target.targetHeroSid
          ? { sid: target.targetHeroSid, hero: true }
          : target.targetUid
            ? eng.locOfUnit(target.targetUid)
            : undefined,
      });
      def.spell?.(ctx);
      this.room.pushLog(`${p.nickname} — 주문 사용`, {
        kind: "play",
        actor: p.nickname,
        card: cardId,
      });
    }

    eng.sweepDeaths();
    this.checkWin(eng, sid);
    this.broadcastFx(fx);
    this.syncHands();
  }

  handleAttack(client: Client, payload: AttackPayload) {
    if (this.state.phase !== "playing") return;
    if (client.sessionId !== this.state.turnSid) return;
    const sid = client.sessionId;
    const p = this.state.players.get(sid);
    if (!p) return;

    const attacker = p.board.find((u) => u.uid === payload.attackerUid);
    if (!attacker) return;
    if (!attacker.canAttack || attacker.atk <= 0) return;

    const enemySid = this.enemySidOf(sid);
    const enemy = this.state.players.get(enemySid);
    if (!enemy) return;

    const enemyTaunts = enemy.board.filter((u) => u.taunt && u.hp > 0);
    const attackingHero = !payload.targetUid;

    if (attackingHero) {
      // 속공 유닛은 소환 턴에 영웅 공격 불가
      if (attacker.justPlayed) return;
      if (enemyTaunts.length > 0) return;
    } else {
      const target = enemy.board.find((u) => u.uid === payload.targetUid);
      if (!target || target.hp <= 0) return;
      if (enemyTaunts.length > 0 && !target.taunt) return;
    }

    const fx: FxEvent[] = [];
    const eng = new Engine(this.state, this.store, fx);

    attacker.canAttack = false;

    if (attackingHero) {
      fx.push({
        t: "attack",
        from: { sid, uid: attacker.uid },
        to: { sid: enemySid, hero: true },
      });
      eng.damage({ sid: enemySid, hero: true }, attacker.atk);
      this.room.pushLog(`⚔ ${p.nickname}의 공격 → ${enemy.nickname} 후보`, {
        kind: "combat",
        actor: p.nickname,
        target: enemy.nickname,
        card: attacker.cardId,
      });
    } else {
      const target = enemy.board.find((u) => u.uid === payload.targetUid)!;
      fx.push({
        t: "attack",
        from: { sid, uid: attacker.uid },
        to: { sid: enemySid, uid: target.uid },
      });
      eng.damage({ sid: enemySid, uid: target.uid }, attacker.atk);
      if (target.atk > 0) {
        eng.damage({ sid, uid: attacker.uid }, target.atk);
      }
      this.room.pushLog(`⚔ ${p.nickname}의 유닛 교전`, {
        kind: "combat",
        actor: p.nickname,
        card: attacker.cardId,
      });
    }

    eng.sweepDeaths();
    this.checkWin(eng, sid);
    this.broadcastFx(fx);
    this.syncHands();
  }

  handleHeroPower(client: Client) {
    if (this.state.phase !== "playing") return;
    if (client.sessionId !== this.state.turnSid) return;
    const sid = client.sessionId;
    const p = this.state.players.get(sid);
    if (!p || p.heroPowerUsed || p.mana < HERO_POWER_COST) return;

    const fx: FxEvent[] = [];
    const eng = new Engine(this.state, this.store, fx);

    p.mana -= HERO_POWER_COST;
    p.heroPowerUsed = true;
    fx.push({ t: "heroPower", sid });

    if (p.faction === "ruling") {
      // 여론 조성 — 본인 지지율 +2
      eng.heal({ sid, hero: true }, 2);
    } else {
      // 국정감사 — 적 후보에게 1 피해
      eng.damage({ sid: this.enemySidOf(sid), hero: true }, 1);
    }
    this.room.pushLog(`✨ ${p.nickname} — 영웅 능력`, {
      kind: "play",
      actor: p.nickname,
    });

    eng.sweepDeaths();
    this.checkWin(eng, sid);
    this.broadcastFx(fx);
    this.syncHands();
  }

  // ─────────────────────────── helpers ───────────────────────────

  private resolveTarget(
    def: CardDef,
    actorSid: string,
    enemySid: string,
    payload: PlayCardPayload,
  ): { ok: boolean; targetUid?: string; targetHeroSid?: string } {
    const selector: Target = def.target ?? "none";
    if (selector === "none") return { ok: true };

    const me = this.state.players.get(actorSid)!;
    const enemy = this.state.players.get(enemySid)!;

    const isValid = (uid?: string, heroSid?: string): boolean => {
      if (heroSid) {
        if (selector === "any") return heroSid === actorSid || heroSid === enemySid;
        if (selector === "enemyAny") return heroSid === enemySid;
        return false;
      }
      if (!uid) return false;
      const onEnemy = enemy.board.some((u) => u.uid === uid && u.hp > 0);
      const onMine = me.board.some((u) => u.uid === uid && u.hp > 0);
      switch (selector) {
        case "enemyUnit":
          return onEnemy;
        case "friendlyUnit":
          return onMine;
        case "anyUnit":
          return onEnemy || onMine;
        case "any":
        case "enemyAny":
          return selector === "any" ? onEnemy || onMine : onEnemy;
        default:
          return false;
      }
    };

    const anyLegalTarget = (): boolean => {
      switch (selector) {
        case "enemyUnit":
          return enemy.board.length > 0;
        case "friendlyUnit":
          return me.board.length > 0;
        case "anyUnit":
          return enemy.board.length > 0 || me.board.length > 0;
        case "any":
        case "enemyAny":
          return true; // heroes are always available
        default:
          return false;
      }
    };

    const provided = !!(payload.targetUid || payload.targetHeroSid);

    if (!provided) {
      // battlecry without target is fine (fires blank); targeted spells
      // are only playable targetless when NO legal target exists
      if (def.type === "unit") return { ok: true };
      return anyLegalTarget() ? { ok: false } : { ok: true };
    }

    if (!isValid(payload.targetUid, payload.targetHeroSid)) return { ok: false };
    return {
      ok: true,
      targetUid: payload.targetUid,
      targetHeroSid: payload.targetHeroSid,
    };
  }

  private checkWin(eng: Engine, actorSid: string): boolean {
    if (this.state.phase !== "playing") return true;
    const enemySid = this.enemySidOf(actorSid);
    const me = this.state.players.get(actorSid);
    const enemy = this.state.players.get(enemySid);
    if (!me || !enemy) return false;
    // 동시 파괴는 행동한 쪽 승리
    if (enemy.hp <= 0) {
      this.finishGame(actorSid, eng.fx);
      return true;
    }
    if (me.hp <= 0) {
      this.finishGame(enemySid, eng.fx);
      return true;
    }
    return false;
  }

  private finishGame(winnerSid: string, fx: FxEvent[]) {
    if (this.state.phase === "gameEnd") return;
    this.clearTurnTimer();
    this.state.phase = "gameEnd";
    this.state.winnerSid = winnerSid;
    this.state.turnEndsAt = 0;
    const winner = this.state.players.get(winnerSid);
    fx.push({ t: "gameEnd", winnerSid });
    this.room.pushLog(`🏆 ${winner?.nickname ?? "?"} 후보 당선!`, {
      kind: "result",
      actor: winner?.nickname ?? "",
    });
  }

  private enemySidOf(sid: string): string {
    for (const key of this.state.players.keys()) {
      if (key !== sid) return key;
    }
    return sid;
  }

  private broadcastFx(fx: FxEvent[]) {
    if (fx.length === 0) return;
    this.room.broadcast("fx", { seq: ++this.store.fxSeq, events: fx });
  }

  private syncHands() {
    for (const [sid] of this.state.players.entries()) {
      const client = this.room.clients.find((c) => c.sessionId === sid);
      if (!client) continue;
      client.send("hand", { cards: this.store.hands.get(sid) ?? [] });
    }
  }

  clearTurnTimer() {
    if (this.turnTimer) {
      clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }
}
