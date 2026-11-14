/* Copy buttons for the calendar feeds' addresses on /account/searches and
   /account/watches, and for a new API key on /account/keys. Without this
   script each address is still a read-only field a reader can select and
   copy, and the key a block of text. The button words come from the field or
   the block (data-copy, data-copied), so the script holds no copy of its own. */
(function () {
  if (!navigator.clipboard || !navigator.clipboard.writeText) return;
  function addButton(holder, after, text) {
    var label = holder.getAttribute("data-copy") || "";
    var done = holder.getAttribute("data-copied") || "";
    var button = document.createElement("button");
    button.type = "button";
    button.className = "btn calendar-copy";
    button.textContent = label;
    button.addEventListener("click", function () {
      navigator.clipboard.writeText(text()).then(function () {
        button.textContent = done;
        setTimeout(function () { button.textContent = label; }, 2000);
      }, function () {});
    });
    after.parentNode.insertBefore(button, after.nextSibling);
  }
  Array.prototype.forEach.call(document.querySelectorAll("input.calendar-address"), function (input) {
    addButton(input, input, function () { return input.value; });
  });
  // A new API key (src/account/pages.tsx keysView): the button after the key's block.
  Array.prototype.forEach.call(document.querySelectorAll("div.copy-block"), function (block) {
    var pre = block.querySelector("pre");
    if (pre) addButton(block, pre, function () { return pre.textContent.trim(); });
  });
})();
