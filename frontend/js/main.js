/* ============================================================
   main.js — home page logic
   Loads /api/sands and draws the sand cards.
   Uses textContent (never innerHTML with user data) for safety.
   ============================================================ */

(function () {
  const grid = document.getElementById("sandGrid");

  // Format a number with thousands separators: 15000 -> "15,000"
  function formatRWF(n) {
    return n.toLocaleString("en-US");
  }

  // Create one sand card DOM node (safe: uses textContent for data)
  function createCard(sand) {
    const card = document.createElement("div");
    card.className = "sand-card";

    // --- image ---
    const thumb = document.createElement("div");
    thumb.className = "thumb";
    const img = document.createElement("img");
    img.src = "/images/sands/" + sand.image;
    img.alt = sand.name;
    // If the image is missing, just hide the broken icon
    img.onerror = () => { img.style.display = "none"; };
    thumb.appendChild(img);

    // --- body ---
    const body = document.createElement("div");
    body.className = "body";

    const h3 = document.createElement("h3");
    h3.textContent = sand.name;                 // safe

    const price = document.createElement("div");
    price.className = "price";
    price.textContent = formatRWF(sand.price) + " RWF / truck";

    const desc = document.createElement("p");
    desc.className = "desc";
    desc.textContent = sand.description || "";  // safe

    const orderLink = document.createElement("a");
    orderLink.className = "btn btn-primary";
    orderLink.href = "/order.html?id=" + encodeURIComponent(sand.id);
    orderLink.textContent = "Order";

    body.appendChild(h3);
    body.appendChild(price);
    body.appendChild(desc);
    body.appendChild(orderLink);

    card.appendChild(thumb);
    card.appendChild(body);
    return card;
  }

  // Show a friendly message in the grid
  function showMessage(text, isError) {
    grid.innerHTML = "";                        // clearing is fine
    const div = document.createElement("div");
    div.className = "state-msg" + (isError ? " error" : "");
    div.textContent = text;
    grid.appendChild(div);
  }

  // Main loader
  async function loadSands() {
    try {
      const res = await fetch("/api/sands");
      if (!res.ok) throw new Error("Server returned " + res.status);
      const sands = await res.json();

      if (!Array.isArray(sands) || sands.length === 0) {
        showMessage("No sand types are available right now.", false);
        return;
      }

      grid.innerHTML = "";
      sands.forEach((s) => grid.appendChild(createCard(s)));
    } catch (err) {
      console.error(err);
      showMessage(
        "Sorry, we could not load the sand types. Please refresh the page.",
        true
      );
    }
  }

  loadSands();
})();