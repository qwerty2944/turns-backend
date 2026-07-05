import type { Client } from "colyseus";
import { ArraySchema } from "@colyseus/schema";
import { Player } from "./state.js";
import { pickMasks } from "../../common/colyseus/mask-nicknames.js";
import {
  CARD,
  CARD_NAMES_KR,
  DECK,
  cardNeedsTarget,
  shuffle,
} from "./rules.js";
import type { LoveLetterRoom } from "./room.js";

export type PlayPayload = {
  card: number;
  targetSessionId?: string;
  guardGuess?: number;
};

type DeckStore = {
  deck: number[];
  burned: number;
  privateHands: Map<string, number[]>;
};

/**
 * 러브레터 게임 로직 (Nest 관점의 service 레이어). Room은 전송/수명주기
 * 게이트웨이로만 남고, 라운드 진행·카드 해석·비공개 손패는 전부 여기서
 * 관리한다. Colyseus가 Room을 직접 인스턴스화하므로 DI 대신 room 참조를
 * 생성자로 받는다.
 */
export class LoveLetterService {
  private store: DeckStore = { deck: [], burned: -1, privateHands: new Map() };

  constructor(private readonly room: LoveLetterRoom) {}

  private get state() {
    return this.room.state;
  }

  /** onLeave: 이탈자의 비공개 손패 정리. */
  dropPlayer(sessionId: string) {
    this.store.privateHands.delete(sessionId);
  }

  startNewGame() {
    for (const p of this.state.players.values()) p.tokens = 0;
    this.state.lastWinnerId = "";
    this.applyMasksIfEnabled();
    this.startRound();
  }

  private applyMasksIfEnabled() {
    if (!this.state.maskNicknames) return;
    const players = Array.from(this.state.players.values());
    const masks = pickMasks(players.length);
    for (let i = 0; i < players.length; i++) {
      players[i].nickname = masks[i];
    }
    this.room.pushLog("🎭 닉네임이 가려졌습니다", { kind: "system" });
  }

  startRound() {
    const ids = Array.from(this.state.players.keys());
    this.state.turnOrder = new ArraySchema<string>(...ids);

    for (const p of this.state.players.values()) {
      p.hand = new ArraySchema<number>();
      p.discard = new ArraySchema<number>();
      p.protected = false;
      p.eliminated = false;
    }
    this.state.publicDiscard = new ArraySchema<number>();
    this.state.pendingAction = "";
    this.state.roundWinnerId = "";
    this.state.gameWinnerId = "";

    const deck = shuffle(DECK);
    this.store.burned = deck.shift()!;
    this.store.deck = deck;
    this.store.privateHands.clear();

    for (const id of ids) {
      const card = this.store.deck.shift()!;
      this.store.privateHands.set(id, [card]);
    }

    const startId =
      this.state.lastWinnerId && ids.includes(this.state.lastWinnerId)
        ? this.state.lastWinnerId
        : ids[0];
    this.state.turnIndex = ids.indexOf(startId);
    this.state.phase = "playing";
    this.room.pushLog(
      `🃏 새 라운드 시작 — ${ids.length}명, 시작: ${
        this.state.players.get(startId)?.nickname ?? ""
      }`,
      { kind: "system" },
    );
    this.syncHands();
    this.syncDeck();
    this.beginTurn();
  }

  private beginTurn() {
    const id = this.state.turnOrder[this.state.turnIndex];
    const p = this.state.players.get(id);
    if (!p) return;
    p.protected = false;
    if (this.store.deck.length === 0) {
      this.endRoundByDeckEmpty();
      return;
    }
    const drawn = this.store.deck.shift()!;
    const hand = this.store.privateHands.get(id) || [];
    hand.push(drawn);
    this.store.privateHands.set(id, hand);
    this.syncHands();
    this.syncDeck();
    this.room.pushLog(`▶ ${p.nickname} 차례 시작 — 카드를 뽑았습니다`, {
      kind: "turn",
      actor: p.nickname,
    });
  }

