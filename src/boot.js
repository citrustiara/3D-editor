const showStartupError = (error) => {
  console.error("Editor failed to start", error);
  const output = document.querySelector("#validation-output");
  if (!output) return;
  const message = error?.message || String(error);
  output.innerHTML = `
    <div class="issue">
      <span class="badge error">error</span>
      <span>Editor failed to start: ${message.replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[char])}</span>
    </div>
  `;
};

import("./editor.js").catch(showStartupError);
