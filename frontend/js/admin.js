/* ============================================================
   admin.js — admin dashboard logic
   - Loads stats + orders + sands
   - Filters orders by status and search
   - Updates status, deletes orders
   - Edits sand price / description / active
   - Auto-refreshes orders every 60 seconds
   ============================================================ */

(function () {
  // Guard: if we're not on the dashboard page, do nothing.
  if (!document.getElementById("ordersBody")) return;

  // ---------- DOM refs ----------
  const ordersBody   = document.getElementById("ordersBody");
  const statTotal    = document.getElementById("statTotal");
  const statNew      = document.getElementById("statNew");
  const statDelivered= document.getElementById("statDelivered");
  const statRevenue  = document.getElementById("statRevenue");
  const searchInput  = document.getElementById("searchInput");
  const filterBtns   = document.querySelectorAll(".filter-btn");
  const sandsList    = document.getElementById("sandsList");
  const toast        = document.getElementById("toast");
  const logoutBtn    = document.getElementById("logoutBtn");
  const tabBtns      = document.querySelectorAll(".tab-btn");
  const tabPanels    = document.querySelectorAll(".tab-panel");

  let currentStatus = "All";
  let currentSearch = "";

  // ---------- Helpers ----------
  function formatRWF(n) {
    return (n || 0).toLocaleString("en-US") + " RWF";
  }

  function formatDate(iso) {
    // SQLite gives "YYYY-MM-DD HH:MM:SS" in UTC.
    try {
      const d = new Date(iso.replace(" ", "T") + "Z");
      return d.toLocaleString();
    } catch (e) {
      return iso;
    }
  }

  function showToast(msg, isError) {
    toast.textContent = msg;
    toast.classList.toggle("error", !!isError);
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2600);
  }

  // If the API says 401, bounce to login
  function handleAuth(res) {
    if (res.status === 401) {
      window.location.href = "/admin";
      return true;
    }
    return false;
  }

  // Escape helper — used everywhere we build HTML strings from data.
  // Even though we prefer textContent, this protects any place we
  // must use innerHTML (like building a table row).
  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // ---------- Tabs ----------
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => b.classList.remove("active"));
      tabPanels.forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab).classList.add("active");
    });
  });

  // ---------- Stats ----------
  async function loadStats() {
    try {
      const res = await fetch("/api/admin/stats");
      if (handleAuth(res)) return;
      if (!res.ok) throw new Error("stats failed");
      const s = await res.json();
      statTotal.textContent     = s.total_orders;
      statNew.textContent       = s.new_orders;
      statDelivered.textContent = s.delivered_orders;
      statRevenue.textContent   = formatRWF(s.delivered_revenue);
    } catch (err) {
      console.error(err);
    }
  }

  // ---------- Orders ----------
  async function loadOrders() {
    try {
      const params = new URLSearchParams();
      if (currentStatus && currentStatus !== "All") params.set("status", currentStatus);
      if (currentSearch) params.set("search", currentSearch);

      const res = await fetch("/api/admin/orders?" + params.toString());
      if (handleAuth(res)) return;
      if (!res.ok) throw new Error("orders failed");
      const orders = await res.json();

      renderOrders(orders);
    } catch (err) {
      console.error(err);
      ordersBody.innerHTML =
        '<tr><td colspan="9" class="empty-msg">Could not load orders.</td></tr>';
    }
  }

  function renderOrders(orders) {
    ordersBody.innerHTML = "";

    if (!orders.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 9;
      td.className = "empty-msg";
      td.textContent = "No orders found.";
      tr.appendChild(td);
      ordersBody.appendChild(tr);
      return;
    }

    orders.forEach((o) => {
      const tr = document.createElement("tr");

      // We build cells with textContent where possible.
      // For the status select and delete button we use DOM APIs too.

      // Order no.
      tr.appendChild(cell("Order", "#" + (1000 + o.id)));

      // Date
      tr.appendChild(cell("Date", formatDate(o.created_at)));

      // Customer
      tr.appendChild(cell("Customer", o.customer_name));

      // Phone (clickable)
      const phoneTd = document.createElement("td");
      phoneTd.dataset.label = "Phone";
      phoneTd.className = "phone";
      const phoneSpan = document.createElement("span");
      phoneSpan.className = "cell-value";
      const phoneLink = document.createElement("a");
      phoneLink.href = "tel:" + o.phone;
      phoneLink.textContent = o.phone;
      phoneSpan.appendChild(phoneLink);
      phoneTd.appendChild(phoneSpan);
      tr.appendChild(phoneTd);

      // District / address
      tr.appendChild(cell("Location", o.district + " — " + o.address));

      // Sand
      tr.appendChild(cell("Sand", o.sand_name));

      // Quantity
      tr.appendChild(cell("Qty", o.quantity + " trucks"));

      // Total
      const totalTd = document.createElement("td");
      totalTd.dataset.label = "Total";
      totalTd.className = "total";
      const totalSpan = document.createElement("span");
      totalSpan.className = "cell-value";
      totalSpan.textContent = formatRWF(o.total_price);
      totalTd.appendChild(totalSpan);
      tr.appendChild(totalTd);

      // Status + delete (one cell)
      const actionsTd = document.createElement("td");
      actionsTd.dataset.label = "Status";

      const select = document.createElement("select");
      select.className = "status-select " + o.status;
      ["New", "Confirmed", "Delivered", "Cancelled"].forEach((st) => {
        const opt = document.createElement("option");
        opt.value = st;
        opt.textContent = st;
        if (st === o.status) opt.selected = true;
        select.appendChild(opt);
      });
      select.addEventListener("change", () => updateStatus(o.id, select.value, select));

      const delBtn = document.createElement("button");
      delBtn.className = "delete-btn";
      delBtn.textContent = "Delete";
      delBtn.style.marginLeft = "6px";
      delBtn.addEventListener("click", () => deleteOrder(o.id, o.customer_name));

      const wrap = document.createElement("div");
      wrap.style.display = "flex";
      wrap.style.alignItems = "center";
      wrap.style.gap = "4px";
      wrap.appendChild(select);
      wrap.appendChild(delBtn);
      actionsTd.appendChild(wrap);

      tr.appendChild(actionsTd);
      ordersBody.appendChild(tr);
    });
  }

  // Helper to build a <td> with data-label and a value span
  function cell(label, value) {
    const td = document.createElement("td");
    td.dataset.label = label;
    const span = document.createElement("span");
    span.className = "cell-value";
    span.textContent = value;      // safe
    td.appendChild(span);
    return td;
  }

  async function updateStatus(id, status, selectEl) {
    try {
      const res = await fetch("/api/admin/orders/" + id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: status }),
      });
      if (handleAuth(res)) return;
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Could not update status.", true);
        return;
      }
      // Recolour the select and refresh stats
      selectEl.className = "status-select " + status;
      showToast("Order updated to " + status + ".");
      loadStats();
    } catch (err) {
      console.error(err);
      showToast("Network error while updating order.", true);
    }
  }

  async function deleteOrder(id, customerName) {
    if (!confirm("Delete order for " + customerName + "? This cannot be undone.")) return;
    try {
      const res = await fetch("/api/admin/orders/" + id, { method: "DELETE" });
      if (handleAuth(res)) return;
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || "Could not delete order.", true);
        return;
      }
      showToast("Order deleted.");
      loadOrders();
      loadStats();
    } catch (err) {
      console.error(err);
      showToast("Network error while deleting order.", true);
    }
  }

  // ---------- Filters ----------
  filterBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      filterBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentStatus = btn.dataset.status;
      loadOrders();
    });
  });

  let searchTimer = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      currentSearch = searchInput.value.trim();
      loadOrders();
    }, 300);
  });

  // ---------- Sands ----------
  async function loadSands() {
    try {
      const res = await fetch("/api/admin/sands");
      if (handleAuth(res)) return;
      if (!res.ok) throw new Error("sands failed");
      const sands = await res.json();
      renderSands(sands);
    } catch (err) {
      console.error(err);
      sandsList.innerHTML = '<div class="empty-msg">Could not load sand prices.</div>';
    }
  }

  function renderSands(sands) {
    sandsList.innerHTML = "";

    sands.forEach((s) => {
      const row = document.createElement("div");
      row.className = "sand-row";

      // Top line: name
      const top = document.createElement("div");
      top.className = "top";
      const name = document.createElement("div");
      name.className = "name";
      name.textContent = s.name;        // safe
      top.appendChild(name);
      row.appendChild(top);

      // Fields
      const fields = document.createElement("div");
      fields.className = "fields";

      // Price
      const priceWrap = document.createElement("div");
      const priceLabel = document.createElement("label");
      priceLabel.textContent = "Price (RWF / truck)";
      const priceInput = document.createElement("input");
      priceInput.type = "number";
      priceInput.min = "0";
      priceInput.max = "10000000";
      priceInput.value = s.price;
      priceWrap.appendChild(priceLabel);
      priceWrap.appendChild(priceInput);

      // Description
      const descWrap = document.createElement("div");
      const descLabel = document.createElement("label");
      descLabel.textContent = "Description";
      const descInput = document.createElement("textarea");
      descInput.maxLength = 500;
      descInput.value = s.description || "";
      descWrap.appendChild(descLabel);
      descWrap.appendChild(descInput);

      fields.appendChild(priceWrap);
      fields.appendChild(descWrap);
      row.appendChild(fields);

      // Active + save
      const bottom = document.createElement("div");
      bottom.style.display = "flex";
      bottom.style.alignItems = "center";
      bottom.style.gap = "14px";
      bottom.style.flexWrap = "wrap";

      const activeRow = document.createElement("div");
      activeRow.className = "active-row";
      const activeCheck = document.createElement("input");
      activeCheck.type = "checkbox";
      activeCheck.checked = !!s.active;
      const activeLabel = document.createElement("span");
      activeLabel.textContent = "Visible on the website";
      activeRow.appendChild(activeCheck);
      activeRow.appendChild(activeLabel);

      const saveBtn = document.createElement("button");
      saveBtn.className = "save-btn";
      saveBtn.textContent = "Save";

      const saveMsg = document.createElement("span");
      saveMsg.className = "save-msg";

      saveBtn.addEventListener("click", async () => {
        saveMsg.textContent = "";
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving…";
        try {
          const res = await fetch("/api/admin/sands/" + s.id, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              price: priceInput.value,
              description: descInput.value,
              active: activeCheck.checked ? 1 : 0,
            }),
          });
          if (handleAuth(res)) return;
          const data = await res.json();
          if (!res.ok) {
            saveMsg.style.color = "var(--danger)";
            saveMsg.textContent = data.error || "Could not save.";
          } else {
            saveMsg.style.color = "var(--success)";
            saveMsg.textContent = "Saved ✓";
            showToast("Updated " + s.name + ".");
            setTimeout(() => (saveMsg.textContent = ""), 2500);
          }
        } catch (err) {
          console.error(err);
          saveMsg.style.color = "var(--danger)";
          saveMsg.textContent = "Network error.";
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = "Save";
        }
      });

      bottom.appendChild(activeRow);
      bottom.appendChild(saveBtn);
      bottom.appendChild(saveMsg);
      row.appendChild(bottom);

      sandsList.appendChild(row);
    });
  }

  // ---------- Logout ----------
  logoutBtn.addEventListener("click", async () => {
    try {
      await fetch("/api/admin/logout", { method: "POST" });
    } catch (e) { /* ignore */ }
    window.location.href = "/admin";
  });

  // ---------- Auto-refresh every 60 seconds ----------
  setInterval(() => {
    loadOrders();
    loadStats();
  }, 60 * 1000);

  // ---------- Initial load ----------
  loadStats();
  loadOrders();
  loadSands();
})();