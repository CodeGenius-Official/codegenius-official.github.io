const $ = (selector) => document.querySelector(selector);

const starterCode = `avatar = input("Fictional avatar: ")
rounds_text = input("Rounds (1-5): ")
rounds = int(rounds_text)
tokens = rounds * 3
print(avatar, "needs", tokens, "tokens")
`;

const challengeCode = `avatar = input("Fictional avatar: ")
rounds_text = input("Rounds (1-5): ")
rounds = int(rounds_text)
tokens = rounds * 4
print(avatar, "needs", tokens, "tokens")
`;

const customerTests = [
  {
    name: "Nori one round",
    inputs: ["Nori", "1"],
    stdout: "Fictional avatar: Rounds (1-5): Nori needs 4 tokens\n",
  },
  {
    name: "Pip five rounds",
    inputs: ["Pip", "5"],
    stdout: "Fictional avatar: Rounds (1-5): Pip needs 20 tokens\n",
  },
  {
    name: "Zed counterexample",
    inputs: ["Zed", "2"],
    stdout: "Fictional avatar: Rounds (1-5): Zed needs 8 tokens\n",
  },
  {
    name: "cat is not a number",
    inputs: ["Nori", "cat"],
    errorType: "ValueError",
  },
];

let worker = null;
let runSeq = 0;
let activeRunId = 0;
let pendingRuns = new Map();
let startupTimer = 0;
let executionTimer = 0;
let reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let currentStep = 0;

function setText(node, value) {
  node.textContent = value;
}

function setStatus(value) {
  setText($("#runtimeStatus"), value);
  setText($("#runState"), value);
}

function parseQueueText(text) {
  if (!text.trim()) return [];
  return text.split(/\r?\n/).map((line) => (line === "<empty>" ? "" : line));
}

function transcriptFor(inputs) {
  if (!inputs.length) return "(no inputs supplied)";
  return inputs.map((value, index) => `${index + 1}. ${JSON.stringify(value)}`).join("\n");
}

function paintToy() {
  const avatar = $("#avatarInput").value || "Nori";
  const roundsText = $("#roundsInput").value;
  const price = $("#priceInput").value;
  setText($("#priceOut"), price);
  setText($("#avatarSlip"), `"${avatar}"\nstr`);
  setText($("#roundsSlip"), `"${roundsText}"\nstr`);
}

function renderMicroscope(step = currentStep) {
  currentStep = step;
  const codeLines = $("#codeEditor").value.split(/\r?\n/).filter((line) => line.length);
  const rows = codeLines.map((line, index) => {
    const row = document.createElement("div");
    row.className = `scope-line ${index === step ? "current" : ""}`;
    const num = document.createElement("b");
    num.textContent = String(index + 1);
    const src = document.createElement("span");
    src.textContent = line;
    row.append(num, src);
    return row;
  });
  $("#microscope").replaceChildren(...rows.slice(0, 7));
}

function pulse(selector, className = "move") {
  if (reduceMotion) return;
  const node = $(selector);
  node.classList.remove(className);
  requestAnimationFrame(() => {
    node.classList.add(className);
    window.setTimeout(() => node.classList.remove(className), 420);
  });
}

function feedSlips() {
  const avatar = $("#avatarInput").value || "Nori";
  const roundsText = $("#roundsInput").value;
  paintToy();
  pulse("#avatarSlip");
  pulse("#roundsSlip");
  setText($("#avatarSlot"), `avatar = "${avatar}" (str)`);
  setText($("#roundsSlot"), `rounds_text = "${roundsText}" (str)`);
  setText($("#joinResult"), `"${avatar}" waits beside "${roundsText}"`);
  setText($("#machineExplain"), "input() gives text first. Python has not converted the rounds yet.");
  setText($("#toyOutput"), "Authored toy: two input slips are stored as text.");
  renderMicroscope(0);
}

function showJoinToy() {
  setText($("#joinResult"), `"2" + "3" → "23"`);
  setText($("#tokenReel"), "23?");
  setText($("#machineExplain"), "This is the separate string toy: text joins like labels. It is not the assessed token counter.");
  setText($("#toyOutput"), "Concept demo only: text + text makes longer text.");
  renderMicroscope(1);
}

