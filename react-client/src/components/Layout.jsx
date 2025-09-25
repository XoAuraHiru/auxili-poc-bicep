import { Outlet } from "react-router-dom";
import Header from "./Header.jsx";

function Layout() {
  return (
    <div className="app-shell">
      <Header />
      <main className="app-main">
        <Outlet />
      </main>
      <footer className="app-footer">
        <p>Azure Entra ID authentication demo · {new Date().getFullYear()}</p>
      </footer>
    </div>
  );
}

export default Layout;
