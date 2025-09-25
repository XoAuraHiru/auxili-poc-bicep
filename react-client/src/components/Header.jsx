import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth.js";

function Header() {
  const { isAuthenticated, user, logout } = useAuth();
  const location = useLocation();

  const handleLogout = () => {
    logout();
  };

  return (
    <header className="app-header">
      <div className="app-header__brand">
        <span className="app-header__logo" aria-hidden>
          ⚡
        </span>
        <div>
          <p className="app-header__title">Auxili Auth Portal</p>
          <p className="app-header__subtitle">React + Azure Functions</p>
        </div>
      </div>

      <nav className="app-header__actions">
        {isAuthenticated && user ? (
          <div className="app-header__user">
            <div className="app-header__user-details">
              <span className="app-header__user-name">
                {user.name || user.email}
              </span>
              <span className="app-header__user-email">{user.email}</span>
            </div>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={handleLogout}
            >
              Sign out
            </button>
          </div>
        ) : (
          location.pathname !== "/auth/login" && (
            <Link to="/auth/login" className="btn">
              Sign in
            </Link>
          )
        )}
      </nav>
    </header>
  );
}

export default Header;
