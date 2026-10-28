import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  }),
);

app.use(express.json());
app.use(cookieParser());

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    message: "프로젝트 초기 세팅",
  });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
