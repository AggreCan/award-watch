/* Copy buttons for the calendar feeds' addresses on /account/searches.
   Without this script each address is still a read-only field a reader can
   select and copy. The button words come from the field (data-copy,
   data-copied), so the script holds no copy of its own. */
(function () {
  if (!navigator.clipboard || !navigator.clipboard.writeText) return;
  Array.prototype.forEach.call(document.querySelectorAll("input.calendar-address"), function (input) {
    var label = input.getAttribute("data-copy") || "";
    var done = input.getAttribute("data-copied") || "";
    var button = document.createElement("button");
    button.type = "button";
    button.className = "btn calendar-copy";
    button.textContent = label;
    button.addEventListener("click", function () {
      navigator.clipboard.writeText(input.value).then(function () {
        button.textContent = done;
        setTimeout(function () { button.textContent = label; }, 2000);
      }, function () {});
    });
    input.parentNode.insertBefore(button, input.nextSibling);
  });
})();
