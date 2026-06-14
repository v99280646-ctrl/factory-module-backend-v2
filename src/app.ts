import express from "express";
import cors from "cors";
import { apiRoutes } from "./routes/index.js";
import { attachFactoryScope } from "./middleware/auth.middleware.js";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(attachFactoryScope);

  app.get("/health", (_req, res) => {
    res.json({ success: true, data: { ok: true } });
  });

  app.use("/api/v1", apiRoutes);
  console.log("API routes mounted at /api/v1");
  return app;
}
