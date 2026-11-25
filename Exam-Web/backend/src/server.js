import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { initializeDatabase } from "./config/db.js";
import apiRoutes from "./routes/apiRoutes.js";
import { notFoundHandler, errorHandler } from "./middlewares/errorMiddleware.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 5000;

app.set("trust proxy", 1);

app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https:; script-src 'self' 'unsafe-inline'; connect-src 'self' https: http:;"
  );
  if (process.env.NODE_ENV === "production" || req.secure) {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  }
  next();
});

app.use(
  cors({
    origin: (process.env.FRONTEND_URL || "http://localhost:5173").split(",").map((url) => url.trim()),
    credentials: true,
  })
);
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "PTIT Online Exam API Server is running!",
  });
});

app.use("/api", apiRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

async function startServer() {
  try {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET === "replace_with_your_jwt_secret") {
      throw new Error("Hãy đặt JWT_SECRET riêng trong backend/.env trước khi chạy.");
    }
    await initializeDatabase();
    app.listen(PORT, () => {
      console.log(`🚀 Backend PTIT Online Exam đang chạy tại: http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("❌ Không thể kết nối MySQL hoặc khởi tạo CSDL:", error.message);
    process.exit(1);
  }
}

startServer();
