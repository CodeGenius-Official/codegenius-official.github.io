const $ = (selector) => document.querySelector(selector);

const LESSON_ID = "lesson03";
const STORAGE_KEY = "prepython-token-works-followon-v1";

const registry = {
  worked: {
    activityId: "worked",
    suiteId: "worked-price3",
    label: "Worked · price 3",
    price: 3,
    starter: codeForPrice(3),
    inputs: "Nori\n4",
    cases: [
      { name: "worked Nori 4", inputs: ["Nori", "4"], stdout: "Fictional avatar: Rounds (1-5): Nori needs 12 tokens\n" },
      { name: "worked Pip 0", inputs: ["Pip", "0"], stdout: "Fictional avatar: Rounds (1-5): Pip needs 0 tokens\n" },
    ],
  },
  guided: {
    activityId: "guided",
    suiteId: "guided-price2",
    label: "Guided · price 2",
    price: 2,
    starter: codeForPrice(2).replace("rounds = int(rounds_text)", "# TODO: convert rounds_text with int()\nrounds = 0"),
    inputs: "Nori\n3",
    cases: [
      { name: "guided Nori 3", inputs: ["Nori", "3"], stdout: "Fictional avatar: Rounds (1-5): Nori needs 6 tokens\n" },
      { name: "guided Pip 5", inputs: ["Pip", "5"], stdout: "Fictional avatar: Rounds (1-5): Pip needs 10 tokens\n" },
      { name: "guided empty text", inputs: ["Pip", ""], errorType: "ValueError" },
    ],
  },
  independent: {
    activityId: "independent",
    suiteId: "challenge",
    label: "Independent · price 4",
    price: 4,
    starter: codeForPrice(4).replace("tokens = rounds * 4", "tokens = rounds * 0  # TODO: change this rule"),
    inputs: "Nori\n2",
    cases: [
      { name: "Nori two rounds", inputs: ["Nori", "2"], stdout: "Fictional avatar: Rounds (1-5): Nori needs 8 tokens\n" },
      { name: "Pip five rounds", inputs: ["Pip", "5"], stdout: "Fictional avatar: Rounds (1-5): Pip needs 20 tokens\n" },
      { name: "Zero rounds", inputs: ["Zero", "0"], stdout: "Fictional avatar: Rounds (1-5): Zero needs 0 tokens\n" },
      { name: "Fresh case", inputs: ["Mai", "3"], stdout: "Fictional avatar: Rounds (1-5): Mai needs 12 tokens\n" },
      { name: "cat is not a number", inputs: ["Nori", "cat"], errorType: "ValueError" },
    ],
  },
};

const challengeCode = codeForPrice(4);

function codeForPrice(price) {
  return `avatar = input("Fictional avatar: ")
rounds_text = input("Rounds (1-5): ")
rounds = int(rounds_text)
tokens = rounds * ${price}
print(avatar, "needs", tokens, "tokens")
`;
}

let worker = null;
let runSeq = 0;
let activeRunId = 0;
let pendingRuns = new Map();
let startupTimer = 0;
let executionTimer = 0;
let reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let currentStep = 0;
let tracePaused = false;
let checkBatchSeq = 0;
let activeCheckBatch = null;
let dispatchGeneration = 0;
let activityDrafts = {};
let activeDraftId = "worked";
let hydrating = true;
let sceneOwnership = {
  owner: "prepared_model",
  label: "Prepared model",
  stale: false,
  activityId: "worked",
  source: "authored",
};
let evidence = {
  lessonId: LESSON_ID,
  activityId: "worked",
  suiteId: "worked-price3",
  behavior: "not_run",
  explanation: "pending_teacher",
  stale: false,
  supportUsed: [],
  lastRun: null,
  tests: [],
};

