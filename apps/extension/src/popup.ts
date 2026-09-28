import "./popup.css";

const status = document.querySelector<HTMLParagraphElement>("#status");

if (!status) {
  throw new Error("Popup status element is missing.");
}
