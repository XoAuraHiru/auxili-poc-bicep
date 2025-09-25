import { Navigate, useLocation } from "react-router-dom";
import LoadingOverlay from "./LoadingOverlay.jsx";
import { useAuth } from "../hooks/useAuth.js";

function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="page-centered">
        <LoadingOverlay message="Checking your session..." />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth/login" state={{ from: location }} replace />;
  }

  return children;
}

export default ProtectedRoute;
