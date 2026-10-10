let pyodide = null;
let ready = false;
let currentRun = null;
const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js";

postMessage({type:"status",status:"Loading Pyodide 0.26.4"});
importScripts(PYODIDE_URL);

async function boot(){
  pyodide = await loadPyodide({indexURL:"https://cdn.jsdelivr.net/pyodide/v0.26.4/full/"});
  ready = true;
  postMessage({type:"ready",version:"Pyodide 0.26.4 / Python " + pyodide.runPython("import sys; sys.version.split()[0]")});
}
boot().catch(err => postMessage({type:"unavailable",error:String(err)}));

function runPython(code, inputs){
  const harness = `
import sys, io, builtins, traceback, ast, json
_code = ${JSON.stringify(code)}
_inputs = ${JSON.stringify(inputs)}
_in_i = 0
class _CappedIO(io.StringIO):
    def __init__(self, limit=20000):
        super().__init__()
        self.limit = limit
        self.truncated = False
    def write(self, s):
        current = len(self.getvalue())
        if current + len(s) > self.limit:
            super().write(s[:max(0, self.limit-current)])
            self.truncated = True
            raise RuntimeError("Output limit reached")
        return super().write(s)
_stdout = _CappedIO()
_stderr = _CappedIO()
_consumed = []
def _input(prompt=""):
    global _in_i
    print(prompt, end="")
    if _in_i >= len(_inputs):
        raise EOFError("No more queued input. Add another input and run again.")
    value = _inputs[_in_i]
    _in_i += 1
    _consumed.append({"index": _in_i, "value": value, "prompt": prompt})
    return value
old_stdout, old_stderr, old_input = sys.stdout, sys.stderr, builtins.input
sys.stdout, sys.stderr, builtins.input = _stdout, _stderr, _input
ns = {"__name__":"__main__"}
err = None
try:
    exec(compile(_code, "<learner>", "exec"), ns, ns)
except BaseException:
    err = traceback.format_exc(limit=6)
finally:
    sys.stdout, sys.stderr, builtins.input = old_stdout, old_stderr, old_input
if _stdout.truncated and err is None:
    err = "RuntimeError: Output limit reached"
_vars = {}
for _name in ("avatar", "rounds_text", "rounds", "tokens", "score", "round_number", "answer", "correct", "multiplier"):
    if _name in ns and type(ns[_name]).__name__ in ("str", "int", "bool"):
        _vars[_name] = {"value": ns[_name], "type": type(ns[_name]).__name__}
result = {"stdout": _stdout.getvalue(), "stderr": _stderr.getvalue(), "error": err, "inputs": _consumed, "vars": _vars}
json.dumps(result, ensure_ascii=False)
`;
  return JSON.parse(pyodide.runPython(harness));
}

function astCheck(code, spec){
  const script = `
import ast, json
code = ${JSON.stringify(code)}
spec = ${JSON.stringify(spec)}
try:
    tree = ast.parse(code)
    found = False
    for node in ast.walk(tree):
        if type(node).__name__ == spec.get("node"):
            if spec.get("callName"):
                if type(node).__name__ == "Call" and getattr(node, "func", None) and getattr(node.func, "id", None) == spec["callName"]:
                    found = True
            elif spec.get("func"):
                if getattr(node, "func", None) and getattr(node.func, "id", None) == spec["func"]:
                    found = True
            else:
                found = True
    _result = {"ok": found, "error": None}
except SyntaxError as e:
    _result = {"ok": False, "error": f"SyntaxError line {e.lineno}: {e.msg}"}
json.dumps(_result, ensure_ascii=False)
`;
  return JSON.parse(pyodide.runPython(script));
}

onmessage = async (event) => {
  const msg = event.data;
  if (!ready) return postMessage({type:"result",runId:msg.runId,error:"Runtime is not ready yet",stdout:"",stderr:""});
  currentRun = msg.runId;
  try {
    if (msg.type === "run") {
      const result = runPython(msg.code, msg.inputs || []);
      postMessage({type:"result",runId:msg.runId,...result});
    }
    if (msg.type === "ast") {
      const result = astCheck(msg.code, msg.spec || {});
      postMessage({type:"astResult",runId:msg.runId,...result});
    }
  } catch (err) {
    postMessage({type:msg.type === "ast" ? "astResult" : "result",runId:msg.runId,error:String(err),ok:false,stdout:"",stderr:""});
  }
};