  handlePlayCard(client: Client, payload: PlayPayload) {
    if (this.state.phase !== "playing") return;
    const sid = client.sessionId;
    if (sid !== this.state.turnOrder[this.state.turnIndex]) return;
    const p = this.state.players.get(sid);
    if (!p || p.eliminated) return;

    const hand = this.store.privateHands.get(sid) || [];
    const cardIdx = hand.indexOf(payload.card);
    if (cardIdx < 0) return;

    if (
      hand.includes(CARD.COUNTESS) &&
      (hand.includes(CARD.KING) || hand.includes(CARD.PRINCE)) &&
      payload.card !== CARD.COUNTESS
    ) {
      return;
    }

    hand.splice(cardIdx, 1);
    this.store.privateHands.set(sid, hand);
    p.discard.push(payload.card);
    this.state.publicDiscard.push(payload.card);

    let target: Player | undefined;
    if (cardNeedsTarget(payload.card) && payload.card !== CARD.PRINCE) {
      if (!payload.targetSessionId) {
        if (this.allOthersProtectedOrEliminated(sid)) {
          this.room.pushLog(
            `${p.nickname} - ${CARD_NAMES_KR[payload.card]} (대상 없음)`,
            { kind: "play", actor: p.nickname, card: payload.card },
          );
          this.advanceTurn();
          return;
        }
        hand.push(payload.card);
        p.discard.pop();
        this.state.publicDiscard.pop();
        return;
      }
      target = this.state.players.get(payload.targetSessionId);
      if (!target || target.eliminated || target.protected) {
        if (this.allOthersProtectedOrEliminated(sid)) {
          this.room.pushLog(
            `${p.nickname} - ${CARD_NAMES_KR[payload.card]} (대상 없음)`,
            { kind: "play", actor: p.nickname, card: payload.card },
          );
          this.advanceTurn();
          return;
        }
        hand.push(payload.card);
        p.discard.pop();
        this.state.publicDiscard.pop();
        return;
      }
    }

    this.room.pushLog(
      `${p.nickname} → ${CARD_NAMES_KR[payload.card]}${
        target ? ` (대상: ${target.nickname})` : ""
      } 사용`,
      {
        kind: "play",
        actor: p.nickname,
        target: target?.nickname,
        card: payload.card,
      },
    );

    switch (payload.card) {
      case CARD.GUARD:
        if (target && payload.guardGuess && payload.guardGuess !== CARD.GUARD) {
          const targetHand =
            this.store.privateHands.get(target.sessionId) || [];
          if (targetHand.includes(payload.guardGuess)) {
            this.room.pushLog(
              `🎯 ${p.nickname}: ${target.nickname}는 ${CARD_NAMES_KR[payload.guardGuess]}였습니다 — 적중`,
              {
                kind: "reveal",
                actor: p.nickname,
                target: target.nickname,
                guess: payload.guardGuess,
              },
            );
            this.eliminate(
              target,
              `병사로 ${CARD_NAMES_KR[payload.guardGuess]} 적중`,
            );
          } else {
            this.room.pushLog(
              `❌ ${p.nickname}의 추측 (${CARD_NAMES_KR[payload.guardGuess]}) — 빗나감`,
              {
                kind: "reveal",
                actor: p.nickname,
                target: target.nickname,
                guess: payload.guardGuess,
              },
            );
          }
        }
        break;
      case CARD.PRIEST:
        if (target) {
          const targetHand =
            this.store.privateHands.get(target.sessionId) || [];
          const peeked = targetHand[0] ?? 0;
          client.send("priestPeek", {
            targetSessionId: target.sessionId,
            nickname: target.nickname,
            card: peeked,
          });
          this.room.pushLog(
            `🕯 ${p.nickname}가 ${target.nickname}의 손패를 엿봄`,
            {
              kind: "reveal",
              actor: p.nickname,
              target: target.nickname,
            },
          );
        }
        break;
      case CARD.BARON:
        if (target) {
          const myHand = this.store.privateHands.get(sid) || [];
          const tHand = this.store.privateHands.get(target.sessionId) || [];
          const my = myHand[0] ?? 0;
          const th = tHand[0] ?? 0;
          this.room.pushLog(
            `⚖ 남작 비교: ${p.nickname} ${CARD_NAMES_KR[my]} vs ${target.nickname} ${CARD_NAMES_KR[th]}`,
            {
              kind: "reveal",
              actor: p.nickname,
              target: target.nickname,
              card: my,
              guess: th,
            },
          );
          if (my > th) this.eliminate(target, `남작 비교 패배`);
          else if (th > my) this.eliminate(p, `남작 비교 패배`);
          else
            this.room.pushLog(`남작 비교 무승부`, {
              kind: "reveal",
              actor: p.nickname,
              target: target.nickname,
            });
        }
        break;
      case CARD.HANDMAID:
        p.protected = true;
        break;
      case CARD.PRINCE: {
        const tid = payload.targetSessionId || sid;
        const t = this.state.players.get(tid);
        if (!t || t.eliminated) break;
        if (tid !== sid && t.protected) break;
        const tHand = this.store.privateHands.get(tid) || [];
        const discarded = tHand.shift();
        if (discarded === CARD.PRINCESS) {
          t.discard.push(discarded);
          this.state.publicDiscard.push(discarded);
          this.eliminate(t, `왕자로 공주 버림`);
        } else if (discarded !== undefined) {
          t.discard.push(discarded);
          this.state.publicDiscard.push(discarded);
          let replacement: number | undefined;
          if (this.store.deck.length > 0) {
            replacement = this.store.deck.shift();
          } else {
            replacement = this.store.burned;
            this.store.burned = -1;
          }
          if (replacement !== undefined && replacement !== -1) {
            tHand.push(replacement);
          }
          this.store.privateHands.set(tid, tHand);
          this.room.pushLog(
            `🌀 왕자: ${t.nickname}는 ${CARD_NAMES_KR[discarded]}를 버리고 다시 뽑음`,
            {
              kind: "reveal",
              actor: p.nickname,
              target: t.nickname,
              card: discarded,
            },
          );
        }
        break;
      }
      case CARD.KING:
        if (target) {
          const myHand = this.store.privateHands.get(sid) || [];
          const tHand = this.store.privateHands.get(target.sessionId) || [];
          this.store.privateHands.set(sid, tHand);
          this.store.privateHands.set(target.sessionId, myHand);
          this.room.pushLog(
            `👑 ${p.nickname} ⇄ ${target.nickname} 손패 교환`,
            {
              kind: "reveal",
              actor: p.nickname,
              target: target.nickname,
            },
          );
        }
        break;
      case CARD.COUNTESS:
        break;
      case CARD.PRINCESS:
        this.eliminate(p, `공주 버림`);
        break;
    }

    this.syncHands();
    this.syncDeck();
    if (this.checkRoundEnd()) return;
    this.advanceTurn();
  }

