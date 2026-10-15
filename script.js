(() => {
  const $ = (id) => document.getElementById(id);
  const pages = ["pagePhone", "pageMessage", "pageCode", "pageDone"];
  let currentRequest = null;
  let pollTimer = null;
  let busy = false;

  function showPage(id) {
    pages.forEach((page) => { $(page).hidden = page !== id; });
  }
  function status(message, kind = "") {
    $("globalStatus").textContent = message;
    $("globalStatus").className = `status ${kind}`.trim();
  }
  function stopPolling() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  }

  $("phone").addEventListener("input", () => {
    $("phone").value = $("phone").value.replace(/\D/g, "").slice(0, 9);
    if ($("phone").value.length === 9) {
      $("pinDemoWrap").hidden = false;
      $("pinDemo").focus();
    } else {
      $("pinDemoWrap").hidden = true;
      $("pinDemo").value = "";
      $("pinSpinner").hidden = true;
      $("toMessage").hidden = true;
    }
  });

  $("pinDemo").addEventListener("input", () => {
    $("pinDemo").value = $("pinDemo").value.replace(/\D/g, "").slice(0, 5);
    if ($("pinDemo").value.length === 5) {
      $("pinSpinner").hidden = false;
      $("toMessage").hidden = true;
      status("Simulating the demo step…");
      setTimeout(() => {
        $("pinSpinner").hidden = true;
        $("toMessage").hidden = false;
        status("Demo step complete. Continue when ready.", "ok");
        // Never send or retain the entered demo digits.
        $("pinDemo").value = "";
      }, 1000);
    }
  });

  $("toMessage").addEventListener("click", () => {
    showPage("pageMessage");
    status("Enter a non-sensitive message to send for demo review.");
  });

  $("sendMessage").addEventListener("click", async () => {
    if (busy) return;
    const message = $("demoMessage").value.trim();
    if (!message) {
      $("messageStatus").textContent = "Enter a demo message first.";
      $("messageStatus").className = "status err";
      return;
    }
    busy = true;
    $("sendMessage").disabled = true;
    $("messageSpinner").hidden = false;
    $("messageStatus").textContent = "Sending demo request to Telegram…";
    $("messageStatus").className = "status";
    try {
      const response = await fetch("/api/demo-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: $("phone").value,
          message
        })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not send request.");
      currentRequest = result.reference;
      $("messageStatus").textContent = `Reference ${currentRequest}: waiting for Telegram approval or decline.`;
      pollStatus();
    } catch (error) {
      busy = false;
      $("sendMessage").disabled = false;
      $("messageStatus").textContent = error.message;
      $("messageStatus").className = "status err";
    } finally {
      $("messageSpinner").hidden = true;
    }
  });

  async function pollStatus() {
    if (!currentRequest) return;
    try {
      const response = await fetch(`/api/demo-request/${encodeURIComponent(currentRequest)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to check status.");
      if (result.status === "pending") {
        pollTimer = setTimeout(pollStatus, 2000);
        return;
      }
      busy = false;
      $("sendMessage").disabled = false;
      if (result.status === "approved") {
        showPage("pageCode");
        status("Demo message approved. Continue to the simulated code stage.", "ok");
      } else {
        $("demoMessage").value = "";
        $("messageStatus").textContent = "Demo declined. Enter a new non-sensitive message and submit again.";
        $("messageStatus").className = "status err";
        status("The request was declined. You can enter a new message.");
      }
    } catch (error) {
      busy = false;
      $("sendMessage").disabled = false;
      $("messageStatus").textContent = error.message;
      $("messageStatus").className = "status err";
    }
  }

  $("submitCode").addEventListener("click", () => {
    const code = $("demoCode").value.replace(/\D/g, "").slice(0, 4);
    $("demoCode").value = "";
    if (code.length !== 4) {
      $("codeStatus").textContent = "Enter exactly four demo digits.";
      $("codeStatus").className = "status err";
      return;
    }
    $("codeSpinner").hidden = false;
    $("submitCode").disabled = true;
    setTimeout(() => {
      $("codeSpinner").hidden = true;
      $("submitCode").disabled = false;
      showPage("pageDone");
      status("Demo completed. The four demo digits were not transmitted.", "ok");
    }, 900);
  });

  $("restart").addEventListener("click", () => {
    stopPolling();
    currentRequest = null;
    busy = false;
    $("phone").value = "";
    $("pinDemo").value = "";
    $("demoMessage").value = "";
    $("demoCode").value = "";
    $("pinDemoWrap").hidden = true;
    $("pinSpinner").hidden = true;
    $("toMessage").hidden = true;
    $("sendMessage").disabled = false;
    $("submitCode").disabled = false;
    $("messageStatus").textContent = "Waiting for your demo message.";
    $("messageStatus").className = "status";
    $("codeStatus").textContent = "The code remains in this browser.";
    $("codeStatus").className = "status";
    showPage("pagePhone");
    status("Ready to begin the demonstration.");
  });
})();