function convertAndDispense() {
  const avatar = $("#avatarInput").value || "Nori";
  const roundsText = $("#roundsInput").value;
  const price = Number($("#priceInput").value);
  const rounds = Number.parseInt(roundsText, 10);
  $("#converterGate").classList.add("flash");
  window.setTimeout(() => $("#converterGate").classList.remove("flash"), 350);
  if (!Number.isFinite(rounds) || String(rounds) !== roundsText.trim()) {
    setText($("#tokenReel"), "ERR");
    setText($("#machineExplain"), `int("${roundsText}") cannot become a clean integer in this toy.`);
    setText($("#toyOutput"), "Authored toy: conversion failed. Real Python will show ValueError.");
    renderMicroscope(2);
    return;
  }
  const tokens = rounds * price;
  setText($("#roundsSlot"), `rounds_text = "${roundsText}" (str) → rounds = ${rounds} (int)`);
  setText($("#tokenReel"), String(tokens));
  setText($("#machineExplain"), `${rounds} × ${price} = ${tokens}. Now the number can be used for math.`);
  setText($("#toyOutput"), `${avatar} needs ${tokens} tokens`);
  renderMicroscope(3);
}

function bootWorker() {
  terminateWorker();
  worker = new Worker("js/python-worker.js");
  startupTimer = window.setTimeout(() => {
    setStatus("Python unavailable");
    appendOutput("Runtime did not finish loading in time. Teaching content still works; retry by refreshing.");
  }, 30000);
  worker.onmessage = (event) => {
    const message = event.data || {};
    if (message.type === "ready") {
      window.clearTimeout(startupTimer);
      setStatus("Python ready");
      return;
    }
    if (message.type === "unavailable") {
      window.clearTimeout(startupTimer);
      setStatus("Python unavailable");
      appendOutput(message.error || "Python worker unavailable.");
      return;
    }
    if (message.type === "result") {
      handleRunResult(message);
    }
  };
  worker.onerror = (event) => {
    window.clearTimeout(startupTimer);
    setStatus("Python error");
    appendOutput(event.message || "Worker error");
  };
}

function terminateWorker() {
  if (worker) worker.terminate();
  worker = null;
  window.clearTimeout(startupTimer);
}

function appendOutput(text) {
  const box = $("#outputBox");
  box.textContent = box.textContent ? `${box.textContent}\n${text}` : text;
}

function setBusy(isBusy) {
  $("#runBtn").disabled = isBusy;
  $("#checkBtn").disabled = isBusy;
  $("#stopBtn").disabled = !isBusy;
}

function runPython(code, inputs, options = {}) {
  if (!worker) bootWorker();
  const runId = ++runSeq;
  activeRunId = runId;
  setBusy(true);
  setStatus("Running Python...");
  if (!options.silent) {
    $("#outputBox").textContent = "";
    setText($("#inputTranscript"), transcriptFor(inputs));
  }
  const promise = new Promise((resolve) => {
    pendingRuns.set(runId, { resolve, options });
  });
  worker.postMessage({
    type: "run",
    runId,
    code,
    inputs,
    trace: true,
    timeoutMs: 5000,
    outputLimit: 12000,
  });
  executionTimer = window.setTimeout(() => {
    stopRun("Stopped: this run took longer than 5 seconds. Your code is still saved.");
  }, options.timeoutMs || 6500);
  return promise;
}

function stopRun(message = "Stopped. Runtime restarted; your code stayed in the editor.") {
  const active = pendingRuns.get(activeRunId);
  pendingRuns.delete(activeRunId);
  window.clearTimeout(executionTimer);
  setBusy(false);
  setStatus("Stopped");
  if (active) active.resolve({ stopped: true, stderr: message, stdout: "", inputs: [] });
  appendOutput(message);
  terminateWorker();
  bootWorker();
}

function handleRunResult(message) {
  const pending = pendingRuns.get(message.runId);
  if (!pending) return;
  pendingRuns.delete(message.runId);
  if (message.runId !== activeRunId && !pending.options.checkRun) return;
  window.clearTimeout(executionTimer);
  message.ok = !message.error;
  message.errorType = message.error ? (message.error.match(/(?:^|\n)([A-Za-z_][A-Za-z0-9_]*Error):/) || [])[1] || "Error" : null;
  message.stderr = message.stderr || message.error || "";
  setBusy(false);
  setStatus(message.ok ? "Run complete" : "Python error");
  if (!pending.options.silent) {
    $("#outputBox").textContent = message.stdout || message.stderr || "";
    renderRealRunVisual(message);
  }
  pending.resolve(message);
}

