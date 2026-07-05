import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import type express from "express";
import { AppModule } from "./app.module.js";

/**
 * Colyseus의 express 훅이 넘겨주는 기존 Express 앱 위에 Nest를 마운트한다
 * (hybrid: 게임 룸은 Colyseus, REST는 Nest). @colyseus/tools 배포
 * 파이프라인과 그대로 호환된다.
 */
export const mountNest = async (app: express.Application): Promise<void> => {
  const nest = await NestFactory.create(AppModule, new ExpressAdapter(app), {
    logger: ["error", "warn", "log"],
  });
  await nest.init();
  console.log("[turns] NestJS mounted (auth + rooms REST)");
};
