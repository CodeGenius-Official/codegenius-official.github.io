const SCRATCH_MODULE_URL = '../assets/vendor/scratch-blocks-2.1.32/main.mjs';
const SCRATCH_MEDIA_URL = '../assets/vendor/scratch-blocks-2.1.32/media/';
const BLOCKLY_SCRIPTS = [
  '../assets/vendor/blockly-13.3.0/blockly.min.js',
  '../assets/vendor/blockly-13.3.0/en.js',
];

let scratchBlocksPromise;
let blocklyPromise;

const SCRATCH_NATIVE_BLOCK_STYLES = {
  motion: { colourPrimary: '#4C97FF', colourSecondary: '#4280D7', colourTertiary: '#3373CC' },
  looks: { colourPrimary: '#9966FF', colourSecondary: '#855CD6', colourTertiary: '#774DCB' },
  sounds: { colourPrimary: '#CF63CF', colourSecondary: '#C94FC9', colourTertiary: '#BD42BD' },
  event: { colourPrimary: '#FFBF00', colourSecondary: '#E6AC00', colourTertiary: '#CC9900' },
  control: { colourPrimary: '#FFAB19', colourSecondary: '#EC9C13', colourTertiary: '#CF8B17' },
  sensing: { colourPrimary: '#5CB1D6', colourSecondary: '#47A8D1', colourTertiary: '#2E8EB8' },
  operators: { colourPrimary: '#59C059', colourSecondary: '#46B946', colourTertiary: '#389438' },
  data: { colourPrimary: '#FF8C1A', colourSecondary: '#FF8000', colourTertiary: '#DB6E00' },
  data_lists: { colourPrimary: '#FF661A', colourSecondary: '#FF5500', colourTertiary: '#E64D00' },
  pen: { colourPrimary: '#0FBD8C', colourSecondary: '#0DA57A', colourTertiary: '#0B8E69' },
  more: { colourPrimary: '#FF6680', colourSecondary: '#FF4D6A', colourTertiary: '#FF3355' },
  textField: { colourPrimary: '#FFFFFF', colourSecondary: '#FFFFFF', colourTertiary: '#FFFFFF' },
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-hkico-src="${src}"]`);
    if (existing) {
      existing.addEventListener('load', resolve, { once: true });
      existing.addEventListener('error', reject, { once: true });
      if (existing.dataset.loaded === 'true') resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = false;
    script.dataset.hkicoSrc = src;
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true';
      resolve();
    }, { once: true });
    script.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), { once: true });
    document.head.appendChild(script);
  });
}

async function getScratchBlocks() {
  if (!scratchBlocksPromise) scratchBlocksPromise = import(SCRATCH_MODULE_URL);
  return scratchBlocksPromise;
}

async function getBlockly() {
  if (!blocklyPromise) {
    blocklyPromise = (async () => {
      for (const src of BLOCKLY_SCRIPTS) await loadScript(src);
      if (!window.Blockly) throw new Error('Blockly global was not created.');
      return window.Blockly;
    })();
  }
  return blocklyPromise;
}

function textToElement(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function fallbackText(visual) {
  if (visual.textFallback) return visual.textFallback;
  if (typeof visual.serialization === 'string') return visual.serialization;
  return JSON.stringify(visual.serialization, null, 2);
}

function setStatus(target, status, message) {
  const frame = target.querySelector('.hkico-block-frame');
  frame.dataset.status = status;
  if (message) {
    frame.innerHTML = `<div class="feedback wrong">${escapeHtml(message)}</div>`;
  }
}

function clearActive(workspace) {
  const svg = workspace && workspace.getParentSvg && workspace.getParentSvg();
  if (!svg) return;
  svg.querySelectorAll('.hkico-block-active').forEach(node => node.classList.remove('hkico-block-active'));
}

function highlightBlocks(workspace, activeBlocks) {
  clearActive(workspace);
  if (!workspace || !Array.isArray(activeBlocks)) return [];
  const missing = [];
  activeBlocks.forEach(id => {
    const block = workspace.getBlockById && workspace.getBlockById(id);
    const root = block && block.getSvgRoot && block.getSvgRoot();
    if (root) root.classList.add('hkico-block-active');
    else missing.push(id);
  });
  return missing;
}

function resizeWorkspace(api, workspace) {
  if (!workspace) return;
  try {
    if (api.svgResize) api.svgResize(workspace);
    else if (api.svgResize && workspace) api.svgResize(workspace);
    else if (api.common && api.common.svgResize) api.common.svgResize(workspace);
  } catch {}
  try {
    if (workspace.resize) workspace.resize();
  } catch {}
}

function prepareWorkspaceMount(mount) {
  mount.style.width = '720px';
  mount.style.height = '220px';
}

function fitWorkspace(api, workspace, mount) {
  resizeWorkspace(api, workspace);
  try {
    const metrics = workspace.getMetrics && workspace.getMetrics();
    const contentWidth = Math.ceil(metrics?.contentWidth || metrics?.viewWidth || 0);
    const contentHeight = Math.ceil(metrics?.contentHeight || metrics?.viewHeight || 0);
    if (contentWidth || contentHeight) {
      mount.style.width = `${Math.max(340, Math.min(1100, contentWidth + 56))}px`;
      mount.style.height = `${Math.max(180, Math.min(640, contentHeight + 56))}px`;
      resizeWorkspace(api, workspace);
    }
  } catch {}
}

function createScratchNativeTheme(api) {
  const categoryStyles = {};
  Object.entries(SCRATCH_NATIVE_BLOCK_STYLES).forEach(([name, style]) => {
    categoryStyles[`${name}_category`] = { colour: style.colourPrimary };
  });
  const themeDef = {
    base: api.Themes?.Classic || api.Themes?.Zelos,
    blockStyles: SCRATCH_NATIVE_BLOCK_STYLES,
    categoryStyles,
    componentStyles: {},
  };
  try {
    if (api.Theme?.defineTheme) return api.Theme.defineTheme('hkico-scratch-native', themeDef);
  } catch {}
  try {
    if (api.Theme) {
      return new api.Theme('hkico-scratch-native', themeDef.blockStyles, themeDef.categoryStyles, themeDef.componentStyles);
    }
  } catch {}
  return undefined;
}

function loadXml(api, workspace, xmlText) {
  const xmlApi = api.Xml || api.utils?.xml || api.Xml;
  if (!xmlApi) throw new Error('XML API is unavailable.');
  const dom = xmlApi.textToDom ? xmlApi.textToDom(xmlText) : api.utils.xml.textToDom(xmlText);
  if (api.clearWorkspaceAndLoadFromXml) {
    api.clearWorkspaceAndLoadFromXml(dom, workspace);
    return;
  }
  if (xmlApi.clearWorkspaceAndLoadFromXml) {
    xmlApi.clearWorkspaceAndLoadFromXml(dom, workspace);
    return;
  }
  if (xmlApi.domToWorkspace) {
    workspace.clear();
    xmlApi.domToWorkspace(dom, workspace);
    return;
  }
  throw new Error('No supported XML workspace loader was found.');
}

function scratchDropdownBlock(api, blockName, fieldName, options, styleName) {
  if (!api.Blocks) throw new Error('Scratch Blocks registry is unavailable.');
  api.Blocks[blockName] = {
    init: function init() {
      this.jsonInit({
        message0: '%1',
        args0: [{
          type: 'field_dropdown',
          name: fieldName,
          options,
        }],
        extensions: [`colours_${styleName}`, 'output_string'],
      });
    },
  };
}

function registerScratchDynamicMenus(api, dynamicMenus = {}) {
  const normalize = (items, fallback) => {
    const source = Array.isArray(items) && items.length ? items : fallback;
    return source.map(item => Array.isArray(item) ? item : [String(item.label), String(item.value)]);
  };
  const touching = normalize(dynamicMenus.touchingObjects, [
    ['mouse-pointer', '_mouse_'],
    ['edge', '_edge_'],
  ]);
  const sprites = normalize(dynamicMenus.sprites, [
    ['myself', '_myself_'],
    ['Sprite1', 'Sprite1'],
  ]);
  const backdrops = normalize(dynamicMenus.backdrops, [
    ['backdrop1', 'backdrop1'],
  ]);
  scratchDropdownBlock(api, 'sensing_touchingobjectmenu', 'TOUCHINGOBJECTMENU', touching, 'sensing');
  scratchDropdownBlock(api, 'sensing_distancetomenu', 'DISTANCETOMENU', touching, 'sensing');
  scratchDropdownBlock(api, 'motion_pointtowards_menu', 'TOWARDS', touching, 'motion');
  scratchDropdownBlock(api, 'motion_goto_menu', 'TO', touching, 'motion');
  scratchDropdownBlock(api, 'motion_glideto_menu', 'TO', touching, 'motion');
  scratchDropdownBlock(api, 'control_create_clone_of_menu', 'CLONE_OPTION', sprites, 'control');
  scratchDropdownBlock(api, 'sensing_of_object_menu', 'OBJECT', sprites, 'sensing');
  api.Blocks.event_whenbackdropswitchesto = {
    init: function init() {
      this.jsonInit({
        message0: api.Msg.EVENT_WHENBACKDROPSWITCHESTO || 'when backdrop switches to %1',
        args0: [{
          type: 'field_dropdown',
          name: 'BACKDROP',
          options: backdrops,
        }],
        extensions: ['colours_event', 'shape_hat'],
      });
    },
  };
}

async function renderScratchBlocks(target, visual, activeBlocks) {
  const ScratchBlocks = await getScratchBlocks();
  if (ScratchBlocks.ScratchMsgs?.setLocale) ScratchBlocks.ScratchMsgs.setLocale('en');
  else if (ScratchBlocks.setLocale) ScratchBlocks.setLocale('en');
  registerScratchDynamicMenus(ScratchBlocks, visual.dynamicMenus);
  const mount = target.querySelector('.hkico-block-workspace');
  prepareWorkspaceMount(mount);
  const options = {
    readOnly: true,
    scrollbars: false,
    trashcan: false,
    comments: false,
    sounds: false,
    zoom: { controls: false, wheel: false, startScale: 0.82 },
    pathToMedia: SCRATCH_MEDIA_URL,
    media: SCRATCH_MEDIA_URL,
    scratchTheme: ScratchBlocks.ScratchBlocksTheme?.CLASSIC || 'classic',
    theme: createScratchNativeTheme(ScratchBlocks),
  };
  const workspace = ScratchBlocks.inject(mount, options);
  if (typeof visual.serialization !== 'string') {
    throw new Error('Scratch Blocks currently requires XML serialization.');
  }
  loadXml(ScratchBlocks, workspace, visual.serialization);
  fitWorkspace(ScratchBlocks, workspace, mount);
  const missing = highlightBlocks(workspace, activeBlocks);
  return { workspace, missing };
}

async function renderBlockly(target, visual, activeBlocks) {
  const Blockly = await getBlockly();
  const mount = target.querySelector('.hkico-block-workspace');
  prepareWorkspaceMount(mount);
  const workspace = Blockly.inject(mount, {
    readOnly: true,
    scrollbars: false,
    trashcan: false,
    comments: false,
    zoom: { controls: false, wheel: false, startScale: 0.82 },
  });
  if (typeof visual.serialization === 'string') {
    loadXml(Blockly, workspace, visual.serialization);
  } else if (Blockly.serialization?.workspaces?.load) {
    Blockly.serialization.workspaces.load(visual.serialization, workspace);
  } else {
    throw new Error('Blockly JSON serialization API is unavailable.');
  }
  fitWorkspace(Blockly, workspace, mount);
  const missing = highlightBlocks(workspace, activeBlocks);
  return { workspace, missing };
}

async function renderInto(target, visual, activeBlocks) {
  target.innerHTML = '';
  target.appendChild(textToElement(`
    <div class="hkico-block-visual">
      <div class="hkico-block-frame" data-status="loading">
        <div class="hkico-block-workspace" aria-hidden="true"></div>
      </div>
      <pre class="code hkico-block-fallback">${escapeHtml(fallbackText(visual))}</pre>
      <div class="hkico-block-note"></div>
    </div>
  `));
  const note = target.querySelector('.hkico-block-note');
  try {
    let result;
    if (visual.renderer === 'scratch-blocks') {
      result = await renderScratchBlocks(target, visual, activeBlocks);
      note.textContent = 'Rendered with scratch-blocks 2.1.32. Text fallback remains below for accessibility.';
    } else if (visual.renderer === 'blockly') {
      result = await renderBlockly(target, visual, activeBlocks);
      note.textContent = 'Rendered with Blockly 13.3.0. Text fallback remains below for accessibility.';
    } else {
      setStatus(target, 'unsupported', `Unsupported block renderer: ${visual.renderer}`);
      return { ok: false, missing: activeBlocks || [] };
    }
    target.querySelector('.hkico-block-frame').dataset.status = 'ready';
    if (result.missing.length) {
      note.textContent += ` Missing highlight IDs: ${result.missing.join(', ')}`;
    }
    target.hkicoBlockWorkspace = result.workspace;
    return { ok: true, missing: result.missing };
  } catch (error) {
    setStatus(target, 'failed', `Block picture renderer failed; showing text fallback. ${error.message}`);
    return { ok: false, error: error.message };
  }
}

function updateActive(target, activeBlocks) {
  if (!target || !target.hkicoBlockWorkspace) return [];
  return highlightBlocks(target.hkicoBlockWorkspace, activeBlocks);
}

window.HKICOBlockVisuals = {
  renderInto,
  updateActive,
};
