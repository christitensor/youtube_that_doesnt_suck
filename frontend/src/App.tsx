import { useState } from "react";
import { WatchLater } from "./pages/WatchLater";
import { Settings } from "./pages/Settings";
import { QueueIcon, SettingsIcon } from "./lib/icons";
import "./App.css";

type Tab = "watch-later" | "settings";

function App() {
  const [tab, setTab] = useState<Tab>("watch-later");

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <span className="logo-dot" />
          Watch Later
        </h1>
      </header>

      <main className="app-main">{tab === "watch-later" ? <WatchLater /> : <Settings />}</main>

      <nav className="tab-bar">
        <button className={tab === "watch-later" ? "active" : ""} onClick={() => setTab("watch-later")}>
          <QueueIcon size={20} />
          Queue
        </button>
        <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>
          <SettingsIcon size={20} />
          Settings
        </button>
      </nav>
    </div>
  );
}

export default App;
