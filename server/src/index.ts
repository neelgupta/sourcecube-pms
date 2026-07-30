import "dotenv/config";
import http from "node:http";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { authRouter } from "./routes/auth.js";
import { companiesRouter } from "./routes/companies.js";
import { auditRouter } from "./routes/audit.js";
import { onboardingRouter } from "./routes/onboarding.js";
import { companyUsersRouter } from "./routes/companyUsers.js";
import { settingsRouter } from "./routes/settings.js";
import { departmentsRouter } from "./routes/departments.js";
import { teamsRouter } from "./routes/teams.js";
import { projectsRouter } from "./routes/projects.js";
import { resourcesRouter } from "./routes/resources.js";
import { reportsRouter } from "./routes/reports.js";
import { chatRouter } from "./routes/chat.js";
import { UPLOADS_ROOT } from "./lib/uploads.js";
import { initChatSocket } from "./lib/chatSocket.js";

const app = express();

const allowedOrigins = (process.env.CLIENT_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim());

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(cookieParser());
app.use("/uploads", express.static(UPLOADS_ROOT));

app.use("/api/auth", authRouter);
app.use("/api/companies", companiesRouter);
app.use("/api/audit", auditRouter);
app.use("/api/onboarding", onboardingRouter);
app.use("/api/company-users", companyUsersRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/departments", departmentsRouter);
app.use("/api/teams", teamsRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/resources", resourcesRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/chat", chatRouter);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const port = Number(process.env.PORT ?? 4000);
const httpServer = http.createServer(app);
initChatSocket(httpServer, allowedOrigins);
httpServer.listen(port, () => console.log(`API listening on http://localhost:${port}`));
