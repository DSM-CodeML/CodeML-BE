import path from "node:path";
import { pathToFileURL } from "node:url";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { env } from "./config/env.js";
import { sequelize } from "./config/db.js";
import { authRouter } from "./routes/auth.routes.js";
import { grassRouter } from "./routes/grass.routes.js";
import { problemRouter } from "./routes/problem.routes.js";
import { trailRouter } from "./routes/trail.routes.js";
import { errorHandler, notFoundHandler } from "./middlewares/error.middleware.js";

export const app = express();
app.disable("x-powered-by");

app.use(
  cors({
    origin: env.allowedOrigins, // 정확히 일치하는 Origin에만 Access-Control-Allow-Origin 응답
    credentials: true,
  }),
);

// 코드 8,000자(MAX_CODE_LENGTH)가 JSON 이스케이프(\uXXXX, 최대 6바이트/자)돼도 들어오도록 바이트 기준으로 여유 있게 잡는다.
app.use(express.json({ limit: "64kb" }));
app.use(cookieParser());

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "프로젝트 초기 세팅",
  });
});

app.use("/api/auth", authRouter);
app.use("/api/grass", grassRouter);
app.use("/api/trail", trailRouter);
app.use("/api", problemRouter);

app.use(notFoundHandler);
app.use(errorHandler);

// `node src/app.js`(npm start/dev)로 직접 실행할 때만 서버를 띄운다. 테스트에서 import할 때는 띄우지 않는다.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  try {
    await sequelize.authenticate(); // DB 연결 확인 후 기동 (실패 시 바로 종료)
  } catch (err) {
    console.error("DB 연결 실패:", err.parent?.code ?? err.name, err.parent?.sqlMessage ?? "");
    process.exit(1);
  }
  app.listen(env.port, () => {
    console.log(`Server running on http://localhost:${env.port}`);
  });
}
