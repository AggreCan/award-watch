/* The home page's Canada map (src/pages/home_map.tsx). Every layer's fills,
   labels and figures are already in the page, and the stylesheet shows the
   one the wrapper's data-layer names: a layer button sets that attribute and
   the buttons' aria-pressed, and nothing else. Without this script the first
   layer stays shown, and the table beside the map carries every figure. */
(function () {
  var map = document.getElementById("canada-map");
  if (!map) return;
  var buttons = map.querySelectorAll("button[data-map-layer]");
  map.addEventListener("click", function (e) {
    var target = e.target;
    var button = target && target.closest ? target.closest("button[data-map-layer]") : null;
    if (!button) return;
    map.setAttribute("data-layer", button.getAttribute("data-map-layer"));
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute("aria-pressed", buttons[i] === button ? "true" : "false");
    }
  });
})();