function simpleHash(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function snapshot() {
  return {
    lessonId: LESSON_ID,
    activityId: activity().activityId,
    suiteId: activity().suiteId,
    code: $("#codeEditor").value,
    codeHash: simpleHash($("#codeEditor").value),
    queue: $("#inputQueue").value,
    inputs: parseQueueText($("#inputQueue").value),
  };
}

function setText(node, value) {
  node.textContent = value;
}

function setPaperValue(selector, value) {
  const node = $(selector);
  const paperValue = node && node.querySelector && node.querySelector(".paper-value");
  if (paperValue) {
    paperValue.textContent = JSON.stringify(value ?? "");
    return;
  }
  setText(node, `${JSON.stringify(value ?? "")}\nstr`);
}

function activity() {
  return registry[$("#activitySelect").value] || registry.worked;
}

function activityById(id) {
  return registry[id] || registry.worked;
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

function markStale(reason) {
  evidence.stale = true;
  evidence.behavior = evidence.behavior === "pass" ? "stale" : evidence.behavior;
  evidence.lastReason = reason;
  setStatus("stale: code or inputs changed");
  setSceneOwnership({ owner: "stale_result", label: "Stale result", stale: true, source: sceneOwnership.source });
  renderEvidence();
  saveState();
}

function renderEvidence() {
  setText(
    $("#evidenceState"),
    `Evidence: ${evidence.behavior}${evidence.stale ? " (stale)" : ""} · lesson03/${evidence.activityId} · suite ${evidence.suiteId} · explanation ${evidence.explanation}`
  );
}

function setSaveStatus(extra = "") {
  const prefix = extra ? `${extra} · ` : "";
  setText($("#storageStatus"), `${prefix}Draft saves locally on this device. Export before clearing browser data.`);
}

function setSceneOwnership(next) {
  sceneOwnership = { ...sceneOwnership, ...next, activityId: activity().activityId };
  setText($("#sceneOwnerBadge"), sceneOwnership.label);
  setText(
    $("#sceneOwnerText"),
    sceneOwnership.stale
      ? "Stale scene: source, inputs, or activity changed after this display."
      : sceneOwnership.source === "real_python"
        ? "Scene is using verified Real Python output."
        : "Scene is a prepared authored teaching model, not assessment evidence."
  );
  globalThis.tokenWorksSceneOwnership = { ...sceneOwnership };
}

function emitScene(event) {
  if (!globalThis.TokenWorksScene || typeof globalThis.TokenWorksScene.render !== "function") return;
  const spec = activity();
  globalThis.TokenWorksScene.render({
    owner: event.owner || (sceneOwnership.source === "real_python" ? "actual-run" : "authored-demo"),
    phase: event.phase,
    activityId: spec.activityId,
    sourceHash: event.sourceHash || simpleHash($("#codeEditor").value || ""),
    runId: event.runId || activeRunId || null,
    values: event.values || {},
    types: event.types || {},
    output: event.output || "",
    status: event.status || sceneOwnership.owner,
  });
}

function currentDraft() {
  const spec = activityById(activeDraftId);
  return {
    lessonId: LESSON_ID,
    activityId: spec.activityId,
    suiteId: spec.suiteId,
    code: $("#codeEditor").value,
    queue: $("#inputQueue").value,
    avatar: $("#avatarInput").value,
    rounds: $("#roundsInput").value,
    evidence: { ...evidence },
  };
}

function rememberCurrentDraft() {
  if (hydrating) return;
  const spec = activityById(activeDraftId);
  activityDrafts[spec.activityId] = currentDraft();
}

function downloadText(filename, text, type = "text/plain;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function paintToy() {
  const avatar = $("#avatarInput").value || "Nori";
  const roundsText = $("#roundsInput").value;
  const spec = activity();
  $("#priceInput").value = String(spec.price);
  setText($("#priceOut"), spec.price);
  setPaperValue("#avatarSlip", avatar);
  setPaperValue("#roundsSlip", roundsText);
}

function renderMicroscope(step = currentStep) {
  currentStep = step;
  const codeLines = $("#codeEditor").value.split(/\r?\n/);
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
  $("#microscope").replaceChildren(...rows);
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
  setText($("#roundsSlot"), `rounds_text = "${roundsText}" (str); rounds is not created yet`);
  setText($("#joinResult"), `"${avatar}" and "${roundsText}" are separate input slips`);
  setText($("#machineExplain"), "input() gives text first. Digits still arrive as str.");
  setText($("#toyOutput"), "Authored model: the booth has text slips, not numbers yet.");
  setSceneOwnership({ owner: "prepared_model", label: "Prepared model", stale: false, source: "authored" });
  emitScene({
    owner: "authored-demo",
    phase: "input",
    values: { avatar, rounds_text: roundsText, price: activity().price },
    types: { avatar: "str", rounds_text: "str" },
    status: "prepared_model",
  });
  renderMicroscope(0);
}

function showJoinToy() {
  evidence.supportUsed = [...new Set([...evidence.supportUsed, "string-join-model"])];
  setText($("#joinResult"), `"2" + "3" -> "23"`);
  setText($("#tokenReel"), "23?");
  setText($("#machineExplain"), "Guided model only: text can join into longer text. It is not the assessed token task.");
  setText($("#toyOutput"), "Concept model only. Mastery still needs real Python on the selected activity.");
  setSceneOwnership({ owner: "prepared_model", label: "Guided model", stale: false, source: "authored" });
  renderMicroscope(1);
  saveState();
}

function convertAndDispense() {
  const avatar = $("#avatarInput").value || "Nori";
  const roundsText = $("#roundsInput").value;
  const price = activity().price;
  const trimmed = roundsText.trim();
  const canInt = /^[-+]?\d+$/.test(trimmed);
  const rounds = Number.parseInt(trimmed, 10);
  $("#converterGate").classList.add("flash");
  window.setTimeout(() => $("#converterGate").classList.remove("flash"), 350);
  if (!canInt) {
    setText($("#tokenReel"), "ERR");
    setText($("#roundsSlot"), `rounds_text = "${roundsText}" (str); rounds not created`);
    setText($("#machineExplain"), `Authored model matched to Python int(): "${roundsText}" fails. Try 0, 03, +3, or " 4 "; not three, empty, or 3.5.`);
    setText($("#toyOutput"), "Conversion stopped at the chamber. Real Python will report ValueError.");
    setSceneOwnership({ owner: "prepared_model", label: "Prepared model", stale: false, source: "authored" });
    emitScene({
      owner: "authored-demo",
      phase: "error",
      values: { avatar, rounds_text: roundsText, price },
      types: { avatar: "str", rounds_text: "str" },
      output: "ValueError",
      status: "prepared conversion failed",
    });
    renderMicroscope(2);
    return;
  }
  const tokens = rounds * price;
  setText($("#roundsSlot"), `rounds_text = "${roundsText}" (str) remains exactly; rounds = ${rounds} (int) is new`);
  setText($("#tokenReel"), String(tokens));
  setText($("#machineExplain"), `${rounds} x ${price} = ${tokens}. The original text slip is still visible.`);
  setText($("#toyOutput"), `${avatar} needs ${tokens} tokens (${activity().label})`);
  setSceneOwnership({ owner: "prepared_model", label: "Prepared model", stale: false, source: "authored" });
  emitScene({
    owner: "authored-demo",
    phase: "convert",
    values: { avatar, rounds_text: roundsText, rounds, price, tokens },
    types: { avatar: "str", rounds_text: "str", rounds: "int", tokens: "int" },
    output: `${avatar} needs ${tokens} tokens`,
    status: "prepared_model",
  });
  renderMicroscope(3);
}

function stepTrace() {
  if (tracePaused) {
    setText($("#machineExplain"), "Trace paused. Press Pause trace again to continue.");
    return;
  }
  const spec = activity();
  const codeMatchesReference = $("#codeEditor").value.trim() === codeForPrice(spec.price).trim();
  if (!codeMatchesReference) {
    setText($("#machineExplain"), `Authored trace is bound to the exact completed ${spec.label} reference source. This starter or edit must use Run Python.`);
    setText($("#toyOutput"), "No canned trace for this source.");
    setText($("#roundsSlot"), "Trace hidden: current source is not the completed reference.");
    setSceneOwnership({ owner: "stale_result", label: "No prepared trace", stale: true, source: "authored" });
    return;
  }
  const avatar = $("#avatarInput").value || "Nori";
  const roundsText = $("#roundsInput").value;
  const trimmed = roundsText.trim();
  const canInt = /^[-+]?\d+$/.test(trimmed);
  const rounds = Number.parseInt(trimmed, 10);
  const tokens = canInt ? rounds * spec.price : null;
  const snapshots = [
    {
      line: 0,
      avatarSlot: "before line 1: avatar not created",
      roundsSlot: "rounds_text not created; rounds not created",
      reel: "0",
      output: "Authored trace: about to ask for avatar input.",
      explain: "About to execute line 1. No memory value changes before the line runs.",
    },
    {
      line: 1,
      avatarSlot: `avatar = "${avatar}" (str)`,
      roundsSlot: "before line 2: rounds_text not created; rounds not created",
      reel: "0",
      output: "Authored trace: avatar text is stored; stdout still has no final message.",
      explain: "After line 1, the avatar slip is text. Line 2 is next.",
    },
    {
      line: 2,
      avatarSlot: `avatar = "${avatar}" (str)`,
      roundsSlot: `rounds_text = "${roundsText}" (str); rounds not created yet`,
      reel: "0",
      output: "Authored trace: digits from input are still text.",
      explain: "After line 2, rounds_text exists as str. The integer value does not exist yet.",
    },
    {
      line: 3,
      avatarSlot: `avatar = "${avatar}" (str)`,
      roundsSlot: canInt ? `rounds_text = "${roundsText}" (str); rounds = ${rounds} (int)` : `rounds_text = "${roundsText}" (str); int() stops with ValueError`,
      reel: canInt ? "0" : "ERR",
      output: canInt ? "Authored trace: conversion created a new int value." : "Authored trace: conversion failed; multiplication and print do not run.",
      explain: canInt ? "After line 3, rounds_text remains str and rounds is a separate int." : "ValueError stops the program at int().",
    },
    {
      line: 4,
      avatarSlot: `avatar = "${avatar}" (str)`,
      roundsSlot: canInt ? `rounds = ${rounds} (int); tokens = ${tokens} (int)` : `rounds was not created`,
      reel: canInt ? String(tokens) : "ERR",
      output: canInt ? "Authored trace: multiplication creates tokens; stdout still waits for print." : "Authored trace: stopped before multiplication.",
      explain: canInt ? `Line 4 uses ${rounds} x ${spec.price}.` : "No token calculation happens after failed conversion.",
    },
    {
      line: 5,
      avatarSlot: `avatar = "${avatar}" (str)`,
      roundsSlot: canInt ? `tokens = ${tokens} (int)` : `no printed result`,
      reel: canInt ? String(tokens) : "ERR",
      output: canInt ? `${avatar} needs ${tokens} tokens` : "Authored trace: no printed receipt because conversion failed.",
      explain: "stdout changes at print, not before.",
    },
  ];
  currentStep = (currentStep + 1) % snapshots.length;
  const snap = snapshots[currentStep];
  setText($("#avatarSlot"), snap.avatarSlot);
  setText($("#roundsSlot"), snap.roundsSlot);
  setText($("#tokenReel"), snap.reel);
  setText($("#toyOutput"), snap.output);
  setText($("#machineExplain"), `${snap.explain} Prepared trace for ${LESSON_ID}/${spec.activityId}; real edited code must be run.`);
  setSceneOwnership({ owner: "prepared_model", label: "Prepared trace", stale: false, source: "authored" });
  emitScene({
    owner: "authored-demo",
    phase: currentStep < 3 ? "input" : currentStep < 5 ? "convert" : "output",
    values: {
      avatar,
      rounds_text: roundsText,
      rounds: currentStep >= 3 && canInt ? rounds : undefined,
      price: spec.price,
      tokens: currentStep >= 4 && canInt ? tokens : undefined,
    },
    types: { avatar: "str", rounds_text: "str", rounds: "int", tokens: "int" },
    output: currentStep >= 5 && canInt ? `${avatar} needs ${tokens} tokens` : snap.output,
    status: "prepared_trace",
  });
  renderMicroscope(snap.line);
}

function resetDemo() {
  currentStep = 0;
  tracePaused = false;
  setText($("#pauseTraceBtn"), "Pause trace");
  setText($("#tokenReel"), "0");
  setText($("#joinResult"), '"2" + "3" -> ?');
  feedSlips();
  setText($("#toyOutput"), "Demo reset. Your Python source and evidence were not erased.");
}

function bootWorker() {
  terminateWorker();
  worker = new Worker("js/python-worker.js");
  startupTimer = window.setTimeout(() => {
    setStatus("Python unavailable");
    appendOutput("Runtime did not finish loading in time. Work is preserved; retry by refreshing.");
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
    if (message.type === "result") handleRunResult(message);
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
  saveState();
  if (!worker) bootWorker();
  const runId = ++runSeq;
  const generation = dispatchGeneration;
  activeRunId = runId;
  setBusy(true);
  setStatus("Running Python...");
  if (!options.silent) {
    $("#outputBox").textContent = "";
    setText($("#inputTranscript"), transcriptFor(inputs));
  }
  const runSnapshot = options.snapshot || snapshot();
  const promise = new Promise((resolve) => pendingRuns.set(runId, { resolve, options, runSnapshot, generation }));
  worker.postMessage({ type: "run", runId, code, inputs, trace: true, timeoutMs: 5000, outputLimit: 12000 });
  executionTimer = window.setTimeout(() => stopRun("Stopped: this run took longer than 5 seconds. Your code is still saved."), options.timeoutMs || 6500);
  return promise;
}

function stopRun(message = "Stopped. Runtime restarted; your code stayed in the editor.") {
  dispatchGeneration += 1;
  if (activeCheckBatch) activeCheckBatch.cancelled = true;
  const active = pendingRuns.get(activeRunId);
  pendingRuns.delete(activeRunId);
  window.clearTimeout(executionTimer);
  setBusy(false);
  setStatus("Stopped");
  if (active) active.resolve({ stopped: true, error: message, stdout: "", inputs: [] });
  appendOutput(message);
  terminateWorker();
  bootWorker();
}

function normalizeMessage(message) {
  message.ok = !message.error;
  message.errorType = message.error ? (message.error.match(/(?:^|\n)([A-Za-z_][A-Za-z0-9_]*Error):/) || [])[1] || "Error" : null;
  message.stderr = message.stderr || message.error || "";
  return message;
}

function handleRunResult(message) {
  const pending = pendingRuns.get(message.runId);
  if (!pending) return;
  pendingRuns.delete(message.runId);
  if (message.runId !== activeRunId && !pending.options.checkRun) return;
  window.clearTimeout(executionTimer);
  message = normalizeMessage(message);
  const current = snapshot();
  const resultIsCurrent = current.codeHash === pending.runSnapshot.codeHash && current.queue === pending.runSnapshot.queue && current.activityId === pending.runSnapshot.activityId && pending.generation === dispatchGeneration;
  setBusy(false);
  setStatus(resultIsCurrent ? (message.ok ? "Run complete" : "Python error") : "stale: older run finished after code/input changed");
  if (!pending.options.silent) {
    $("#outputBox").textContent = [message.stdout, message.stderr].filter(Boolean).join("\n");
    evidence.lastRun = {
      activityId: pending.runSnapshot.activityId,
      suiteId: pending.runSnapshot.suiteId,
      inputs: pending.runSnapshot.inputs,
      ok: message.ok,
      stdout: message.stdout || "",
      errorType: message.errorType,
      stderr: message.stderr || "",
      code: pending.runSnapshot.code,
      codeHash: pending.runSnapshot.codeHash,
      isCurrent: resultIsCurrent,
    };
    evidence.stale = !resultIsCurrent;
    evidence.behavior = "run_completed";
    if (resultIsCurrent) {
      renderRealRunVisual(message);
      setStatus(message.ok ? "Run complete" : "Python error");
    } else {
      setStatus("stale: older run finished after code/input changed");
      setSceneOwnership({ owner: "stale_result", label: "Stale result", stale: true, source: "real_python" });
    }
    renderEvidence();
    saveState();
  }
  pending.resolve({ ...message, stale: !resultIsCurrent });
}

function renderRealRunVisual(message) {
  const stdout = message.stdout || "";
  const actualValues = {};
  const actualTypes = {};
  if (message.vars) {
    for (const [name, record] of Object.entries(message.vars)) {
      actualValues[name] = record.value;
      actualTypes[name] = record.type;
    }
    const avatarValue = actualValues.avatar;
    const roundsTextValue = actualValues.rounds_text;
    const roundsValue = actualValues.rounds;
    const tokensValue = actualValues.tokens;
    if (avatarValue !== undefined) {
      setText($("#avatarSlot"), `avatar = ${JSON.stringify(avatarValue)} (${actualTypes.avatar})`);
    } else {
      setText($("#avatarSlot"), "avatar not created in this run");
    }
    if (roundsTextValue !== undefined || roundsValue !== undefined || tokensValue !== undefined) {
      const parts = [];
      if (roundsTextValue !== undefined) parts.push(`rounds_text = ${JSON.stringify(roundsTextValue)} (${actualTypes.rounds_text})`);
      if (roundsValue !== undefined) parts.push(`rounds = ${JSON.stringify(roundsValue)} (${actualTypes.rounds})`);
      if (tokensValue !== undefined) parts.push(`tokens = ${JSON.stringify(tokensValue)} (${actualTypes.tokens})`);
      setText($("#roundsSlot"), parts.join("; "));
    } else {
      setText($("#roundsSlot"), "rounds_text / rounds / tokens not created in this run");
    }
  } else {
    setText($("#avatarSlot"), "no runtime variables reported");
    setText($("#roundsSlot"), "no runtime variables reported");
  }
  if (message.ok && stdout.includes(" needs ")) {
    const finalLine = stdout.trim().split(/\r?\n/).at(-1);
    setText($("#toyOutput"), `Real Python result: ${finalLine}`);
    const match = finalLine.match(/ needs (-?\d+) tokens$/);
    if (match) setText($("#tokenReel"), match[1]);
    setSceneOwnership({ owner: "real_python", label: "Real Python result", stale: false, source: "real_python" });
    emitScene({
      owner: "actual-run",
      phase: "result",
      values: { ...actualValues, price: activity().price },
      types: actualTypes,
      output: finalLine,
      status: "completed",
    });
    renderMicroscope(4);
    return;
  }
  if (!message.ok) {
    setText($("#tokenReel"), "ERR");
    setText($("#toyOutput"), `Real Python error: ${message.errorType || "Error"}`);
    if (message.errorType === "ValueError") setText($("#machineExplain"), "int() tried to convert text that is not a whole number.");
    if (message.errorType === "EOFError") setText($("#machineExplain"), "Python asked for another input, but the queue was empty.");
    setSceneOwnership({ owner: "real_python", label: "Real Python error", stale: false, source: "real_python" });
    emitScene({
      owner: "actual-run",
      phase: "error",
      values: { ...actualValues, price: activity().price },
      types: actualTypes,
      output: message.errorType || "Python error",
      status: message.errorType || "error",
    });
    renderMicroscope(2);
  }
}

function normalize(text) {
  return (text || "").replace(/\r\n/g, "\n");
}

async function checkCustomers() {
  const spec = activity();
  const batchId = ++checkBatchSeq;
  activeCheckBatch = { id: batchId, cancelled: false, generation: dispatchGeneration };
  const cards = $("#customerCards");
  cards.innerHTML = "";
  const checkSnapshot = snapshot();
  evidence.tests = [];
  setText($("#inputTranscript"), `Running suite ${spec.suiteId}. Each queue has avatar, then rounds_text.`);
  let passed = 0;
  for (const test of spec.cases) {
    if (!activeCheckBatch || activeCheckBatch.id !== batchId || activeCheckBatch.cancelled || activeCheckBatch.generation !== dispatchGeneration) break;
    const card = document.createElement("div");
    card.className = "customer";
    card.textContent = `${test.name}: running...`;
    cards.appendChild(card);
    const result = normalizeMessage(await runPython(checkSnapshot.code, test.inputs, { silent: true, checkRun: true, timeoutMs: 6500, snapshot: { ...checkSnapshot, inputs: test.inputs, queue: test.inputs.join("\n") } }));
    if (!activeCheckBatch || activeCheckBatch.id !== batchId || activeCheckBatch.cancelled || activeCheckBatch.generation !== dispatchGeneration) break;
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
    evidence.tests.push({ activityId: spec.activityId, suiteId: spec.suiteId, name: test.name, ok, detail, inputs: test.inputs, stdout: result.stdout || "", stderr: result.stderr || "", errorType: result.errorType, codeHash: checkSnapshot.codeHash });
    if (ok) passed += 1;
  }
  const batchCancelled = !activeCheckBatch || activeCheckBatch.id !== batchId || activeCheckBatch.cancelled || activeCheckBatch.generation !== dispatchGeneration;
  evidence.activityId = spec.activityId;
  evidence.suiteId = spec.suiteId;
  evidence.code = checkSnapshot.code;
  evidence.codeHash = checkSnapshot.codeHash;
  evidence.inputs = checkSnapshot.inputs;
  evidence.behavior = batchCancelled ? "stopped" : (passed === spec.cases.length ? "pass" : "fail");
  evidence.stale = snapshot().codeHash !== checkSnapshot.codeHash || snapshot().activityId !== checkSnapshot.activityId;
  evidence.explanation = "pending_teacher";
  setStatus(batchCancelled ? `Stopped customer tests ${passed}/${spec.cases.length}` : (evidence.stale ? `stale: customer tests ${passed}/${spec.cases.length} belong to older source` : `Customer tests ${passed}/${spec.cases.length}`));
  setBusy(false);
  if (activeCheckBatch && activeCheckBatch.id === batchId) activeCheckBatch = null;
  renderEvidence();
  saveState();
}

function downloadReceipt() {
  const spec = activity();
  if (evidence.stale || evidence.behavior !== "pass") {
    const blocked = [
      "Token Works Receipt Blocked",
      "Run the selected activity customer tests again before exporting evidence.",
      `Current activity: ${spec.activityId}`,
      `Evidence behavior: ${evidence.behavior}${evidence.stale ? " stale" : ""}`,
    ].join("\n");
    downloadText(`lesson03-${spec.activityId}-receipt-blocked.txt`, blocked);
    appendOutput("Receipt blocked: run the selected activity tests again before exporting evidence.");
    setStatus("Receipt blocked: stale or incomplete evidence");
    return;
  }
  const evidenceCode = evidence.code || (evidence.lastRun && evidence.lastRun.code) || $("#codeEditor").value;
  const text = [
    "Token Works Receipt",
    `Lesson: ${LESSON_ID}`,
    `Activity: ${spec.activityId}`,
    `Suite: ${spec.suiteId}`,
    `Evidence behavior: ${evidence.behavior}${evidence.stale ? " stale" : ""}`,
    `Explanation: ${evidence.explanation}`,
    "",
    "Parent summary: Used an avatar name and one numeric input, converted rounds text into a whole number, calculated token cost and tested different orders.",
    "",
    "Evidence Python code:",
    evidenceCode,
    "",
    "Inputs:",
    $("#inputQueue").value,
    "",
    "Test evidence:",
    JSON.stringify(evidence.tests, null, 2),
  ].join("\n");
  downloadText(`lesson03-${spec.activityId}-token-receipt.txt`, text);
}

function exportPyDraft() {
  rememberCurrentDraft();
  const spec = activity();
  const header = [
    "# Pre-Python Mini Game Studio",
    `# Lesson: ${LESSON_ID}`,
    `# Activity: ${spec.activityId}`,
    `# Evidence: ${evidence.behavior}${evidence.stale ? " stale" : ""}; explanation ${evidence.explanation}`,
    "# This is a learner draft, not a certified receipt.",
    "",
  ].join("\n");
  downloadText(`lesson03-${spec.activityId}-draft.py`, header + $("#codeEditor").value, "text/x-python;charset=utf-8");
}

function exportJsonDraft() {
  rememberCurrentDraft();
  const payload = {
    kind: "prepython.lesson03.draft",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    activeActivityId: activity().activityId,
    drafts: activityDrafts,
    note: "Draft export only. Pending/stale evidence is not a certified receipt.",
  };
  downloadText(`lesson03-token-works-draft.json`, JSON.stringify(payload, null, 2), "application/json;charset=utf-8");
}

function selectActivity(id, resetCode = false) {
  rememberCurrentDraft();
  $("#activitySelect").value = id;
  activeDraftId = activityById(id).activityId;
  const spec = activityById(activeDraftId);
  evidence.activityId = spec.activityId;
  evidence.suiteId = spec.suiteId;
  const draft = !resetCode && activityDrafts[spec.activityId];
  $("#codeEditor").value = draft ? draft.code : spec.starter;
  $("#inputQueue").value = draft ? draft.queue : spec.inputs;
  if (draft) {
    $("#avatarInput").value = draft.avatar || $("#avatarInput").value;
    $("#roundsInput").value = draft.rounds || $("#roundsInput").value;
    evidence = { ...evidence, ...(draft.evidence || {}), activityId: spec.activityId, suiteId: spec.suiteId };
  } else {
    evidence.behavior = "not_run";
    evidence.stale = false;
    evidence.explanation = "pending_teacher";
  }
  paintToy();
  feedSlips();
  renderMicroscope(0);
  renderEvidence();
  saveState();
}

function saveState() {
  try {
    rememberCurrentDraft();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      activityId: activeDraftId,
      code: $("#codeEditor").value,
      queue: $("#inputQueue").value,
      avatar: $("#avatarInput").value,
      rounds: $("#roundsInput").value,
      evidence,
      activityDrafts,
    }));
    setSaveStatus("Saved");
  } catch {
    setStatus("Storage unavailable");
    setSaveStatus("Storage unavailable");
  }
}

function restoreState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    activeDraftId = registry[saved.activityId] ? saved.activityId : "worked";
    $("#activitySelect").value = activeDraftId;
    const spec = activityById(activeDraftId);
    $("#codeEditor").value = typeof saved.code === "string" ? saved.code : spec.starter;
    $("#inputQueue").value = typeof saved.queue === "string" ? saved.queue : spec.inputs;
    $("#avatarInput").value = typeof saved.avatar === "string" ? saved.avatar : "Nori";
    $("#roundsInput").value = typeof saved.rounds === "string" ? saved.rounds : "4";
    evidence = { ...evidence, ...(saved.evidence || {}) };
    activityDrafts = saved.activityDrafts && typeof saved.activityDrafts === "object" ? saved.activityDrafts : {};
    activityDrafts[activeDraftId] = currentDraft();
    paintToy();
    feedSlips();
    renderEvidence();
    return true;
  } catch {
    setStatus("Saved state ignored: unsupported format");
    return false;
  }
}

