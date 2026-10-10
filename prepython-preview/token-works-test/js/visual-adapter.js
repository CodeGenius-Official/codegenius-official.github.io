(function () {
  const $ = (selector) => document.querySelector(selector);
  let ownerKey = "initial";

  function setText(selector, value) {
    const node = $(selector);
    if (node) node.textContent = value;
  }

  function setPaper(selector, value) {
    const node = $(selector);
    const text = node && node.querySelector(".paper-value");
    if (text) text.textContent = JSON.stringify(value ?? "");
  }

  function pulse(selector, className) {
    if (document.body.classList.contains("reduce-motion")) return;
    const node = $(selector);
    if (!node) return;
    node.classList.remove(className);
    requestAnimationFrame(() => {
      node.classList.add(className);
      window.setTimeout(() => node.classList.remove(className), 650);
    });
  }

  function clearFor(event) {
    const nextOwner = `${event.owner || "authored-demo"}:${event.sourceHash || "no-source"}:${event.runId || "no-run"}`;
    if (nextOwner === ownerKey) return;
    ownerKey = nextOwner;
    setText("#tokenReel", "0");
    setText("#receiptLine1", "waiting...");
    setText("#receiptLine2", event.owner === "actual-run" ? "real Python" : "authored model");
    setText("#receiptLine3", event.activityId || "lesson03");
    document.querySelector(".customer")?.classList.remove("happy", "error");
  }

  function render(event) {
    if (!event || !event.phase) return;
    clearFor(event);
    const values = event.values || {};
    const types = event.types || {};
    if ("avatar" in values) setPaper("#avatarSlip", values.avatar);
    if ("rounds_text" in values) setPaper("#roundsSlip", values.rounds_text);
    if ("price" in values) setText("#mathLabel", `rounds x ${values.price}`);
    if ("tokens" in values && values.tokens !== null && values.tokens !== undefined) {
      setText("#tokenReel", String(values.tokens));
      pulse("#tokenPile", "counting");
    }
    if (event.phase === "input") {
      setText("#avatarSlot", values.avatar ? `${values.avatar} · ${types.avatar || "str"}` : "waiting");
      setText("#roundsSlot", values.rounds_text !== undefined ? `rounds_text=${JSON.stringify(values.rounds_text)} · ${types.rounds_text || "str"}` : "rounds_text: waiting");
      setText("#roundsIntSlot", "rounds: not created");
      pulse("#avatarSlip", "move");
      pulse("#roundsSlip", "move");
    }
    if (event.phase === "convert") {
      setText("#roundsSlot", values.rounds_text !== undefined ? `rounds_text=${JSON.stringify(values.rounds_text)} · ${types.rounds_text || "str"}` : "rounds_text: unavailable");
      setText("#roundsIntSlot", values.rounds === undefined ? "rounds: not created" : `rounds=${JSON.stringify(values.rounds)} · ${types.rounds || "int"}`);
      pulse("#converterGate", "flash");
    }
    if (event.phase === "output" || event.phase === "result") {
      const line = event.output || "";
      if (values.rounds_text !== undefined) setText("#roundsSlot", `rounds_text=${JSON.stringify(values.rounds_text)} · ${types.rounds_text || "str"}`);
      if (values.rounds !== undefined) setText("#roundsIntSlot", `rounds=${JSON.stringify(values.rounds)} · ${types.rounds || "int"}`);
      setText("#receiptLine1", line.slice(0, 22) || "printed output");
      setText("#receiptLine2", line.slice(22, 44) || `run ${event.runId || ""}`.trim());
      setText("#receiptLine3", event.owner === "actual-run" ? "real Python output" : "authored demo only");
      const customer = document.querySelector(".customer");
      customer?.classList.toggle("happy", event.status !== "error");
      customer?.classList.toggle("error", event.status === "error");
    }
    if (event.phase === "error") {
      setText("#tokenReel", "ERR");
      if (values.rounds_text !== undefined) setText("#roundsSlot", `rounds_text=${JSON.stringify(values.rounds_text)} · ${types.rounds_text || "str"}`);
      if (values.rounds === undefined) setText("#roundsIntSlot", "rounds: not created");
      setText("#receiptLine1", event.status || "Python error");
      setText("#receiptLine2", event.output || "see stdout");
      setText("#receiptLine3", `run ${event.runId || ""}`.trim());
      document.querySelector(".customer")?.classList.add("error");
    }
  }

  window.TokenWorksScene = { render };
}());
