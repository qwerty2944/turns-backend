/**
 * FX event stream — one ordered batch broadcast per resolved action.
 * Every event carries RESULTING values so the client applies deltas in
 * order without re-deriving game rules, and always converges on the
 * authoritative post-action state.
 *
 * Mirrored on the frontend at frontend/src/games/yeouido/model/types.ts.
 */
export type Loc = { sid: string; uid?: string; hero?: boolean };

export type FxEvent =
  | { t: "turnStart"; sid: string; turn: number }
  | { t: "draw"; sid: string }
  | { t: "fatigue"; sid: string; n: number }
  | { t: "burn"; sid: string; cardId: string }
  | { t: "playCard"; sid: string; cardId: string; kind: "unit" | "spell" }
  | {
      t: "summon";
      sid: string;
      uid: string;
      cardId: string;
      slot: number;
      atk: number;
      hp: number;
      maxHp: number;
      taunt: boolean;
      rush: boolean;
    }
  | { t: "attack"; from: { sid: string; uid: string }; to: Loc }
  | { t: "dmg"; at: Loc; n: number; hp: number }
  | { t: "heal"; at: Loc; n: number; hp: number }
  | { t: "buff"; at: Loc; atk: number; hp: number; maxHp: number }
  | { t: "silence"; at: Loc }
  | { t: "grantTaunt"; at: Loc }
  | { t: "transform"; at: Loc; toCardId: string; atk: number; hp: number }
  | { t: "death"; at: { sid: string; uid: string }; cardId: string }
  | { t: "rattle"; sid: string; uid: string; cardId: string }
  | { t: "spell"; sid: string; cardId: string; at?: Loc; aoe?: "enemy" | "all" | "friendly" }
  | { t: "heroPower"; sid: string }
  | { t: "discard"; sid: string; cardId: string }
  | { t: "gameEnd"; winnerSid: string };
