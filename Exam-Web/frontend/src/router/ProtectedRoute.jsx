import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ allowedRole }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
        <p>Đang xác thực phiên đăng nhập...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRole) {
    const isTeacherAlias =
      allowedRole === "TEACHER" &&
      ["TEACHER", "ADMIN", "SUPER_ADMIN"].includes(user.role);
    if (user.role !== allowedRole && !isTeacherAlias) {
      return <Navigate to="/" replace />;
    }
  }

  return <Outlet />;
}