  private allOthersProtectedOrEliminated(sid: string): boolean {
    for (const p of this.state.players.values()) {
      if (p.sessionId === sid) continue;
      if (!p.eliminated && !p.protected) return false;
    }
    return true;
  }

  private eliminate(p: Player, reason: string) {
    if (p.eliminated) return;
    p.eliminated = true;
    const hand = this.store.privateHands.get(p.sessionId) || [];
    for (const c of hand) {
      p.discard.push(c);
      this.state.publicDiscard.push(c);
    }
    this.store.privateHands.set(p.sessionId, []);
    this.room.pushLog(`💀 ${p.nickname} 탈락 — ${reason}`, {
      kind: "result",
      actor: p.nickname,
    });
  }

  private advanceTurn() {
    const alive = this.state.turnOrder.filter((id) => {
      const p = this.state.players.get(id);
      return p && !p.eliminated;
    });
    if (alive.length <= 1) {
      this.checkRoundEnd();
      return;
    }
    let idx = this.state.turnIndex;
    for (let i = 0; i < this.state.turnOrder.length; i++) {
      idx = (idx + 1) % this.state.turnOrder.length;
      const cand = this.state.players.get(this.state.turnOrder[idx]);
      if (cand && !cand.eliminated) {
        this.state.turnIndex = idx;
        break;
      }
    }
    this.beginTurn();
  }

  checkRoundEnd(): boolean {
    const alive = Array.from(this.state.players.values()).filter(
      (p) => !p.eliminated,
    );
    if (alive.length <= 1) {
      const winner = alive[0];
      this.finishRound(winner);
      return true;
    }
    return false;
  }

  private endRoundByDeckEmpty() {
    const alive = Array.from(this.state.players.values()).filter(
      (p) => !p.eliminated,
    );
    let best: Player | undefined;
    let bestCard = -1;
    for (const p of alive) {
      const card = (this.store.privateHands.get(p.sessionId) || [0])[0] ?? 0;
      if (card > bestCard) {
        bestCard = card;
        best = p;
      } else if (card === bestCard && best) {
        const sumP = p.discard.reduce((a, b) => a + b, 0);
        const sumB = best.discard.reduce((a, b) => a + b, 0);
        if (sumP > sumB) best = p;
      }
    }
    this.finishRound(best);
  }

  private finishRound(winner: Player | undefined) {
    if (winner) {
      winner.tokens += 1;
      this.state.roundWinnerId = winner.sessionId;
      this.state.lastWinnerId = winner.sessionId;
      this.room.pushLog(
        `🏆 라운드 승리: ${winner.nickname} (총 ${winner.tokens}점)`,
        { kind: "result", actor: winner.nickname },
      );
      if (winner.tokens >= this.state.tokensToWin) {
        this.state.gameWinnerId = winner.sessionId;
        this.state.phase = "gameEnd";
        this.room.pushLog(`🎉 게임 승리: ${winner.nickname}!`, {
          kind: "result",
          actor: winner.nickname,
        });
        return;
      }
    }
    this.state.phase = "roundEnd";
    for (const [sid, p] of this.state.players.entries()) {
      const hand = this.store.privateHands.get(sid) || [];
      for (const c of hand) {
        this.room.pushLog(
          `🔍 ${p.nickname}의 최종 손패: ${CARD_NAMES_KR[c]}`,
          {
            kind: "reveal",
            actor: p.nickname,
            card: c,
          },
        );
      }
    }
    this.syncHands(true);
  }

  // ---------- Sync helpers ----------

  private syncHands(reveal: boolean = false) {
    for (const [sid, p] of this.state.players.entries()) {
      const hand = this.store.privateHands.get(sid) || [];
      p.hand = new ArraySchema<number>(...hand);
      const client = this.room.clients.find((c) => c.sessionId === sid);
      if (!client) continue;
      client.send("hand", { cards: hand });
    }
    if (reveal) {
      for (const c of this.room.clients) {
        const allHands: Record<string, number[]> = {};
        for (const [sid] of this.state.players.entries()) {
          allHands[sid] = this.store.privateHands.get(sid) || [];
        }
        c.send("revealHands", allHands);
      }
    }
  }

  private syncDeck() {
    this.state.deckRemaining = this.store.deck.length;
  }
}