function bind() {
  $("#avatarInput").addEventListener("input", () => { paintToy(); markStale("avatar changed"); });
  $("#roundsInput").addEventListener("input", () => { paintToy(); markStale("rounds changed"); });
  $("#activitySelect").addEventListener("change", () => selectActivity($("#activitySelect").value));
  $("#feedBtn").addEventListener("click", feedSlips);
  $("#joinBtn").addEventListener("click", showJoinToy);
  $("#convertBtn").addEventListener("click", convertAndDispense);
  $("#stepBtn").addEventListener("click", stepTrace);
  $("#pauseTraceBtn").addEventListener("click", () => {
    tracePaused = !tracePaused;
    setText($("#pauseTraceBtn"), tracePaused ? "Play trace" : "Pause trace");
    setText($("#machineExplain"), tracePaused ? "Trace paused. Scene state is held." : "Trace ready. Press Step trace to continue.");
  });
  $("#resetDemoBtn").addEventListener("click", resetDemo);
  $("#starterBtn").addEventListener("click", () => selectActivity(activity().activityId, true));
  $("#challengeBtn").addEventListener("click", () => selectActivity("independent", true));
  $("#runBtn").addEventListener("click", () => runPython($("#codeEditor").value, parseQueueText($("#inputQueue").value)));
  $("#stopBtn").addEventListener("click", () => {
    if (activeCheckBatch) activeCheckBatch.cancelled = true;
    stopRun();
  });
  $("#checkBtn").addEventListener("click", checkCustomers);
  $("#receiptBtn").addEventListener("click", downloadReceipt);
  $("#exportPyBtn").addEventListener("click", exportPyDraft);
  $("#exportJsonBtn").addEventListener("click", exportJsonDraft);
  $("#codeEditor").addEventListener("input", () => { renderMicroscope(0); markStale("code changed"); });
  $("#inputQueue").addEventListener("input", () => markStale("run inputs changed"));
  $("#motionBtn").addEventListener("click", () => {
    reduceMotion = !reduceMotion;
    document.body.classList.toggle("reduce-motion", reduceMotion);
    $("#motionBtn").setAttribute("aria-pressed", String(reduceMotion));
  });
  $("#projectorBtn").addEventListener("click", () => {
    const on = !document.body.classList.contains("projector");
    document.body.classList.toggle("projector", on);
    $("#projectorBtn").setAttribute("aria-pressed", String(on));
  });
  $("#langBtn").addEventListener("click", () => {
    document.documentElement.lang = document.documentElement.lang === "th" ? "en" : "th";
    document.querySelectorAll("[data-th][data-en]").forEach((node) => {
      node.textContent = node.dataset[document.documentElement.lang];
    });
  });
}

bind();
if (!restoreState()) {
  selectActivity("worked", true);
  hydrating = false;
} else {
  hydrating = false;
}
renderMicroscope(0);
bootWorker();
