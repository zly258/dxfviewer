const fs = require('fs');
const path = require('path');

const cssContent = fs.readFileSync(path.join(__dirname, 'src', 'styles', 'index.css'), 'utf-8');

const blocks = [];
let currentBlock = '';
let bracketCount = 0;
let inComment = false;

for (let i = 0; i < cssContent.length; i++) {
  const char = cssContent[i];
  const nextChar = cssContent[i + 1];

  if (!inComment && char === '/' && nextChar === '*') {
    inComment = true;
  }
  
  currentBlock += char;

  if (inComment && char === '*' && nextChar === '/') {
    inComment = false;
    currentBlock += nextChar;
    i++;
    continue;
  }

  if (!inComment) {
    if (char === '{') bracketCount++;
    if (char === '}') {
      bracketCount--;
      if (bracketCount === 0) {
        blocks.push(currentBlock.trim());
        currentBlock = '';
      }
    }
  }
}

if (currentBlock.trim()) {
  blocks.push(currentBlock.trim());
}

const categories = {
  variables: [],
  reset: [],
  layout: [],
  toolbar: [],
  panel: [],
  statusBar: [],
  tabs: [],
  canvas: [],
  overlays: [],
  search: [],
  contextMenu: [],
  icons: [],
  dialog: [],
  components: []
};

const getCategory = (block) => {
  if (block.startsWith(':root') || block.startsWith('.theme-dark') || block.startsWith('@keyframes')) return 'variables';
  if (block.startsWith('html') || block.startsWith('body') || block.match(/^(h1|h2|p|button|input|select|textarea|svg|::-webkit-scrollbar)/)) return 'reset';
  if (block.includes('.app-container') || block.includes('.dxf-viewer-wrapper') || block.includes('.main-content') || block.includes('.viewer-container') || block.includes('.menu-tab-row') || block.includes('.menu-tab-strip') || block.includes('.split-pane') || block.includes('.Resizer') || block.includes('.side-panel-')) return 'layout';
  if (block.match(/\.toolbar\b/) || block.match(/\.menu-item\b/) || block.includes('.mobile-controls') || block.includes('.control-group') || block.includes('.control-button') || block.includes('.dropdown') || block.includes('.divider')) return 'toolbar';
  if (block.includes('.layer-panel') || block.includes('.properties-panel') || block.match(/\.panel\b/) || block.includes('.layer-item') || block.includes('.property-') || block.includes('.layer-row') || block.includes('.entity-row') || block.includes('.layer-name') || block.includes('.entity-name') || block.includes('.chevron') || block.includes('.color-swatch') || block.includes('.layer-icon') || block.includes('.entity-icon') || block.includes('.properties-content') || block.includes('.empty-text') || block.includes('.layer-count') || block.includes('.color-preview')) return 'panel';
  if (block.includes('.status-bar') || block.includes('.space-switch-bar') || block.includes('.status-item') || block.includes('.space-tab') || block.includes('.status-left') || block.includes('.status-right') || block.includes('.coord-part')) return 'statusBar';
  if (block.includes('.tabs-container') || block.includes('.tab-') || block.includes('.empty-placeholder')) return 'tabs';
  if (block.includes('.canvas-container') || block.includes('.canvas-wrapper') || block.includes('.crosshair') || block.includes('.selection-box')) return 'canvas';
  if (block.includes('.loading-overlay') || block.includes('.toast') || block.includes('.viewer-notice') || block.includes('.hidden-file-input')) return 'overlays';
  if (block.includes('.text-search-panel') || block.includes('.search-') || block.includes('.match-')) return 'search';
  if (block.includes('.context-menu')) return 'contextMenu';
  if (block.includes('.viewer-icon') || block.includes('.icon-')) return 'icons';
  if (block.includes('.dialog-') || block.includes('.about-dialog')) return 'dialog';
  return 'components';
};

blocks.forEach(block => {
  const category = getCategory(block);
  categories[category].push(block);
});

const outDir = path.join(__dirname, 'src', 'styles');

let imports = '';
for (const [cat, blocks] of Object.entries(categories)) {
  if (blocks.length > 0) {
    const fileName = `${cat}.css`;
    fs.writeFileSync(path.join(outDir, fileName), blocks.join('\n\n'));
    imports += `@import './${fileName}';\n`;
    console.log(`Wrote ${blocks.length} blocks to ${fileName}`);
  }
}

fs.writeFileSync(path.join(outDir, 'index.css'), imports);
console.log('Successfully split CSS and updated index.css');
