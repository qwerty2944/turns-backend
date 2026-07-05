import { Module } from "@nestjs/common";
import { multitaskManifest } from "./index.js";

export const MULTITASK_MANIFEST = "MULTITASK_MANIFEST";

/** 멀티태스크 슬라이스의 Nest 진입점 — 매니페스트를 DI로 노출한다. */
@Module({
  providers: [{ provide: MULTITASK_MANIFEST, useValue: multitaskManifest }],
  exports: [MULTITASK_MANIFEST],
})
export class MultitaskModule {}
