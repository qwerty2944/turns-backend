import { Module } from "@nestjs/common";
import { tetrisManifest } from "./index.js";

export const TETRIS_MANIFEST = "TETRIS_MANIFEST";

/** 테트리스 슬라이스의 Nest 진입점 — 매니페스트를 DI로 노출한다. */
@Module({
  providers: [{ provide: TETRIS_MANIFEST, useValue: tetrisManifest }],
  exports: [TETRIS_MANIFEST],
})
export class TetrisModule {}
