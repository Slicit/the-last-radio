// Applies the saved theme before the first paint, so the page never flashes
// the wrong colours. External file because the CSP forbids inline scripts.
(function () {
  var theme = "night";
  try {
    theme = localStorage.getItem("lr_theme") || "night";
  } catch (e) {}
  if (theme === "pl") theme = "light"; // renamed
  var html = document.documentElement;
  if (theme === "light" || theme === "vintage") html.setAttribute("data-theme", theme);
  else html.classList.add("dark");
})();
