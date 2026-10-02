/* ============================================================
   order.js — order page logic
   - Reads ?id= from the URL
   - Loads that sand from /api/sands
   - Shows a live summary
   - Submits to POST /api/orders
   - Shows a thank-you message with the order number
   ============================================================ */

(function () {
  const pageError    = document.getElementById("pageError");
  const orderLayout  = document.getElementById("orderLayout");

  const formCard     = document.getElementById("formCard");
  const thankyouCard = document.getElementById("thankyouCard");
  const formErrors   = document.getElementById("formErrors");
  const form         = document.getElementById("orderForm");
  const submitBtn    = document.getElementById("submitBtn");

  const summaryImage = document.getElementById("summaryImage");
  const summaryName  = document.getElementById("summaryName");
  const summaryDesc  = document.getElementById("summaryDesc");
  const summaryPrice = document.getElementById("summaryPrice");
  const summaryQty   = document.getElementById("summaryQty");
  const summaryTotal = document.getElementById("summaryTotal");

  const qtyInput     = document.getElementById("quantity");

  let sand = null;  // the sand we're ordering

  function formatRWF(n) {
    return n.toLocaleString("en-US") + " RWF";
  }

  function showPageError(msg) {
    pageError.textContent = msg;
    pageError.style.display = "block";
    orderLayout.style.display = "none";
  }

  // -------------------------------------------------------------------
  // Load the sand from ?id=
  // -------------------------------------------------------------------
  async function loadSand() {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");

    if (!id || isNaN(Number(id))) {
      showPageError("No valid sand type was selected. Please go back to the home page and choose a sand type.");
      return;
    }

    try {
      const res = await fetch("/api/sands");
      if (!res.ok) throw new Error("Server error");
      const list = await res.json();
      sand = list.find((s) => String(s.id) === String(id));

      if (!sand) {
        showPageError("That sand type is not available. Please go back to the home page and choose another.");
        return;
      }

      // Fill the summary card
      summaryImage.src = "/images/sands/" + sand.image;
      summaryImage.alt = sand.name;
      summaryImage.onerror = () => { summaryImage.style.display = "none"; };
      summaryName.textContent  = sand.name;
      summaryDesc.textContent  = sand.description || "";
      summaryPrice.textContent = formatRWF(sand.price) + " / truck";

      orderLayout.style.display = "";
      updateTotal();
    } catch (err) {
      console.error(err);
      showPageError("Sorry, we could not load this sand type. Please try again.");
    }
  }

  // -------------------------------------------------------------------
  // Live total as the quantity changes
  // -------------------------------------------------------------------
  function updateTotal() {
    if (!sand) return;
    let q = parseInt(qtyInput.value, 10);
    if (isNaN(q) || q < 1) q = 1;
    if (q > 1000) q = 1000;

    summaryQty.textContent   = q + (q === 1 ? " truck" : " trucks");
    summaryTotal.textContent = formatRWF(sand.price * q);
  }
  qtyInput.addEventListener("input", updateTotal);

  // -------------------------------------------------------------------
  // Show validation errors from the server
  // -------------------------------------------------------------------
  function showFormErrors(payload) {
    formErrors.innerHTML = "";   // clearing is fine
    formErrors.classList.add("show");

    if (payload && payload.fields) {
      const ul = document.createElement("ul");
      Object.values(payload.fields).forEach((msg) => {
        const li = document.createElement("li");
        li.textContent = msg;     // safe
        ul.appendChild(li);
      });
      formErrors.appendChild(ul);
    } else if (payload && payload.error) {
      formErrors.textContent = payload.error;
    } else {
      formErrors.textContent = "Please check the form and try again.";
    }
  }

  function clearFormErrors() {
    formErrors.classList.remove("show");
    formErrors.innerHTML = "";
  }

  // -------------------------------------------------------------------
  // Submit the order
  // -------------------------------------------------------------------
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!sand) return;

    clearFormErrors();
    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";

    const payload = {
      sand_id:       sand.id,
      customer_name: document.getElementById("customer_name").value.trim(),
      phone:         document.getElementById("phone").value.trim(),
      district:      document.getElementById("district").value.trim(),
      address:       document.getElementById("address").value.trim(),
      quantity:      document.getElementById("quantity").value,
      notes:         document.getElementById("notes").value.trim(),
    };

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        showFormErrors(data);
        submitBtn.disabled = false;
        submitBtn.textContent = "Place order";
        return;
      }

      // Success — show the thank-you block
      showThankyou(data, payload);
    } catch (err) {
      console.error(err);
      showFormErrors({ error: "Network error. Please try again." });
      submitBtn.disabled = false;
      submitBtn.textContent = "Place order";
    }
  });

  // -------------------------------------------------------------------
  // Thank-you block
  // -------------------------------------------------------------------
  function showThankyou(data, payload) {
    formCard.style.display = "none";
    thankyouCard.style.display = "block";

    document.getElementById("thankyouOrderNo").textContent = data.order_number;

    const details = document.getElementById("thankyouDetails");
    details.innerHTML = "";   // clearing is fine

    const rows = [
      ["Sand",      sand.name],
      ["Quantity",  payload.quantity + (payload.quantity === "1" ? " truck" : " trucks")],
      ["Total",     formatRWF(data.total_price)],
      ["Order no.", data.order_number],
    ];
    rows.forEach(([label, value]) => {
      const div = document.createElement("div");
      const b = document.createElement("strong");
      b.textContent = label + ": ";
      div.appendChild(b);
      div.appendChild(document.createTextNode(value));   // safe
      details.appendChild(div);
    });

    // WhatsApp button with a pre-filled message
    const msg =
      "Hello Sand Supply Rwanda, I just placed order " + data.order_number +
      " for " + payload.quantity + " tonnes of " + sand.name + ".";
    const wa = document.getElementById("whatsappBtn");
    wa.href = "https://wa.me/250788000000?text=" + encodeURIComponent(msg);

    // Scroll to top so the user sees the message
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // -------------------------------------------------------------------
  // Go
  // -------------------------------------------------------------------
  loadSand();
})();