// Entry for bridging.html (/bridging). Intentionally imports nothing from the staff app or the other portals, so only Bridging code is downloaded.
import { createRoot } from "react-dom/client";
import { BridgingApp } from "./BridgingApp";
import "./bridging.css";

createRoot(document.getElementById("root")!).render(<BridgingApp />);
