import { Module } from "@nestjs/common";
import { mafiaManifest } from "./index.js";

export const MAFIA_MANIFEST = "MAFIA_MANIFEST";

/** 마피아 슬라이스의 Nest 진입점 — 매니페스트를 DI로 노출한다. */
@Module({
  providers: [{ provide: MAFIA_MANIFEST, useValue: mafiaManifest }],
  exports: [MAFIA_MANIFEST],
})
export class MafiaModule {}