function renderRealRunVisual(message) {
  const stdout = message.stdout || "";
  if (message.ok && stdout.includes(" needs ")) {
    const lines = stdout.trim().split(/\r?\n/);
    const finalLine = lines[lines.length - 1];
    setText($("#toyOutput"), `Real Python result: ${finalLine}`);
    const match = finalLine.match(/ needs (-?\d+) tokens$/);
    if (match) setText($("#tokenReel"), match[1]);
  }
  if (!message.ok) {
    setText($("#toyOutput"), `Real Python error: ${message.errorType || "Error"}`);
    if (message.errorType === "ValueError") setText($("#machineExplain"), "int() tried to convert text that is not a clean number.");
    if (message.errorType === "EOFError") setText($("#machineExplain"), "Python asked for another input, but the input queue was empty.");
    renderMicroscope(2);
  } else {
    renderMicroscope(4);
  }
}

function normalize(text) {
  return (text || "").replace(/\r\n/g, "\n");
}

async function checkCustomers() {
  const cards = $("#customerCards");
  cards.innerHTML = "";
  const code = $("#codeEditor").value;
  setText($("#inputTranscript"), "Customer tests run each queue in a fresh Python namespace.");
  let passed = 0;
  for (const test of customerTests) {
    const card = document.createElement("div");
    card.className = "customer";
    card.textContent = `${test.name}: running...`;
    cards.appendChild(card);
    const result = await runPython(code, test.inputs, { silent: true, checkRun: true, timeoutMs: 6500 });
    let ok = false;
    let detail = "";
    if (result.stopped) {
      detail = "stopped or timed out";
    } else if (test.errorType) {
      ok = !result.ok && result.errorType === test.errorType;
      detail = ok ? `got ${test.errorType}` : `expected ${test.errorType}, got ${result.errorType || "success"}`;
    } else {
      ok = result.ok && normalize(result.stdout) === test.stdout;
      detail = ok ? "exact output matched" : `expected ${JSON.stringify(test.stdout)}, got ${JSON.stringify(normalize(result.stdout))}`;
    }
    card.className = `customer ${ok ? "pass" : "fail"}`;
    card.textContent = `${test.name}: ${ok ? "PASS" : "TRY AGAIN"} · ${detail}`;
    if (ok) passed += 1;
  }
  setStatus(`Customer tests ${passed}/${customerTests.length}`);
  setBusy(false);
}

function downloadReceipt() {
  const text = [
    "Token Works Receipt",
    `Toy output: ${$("#toyOutput").textContent}`,
    "",
    "Displayed Python code:",
    $("#codeEditor").value,
    "",
    "Inputs:",
    $("#inputQueue").value,
  ].join("\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "lesson03-token-receipt.txt";
  link.click();
  URL.revokeObjectURL(url);
}

function bind() {
  $("#avatarInput").addEventListener("input", paintToy);
  $("#roundsInput").addEventListener("input", paintToy);
  $("#priceInput").addEventListener("input", paintToy);
  $("#feedBtn").addEventListener("click", feedSlips);
  $("#joinBtn").addEventListener("click", showJoinToy);
  $("#convertBtn").addEventListener("click", convertAndDispense);
  $("#starterBtn").addEventListener("click", () => {
    $("#codeEditor").value = starterCode;
    $("#inputQueue").value = "Nori\n4";
  });
  $("#challengeBtn").addEventListener("click", () => {
    $("#codeEditor").value = challengeCode;
    $("#inputQueue").value = "Nori\n1";
  });
  $("#runBtn").addEventListener("click", () => runPython($("#codeEditor").value, parseQueueText($("#inputQueue").value)));
  $("#stopBtn").addEventListener("click", () => stopRun());
  $("#checkBtn").addEventListener("click", checkCustomers);
  $("#receiptBtn").addEventListener("click", downloadReceipt);
  $("#codeEditor").addEventListener("input", () => {
    renderMicroscope(0);
    setStatus("Code changed: tests stale");
  });
  $("#motionBtn").addEventListener("click", () => {
    reduceMotion = !reduceMotion;
    document.body.classList.toggle("reduce-motion", reduceMotion);
    $("#motionBtn").setAttribute("aria-pressed", String(reduceMotion));
  });
  $("#langBtn").addEventListener("click", () => {
    document.documentElement.lang = document.documentElement.lang === "th" ? "en" : "th";
    document.querySelectorAll("[data-th][data-en]").forEach((node) => {
      node.textContent = node.dataset[document.documentElement.lang];
    });
  });
}

bind();
$("#codeEditor").value = starterCode;
paintToy();
feedSlips();
renderMicroscope(0);
bootWorker();
