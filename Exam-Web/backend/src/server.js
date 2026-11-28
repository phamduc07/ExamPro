import http from "node:http";
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { initializeDatabase } from "./config/db.js";
import apiRoutes from "./routes/apiRoutes.js";
import { notFoundHandler, errorHandler } from "./middlewares/errorMiddleware.js";
import {
  buildAllowedOriginsSet,
  isTrustedFrontendOrigin,
  createCsrfProtection,
} from "./middlewares/csrfMiddleware.js";
import { attachProctorSocketServer } from "./socket/proctorSocket.js";

dotenv.config();

const app = express();
const httpServer = http.createServer(app);
const PORT = Number(process.env.PORT) || 5000;

app.set("trust proxy", 1);

app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https:; script-src 'self' 'unsafe-inline'; connect-src 'self' https: http: wss: ws:;"
  );
  if (process.env.NODE_ENV === "production" || req.secure) {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  }
  next();
});

const allowedOrigins = buildAllowedOriginsSet();

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (isTrustedFrontendOrigin(origin, allowedOrigins)) {
        return callback(null, true);
      }
      const corsError = new Error("Origin không được phép bởi chính sách CORS.");
      corsError.statusCode = 403;
      return callback(corsError);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  })
);
app.use(express.json({ limit: "1mb" }));

app.use("/api", createCsrfProtection(allowedOrigins));

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "PTIT Online Exam API Server is running!",
  });
});

app.use("/api", apiRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

attachProctorSocketServer(httpServer, allowedOrigins);

async function startServer() {
  try {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET === "replace_with_your_jwt_secret") {
      throw new Error("Hãy đặt JWT_SECRET riêng trong backend/.env trước khi chạy.");
    }
    await initializeDatabase();
    httpServer.listen(PORT, () => {
      console.log(`🚀 Backend PTIT Online Exam (HTTP + Socket.IO) đang chạy tại: http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("❌ Không thể kết nối MySQL hoặc khởi tạo CSDL:", error.message);
    process.exit(1);
  }
}

startServer();
