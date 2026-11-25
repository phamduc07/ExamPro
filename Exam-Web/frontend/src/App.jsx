import { useEffect } from "react";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { DialogProvider } from "./context/DialogContext";
import AppRouter from "./router/AppRouter";

export default function App() {
  useEffect(() => {
    let rafId = null;
    let lastEvent = null;

    const applyPointerEffect = () => {
      rafId = null;
      const e = lastEvent;
      if (!e) return;
      const root = document.documentElement;
      root.style.setProperty("--mouse-x", `${e.clientX}px`);
      root.style.setProperty("--mouse-y", `${e.clientY}px`);

      const target = e.target;
      const card =
        target && typeof target.closest === "function"
          ? target.closest(
              ".exam-card, .stat-box, .hero-feature-item, .intro-metric-item, .auth-card"
            )
          : null;
      if (card) {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        card.style.setProperty("--card-x", `${x}px`);
        card.style.setProperty("--card-y", `${y}px`);

        if (!card.classList.contains("auth-card")) {
          const centerX = rect.width / 2;
          const centerY = rect.height / 2;
          const rotateX = ((y - centerY) / centerY) * -4;
          const rotateY = ((x - centerX) / centerX) * 4;
          card.style.setProperty("--rx", `${rotateX.toFixed(2)}deg`);
          card.style.setProperty("--ry", `${rotateY.toFixed(2)}deg`);
        }
      }
    };

    const handleMouseMove = (e) => {
      lastEvent = e;
      if (rafId === null) {
        rafId = window.requestAnimationFrame(applyPointerEffect);
      }
    };

    window.addEventListener("mousemove", handleMouseMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, []);

  return (
    <BrowserRouter>
      <AuthProvider>
        <DialogProvider>
          <div className="cursor-spotlight" aria-hidden="true" />
          <AppRouter />
        </DialogProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
