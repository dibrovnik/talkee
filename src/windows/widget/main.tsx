import ReactDOM from "react-dom/client";
import "../../index.css";
import { I18nProvider } from "../../lib/i18n";
import { Widget } from "./Widget";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

ReactDOM.createRoot(rootElement).render(
  <I18nProvider>
    <Widget />
  </I18nProvider>,
);
