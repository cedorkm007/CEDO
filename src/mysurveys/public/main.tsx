import { createRoot } from "react-dom/client";
import { SurveySiteApp } from "./SurveySiteApp";
import "./survey.css";

// Entry for survey.html -- the public respondent page. Intentionally imports
// nothing from the staff app (see the note in survey.html).
createRoot(document.getElementById("root")!).render(<SurveySiteApp />);
